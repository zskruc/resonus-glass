package expo.modules.mediacontrols

import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.media.AudioManager
import android.media.MediaRouter2
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Real STREAM_MUSIC volume, independent of Resonus's per-player gain/ReplayGain.
 * No level is changed on start, resume or route changes. Events exist only
 * while a visible subscriber needs them; there is no recurring polling job.
 */
class MediaControlsModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var observing = false
  private var foreground = true
  private var registeredContext: Context? = null
  private var output: SystemAudioOutput? = null
  private var observerRegistered = false
  private var lastState: Map<String, Any>? = null
  private val emitChanged = Runnable { publishState() }
  private val volumeObserver = object : ContentObserver(main) {
    override fun onChange(selfChange: Boolean, uri: Uri?) = scheduleRefresh()
  }

  override fun definition() = ModuleDefinition {
    Name("ResonusMediaControls")
    Events("onMediaControlsChanged")
    OnStartObserving {
      main.post { observing = true; startObserving() }
    }
    OnStopObserving {
      main.post { observing = false; stopObserving() }
    }
    OnActivityEntersForeground {
      main.post { foreground = true; startObserving() }
    }
    OnActivityEntersBackground {
      main.post { foreground = false; stopObserving() }
    }
    OnDestroy {
      main.post { observing = false; stopObserving() }
    }
    AsyncFunction("getState") { readState() }.runOnQueue(Queues.MAIN)
    AsyncFunction("setMusicVolume") { level: Int, expectedRouteId: String, expectedMinimum: Int, expectedMaximum: Int ->
      val audio = audioManager()
      if (audio != null && foreground && !audio.isVolumeFixed) {
        val minimum = if (Build.VERSION.SDK_INT >= 28) audio.getStreamMinVolume(AudioManager.STREAM_MUSIC) else 0
        val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val routeId = output?.current()?.id ?: SystemAudioOutput(context()!!, audio) {}.use { it.current().id }
        // The main-queue write can arrive after a USB/Bluetooth handoff. Reject
        // the old gesture instead of applying headphone loudness to a speaker.
        if (maximum > minimum && minimum == expectedMinimum && maximum == expectedMaximum &&
          routeId == expectedRouteId) runCatching {
          val requested = level.coerceIn(minimum, maximum)
          if (audio.getStreamVolume(AudioManager.STREAM_MUSIC) != requested) {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, requested, 0)
          }
        }
      }
      // Read the applied value back: safe-volume limits and fixed-volume routes
      // must not leave a slider claiming a level that the system rejected.
      val state = readState()
      publish(state)
      state
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("openSystemOutput") {
      val activity = appContext.currentActivity
      if (activity == null || activity.isFinishing || activity.isDestroyed || !foreground) "unavailable"
      else {
        val shown = Build.VERSION.SDK_INT >= 34 && runCatching {
          MediaRouter2.getInstance(activity).showSystemOutputSwitcher()
        }.getOrDefault(false)
        if (shown) "outputSwitcher"
        else {
          // A volume panel is explicitly reported as such to the caller. Never
          // present a fabricated in-app device list as the system picker.
          val opened = Build.VERSION.SDK_INT >= 29 && runCatching {
            activity.startActivity(Intent(Settings.Panel.ACTION_VOLUME))
            true
          }.getOrDefault(false)
          if (opened) "volumePanel" else "unavailable"
        }
      }
    }.runOnQueue(Queues.MAIN)
  }

  private fun context(): Context? = appContext.reactContext?.applicationContext
  private fun audioManager(): AudioManager? = context()?.getSystemService(AudioManager::class.java)

  private fun startObserving() {
    if (!observing || !foreground || registeredContext != null) return
    val context = context() ?: return
    val audio = audioManager() ?: return
    registeredContext = context
    output = runCatching { SystemAudioOutput(context, audio, ::scheduleRefresh) }.getOrNull()
    runCatching {
      // Android persists device-specific music levels under Settings.System;
      // observing descendants also covers wired/Bluetooth volume keys.
      context.contentResolver.registerContentObserver(Settings.System.CONTENT_URI, true, volumeObserver)
      observerRegistered = true
    }
    lastState = null
    publishState()
  }

  private fun stopObserving() {
    main.removeCallbacks(emitChanged)
    output?.close()
    output = null
    if (observerRegistered) runCatching { registeredContext?.contentResolver?.unregisterContentObserver(volumeObserver) }
    observerRegistered = false
    registeredContext = null
    lastState = null
  }

  private fun scheduleRefresh() {
    if (!observing || !foreground || registeredContext == null) return
    main.removeCallbacks(emitChanged)
    main.post(emitChanged)
  }

  private fun readState(): Map<String, Any> {
    val audio = audioManager() ?: return mapOf("supported" to false)
    return runCatching {
      val minimum = if (Build.VERSION.SDK_INT >= 28) audio.getStreamMinVolume(AudioManager.STREAM_MUSIC) else 0
      val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      // A one-shot route query without persistent callbacks when no UI listens.
      val route = output?.current() ?: SystemAudioOutput(context()!!, audio) {}.use { it.current() }
      mapOf<String, Any>(
        "supported" to true,
        "minimum" to minimum,
        "maximum" to maximum,
        "level" to audio.getStreamVolume(AudioManager.STREAM_MUSIC),
        "fixed" to (audio.isVolumeFixed || maximum <= minimum),
        "muted" to audio.isStreamMute(AudioManager.STREAM_MUSIC),
        "routeKind" to route.kind,
        "routeName" to route.name,
        "routeId" to route.id,
        "outputSwitcherSupported" to (Build.VERSION.SDK_INT >= 34),
      )
    }.getOrElse { mapOf("supported" to false) }
  }

  private fun publishState() = publish(readState())
  private fun publish(state: Map<String, Any>) {
    if (!observing || !foreground || registeredContext == null || lastState == state) return
    lastState = state
    sendEvent("onMediaControlsChanged", state)
  }
}
