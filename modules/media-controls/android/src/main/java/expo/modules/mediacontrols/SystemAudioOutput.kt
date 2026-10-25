package expo.modules.mediacontrols

import android.annotation.TargetApi
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRoute2Info
import android.media.MediaRouter
import android.media.MediaRouter2
import android.media.RouteDiscoveryPreference
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executor

/**
 * Adapted from Kifranei/AM-plus-plus-media-plugin SystemAudioOutput.kt (GPL-3.0),
 * commit b9e043c10ee8bdba62f155acba296be566b9b71d. Resonus uses system-reported
 * routes only, without Bluetooth enumeration/permissions or Apple image assets.
 */
internal class SystemAudioOutput(
  private val context: Context,
  private val audio: AudioManager,
  private val onChanged: () -> Unit,
) : AutoCloseable {
  data class Route(val kind: String, val name: String = "", val id: String = "")

  private val main = Handler(Looper.getMainLooper())
  private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
  private val legacy = context.getSystemService(MediaRouter::class.java)
  private var legacyRegistered = false
  private var deviceRegistered = false
  private var modern: ModernRoutes? = null
  private val callback = object : MediaRouter.SimpleCallback() {
    override fun onRouteSelected(router: MediaRouter, type: Int, info: MediaRouter.RouteInfo) = onChanged()
    override fun onRouteChanged(router: MediaRouter, info: MediaRouter.RouteInfo) = onChanged()
    override fun onRouteUnselected(router: MediaRouter, type: Int, info: MediaRouter.RouteInfo) = onChanged()
  }
  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(devices: Array<AudioDeviceInfo>) = onChanged()
    override fun onAudioDevicesRemoved(devices: Array<AudioDeviceInfo>) = onChanged()
  }

  init {
    runCatching {
      legacy?.addCallback(MediaRouter.ROUTE_TYPE_LIVE_AUDIO, callback, MediaRouter.CALLBACK_FLAG_UNFILTERED_EVENTS)
      legacyRegistered = legacy != null
    }
    runCatching {
      audio.registerAudioDeviceCallback(deviceCallback, main)
      deviceRegistered = true
    }
    if (Build.VERSION.SDK_INT >= 30) modern = runCatching { ModernRoutes(context, onChanged) }.getOrNull()
  }

  fun current(): Route {
    // Unlike GET_DEVICES_OUTPUTS this queries the anticipated route for MEDIA,
    // not the inventory of connected devices. Multiple selected outputs retain
    // all their names; no connected Bluetooth device is guessed to be active.
    val routed = if (Build.VERSION.SDK_INT >= 33) runCatching {
      audio.getAudioDevicesForAttributes(attributes).map(::deviceRoute)
    }.getOrDefault(emptyList()) else emptyList()
    val selected = if (Build.VERSION.SDK_INT >= 34) modern?.selected().orEmpty() else emptyList()
    val candidates = routed.ifEmpty { selected }.ifEmpty { listOfNotNull(legacyRoute()) }
    if (candidates.isEmpty()) return Route("unknown")
    if (candidates.size == 1) return candidates.first()
    val names = candidates.map { it.name }.filter { it.isNotBlank() }.distinct()
    val kinds = candidates.map { it.kind }.distinct()
    return Route(if (kinds.size == 1) kinds.first() else "external", names.joinToString(" · "), candidates.map { it.id }.sorted().joinToString("|"))
  }

  private fun legacyRoute(): Route? = runCatching {
    val router = legacy ?: return@runCatching null
    val route = router.getSelectedRoute(MediaRouter.ROUTE_TYPE_LIVE_AUDIO) ?: return@runCatching null
    val isDefault = route === router.defaultRoute
    val kind = when (route.deviceType) {
      MediaRouter.RouteInfo.DEVICE_TYPE_BLUETOOTH -> "bluetooth"
      MediaRouter.RouteInfo.DEVICE_TYPE_SPEAKER -> if (isDefault) "speaker" else "external"
      MediaRouter.RouteInfo.DEVICE_TYPE_TV -> "external"
      else -> if (isDefault) "speaker" else "unknown"
    }
    Route(kind, if (isDefault) "" else route.name?.toString().orEmpty(), "legacy:${route.name}")
  }.getOrNull()

  @TargetApi(33)
  private fun deviceRoute(device: AudioDeviceInfo): Route {
    val kind = when (device.type) {
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE,
      AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "speaker"
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_BROADCAST,
      AudioDeviceInfo.TYPE_BLE_SPEAKER, AudioDeviceInfo.TYPE_HEARING_AID -> "bluetooth"
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_USB_HEADSET -> "headphones"
      AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC, AudioDeviceInfo.TYPE_HDMI_EARC,
      AudioDeviceInfo.TYPE_LINE_ANALOG, AudioDeviceInfo.TYPE_LINE_DIGITAL,
      AudioDeviceInfo.TYPE_DOCK, AudioDeviceInfo.TYPE_USB_DEVICE -> "external"
      else -> "unknown"
    }
    return Route(kind, if (kind == "speaker") "" else device.productName?.toString().orEmpty(), "device:${device.id}")
  }

  override fun close() {
    if (legacyRegistered) runCatching { legacy?.removeCallback(callback) }
    if (deviceRegistered) runCatching { audio.unregisterAudioDeviceCallback(deviceCallback) }
    legacyRegistered = false
    deviceRegistered = false
    if (Build.VERSION.SDK_INT >= 30) modern?.close()
    modern = null
  }

  @TargetApi(30)
  private class ModernRoutes(context: Context, private val onChanged: () -> Unit) : AutoCloseable {
    private val router = MediaRouter2.getInstance(context)
    private val main = Handler(Looper.getMainLooper())
    private val executor = Executor { main.post(it) }
    private var routeRegistered = false
    private var controllerRegistered = false
    private val routes = object : MediaRouter2.RouteCallback() {
      override fun onRoutesChanged(routes: List<MediaRoute2Info>) = onChanged()
      override fun onRoutesAdded(routes: List<MediaRoute2Info>) = onChanged()
      override fun onRoutesRemoved(routes: List<MediaRoute2Info>) = onChanged()
    }
    private val controller = object : MediaRouter2.ControllerCallback() {
      override fun onControllerUpdated(controller: MediaRouter2.RoutingController) = onChanged()
    }
    init {
      try {
        // Passive observation, never an active Bluetooth/network discovery scan.
        router.registerRouteCallback(executor, routes,
          RouteDiscoveryPreference.Builder(listOf(MediaRoute2Info.FEATURE_LIVE_AUDIO), false).build())
        routeRegistered = true
        router.registerControllerCallback(executor, controller)
        controllerRegistered = true
      } catch (error: Throwable) { close(); throw error }
    }
    @TargetApi(34)
    fun selected(): List<Route> = runCatching {
      router.systemController.selectedRoutes.map { route ->
        val kind = when (route.type) {
          MediaRoute2Info.TYPE_BUILTIN_SPEAKER -> "speaker"
          MediaRoute2Info.TYPE_BLUETOOTH_A2DP, MediaRoute2Info.TYPE_HEARING_AID,
          MediaRoute2Info.TYPE_BLE_HEADSET -> "bluetooth"
          MediaRoute2Info.TYPE_WIRED_HEADPHONES, MediaRoute2Info.TYPE_WIRED_HEADSET,
          MediaRoute2Info.TYPE_USB_HEADSET -> "headphones"
          MediaRoute2Info.TYPE_REMOTE_SPEAKER, MediaRoute2Info.TYPE_REMOTE_TV,
          MediaRoute2Info.TYPE_HDMI, MediaRoute2Info.TYPE_HDMI_ARC,
          MediaRoute2Info.TYPE_LINE_ANALOG, MediaRoute2Info.TYPE_LINE_DIGITAL,
          MediaRoute2Info.TYPE_DOCK -> "external"
          else -> "unknown"
        }
        Route(kind, if (kind == "speaker") "" else route.name.toString(), "route:${route.id}")
      }
    }.getOrDefault(emptyList())
    override fun close() {
      if (routeRegistered) runCatching { router.unregisterRouteCallback(routes) }
      if (controllerRegistered) runCatching { router.unregisterControllerCallback(controller) }
      routeRegistered = false
      controllerRegistered = false
    }
  }
}
