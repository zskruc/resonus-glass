package expo.modules.liquidglass

import android.content.res.Configuration
import android.os.SystemClock
import android.util.Log
import android.view.View
import androidx.compose.runtime.snapshots.Snapshot
import java.util.WeakHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Explicit process-start opt-in; numeric material state only, never media/page data. */
internal object GlassThemeTrace {
  private const val TAG = "ResonusGlassTheme"
  private const val LIMIT = 200
  const val TINT = 0
  const val DARK = 1
  const val COMPOSE = 2
  const val SURFACE = 3

  // Set log.tag.ResonusGlassTheme=DEBUG before starting the diagnostic process.
  // Cache once so normal composition/drawing does not query system properties.
  val enabled: Boolean by lazy { Log.isLoggable(TAG, Log.DEBUG) }
  private val remaining = AtomicInteger(LIMIT)
  private val materialSignatures by lazy { WeakHashMap<LiquidGlassView, LongArray>() }
  private val windowSignatures by lazy { WeakHashMap<Any, MutableMap<String, Long>>() }

  private fun claim(): Boolean {
    while (true) {
      val count = remaining.get()
      if (count <= 0) return false
      if (remaining.compareAndSet(count, count - 1)) return true
    }
  }

  private fun mix(hash: Long, value: Int): Long = hash * 31L + value
  private fun hex(value: Int): String = "#" + value.toUInt().toString(16).padStart(8, '0')

  fun recordMaterial(view: LiquidGlassView, stage: Int, paintTint: Int, paintOpacity: Float,
    paintDark: Boolean, previousValue: Int = 0) {
    if (!enabled || remaining.get() <= 0) return
    // Observing a host color from a draw callback would create a new dependency
    // and could itself fix the stale drawing under investigation. Progress must
    // likewise not subscribe the root composition to every animation sample.
    Snapshot.withoutReadObservation {
      if (view.materialPreset != "amPlus") return@withoutReadObservation
      val currentTint = view.tintColor
      val currentDark = view.dark
      val currentOpacity = view.tintOpacity
      val progress = view.dockProgress
      val systemNight = view.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
      var alphaProduct = 1f
      var ancestor: View? = view
      while (ancestor != null) {
        alphaProduct *= ancestor.alpha
        ancestor = ancestor.parent as? View
      }
      // Geometry/alpha are reported exactly, but only endpoint classes enter
      // the fingerprint: an ordinary spring/fade must not log every sample.
      val progressClass = when { progress <= .001f -> 0; progress >= .999f -> 2; else -> 1 }
      val alphaClass = when { alphaProduct <= .001f -> 0; alphaProduct >= .999f -> 2; else -> 1 }
      var fingerprint = mix(17L, currentTint)
      fingerprint = mix(fingerprint, if (currentDark) 1 else 0)
      fingerprint = mix(fingerprint, currentOpacity.toRawBits())
      fingerprint = mix(fingerprint, paintTint)
      fingerprint = mix(fingerprint, paintOpacity.toRawBits())
      fingerprint = mix(fingerprint, if (paintDark) 1 else 0)
      fingerprint = mix(fingerprint, systemNight)
      fingerprint = mix(fingerprint, progressClass)
      fingerprint = mix(fingerprint, alphaClass)
      fingerprint = mix(fingerprint, view.tabsCount)
      fingerprint = mix(fingerprint, view.dockRole.hashCode())
      synchronized(materialSignatures) {
        val signatures = materialSignatures.getOrPut(view) { LongArray(4) { Long.MIN_VALUE } }
        if (signatures[stage] == fingerprint) return@withoutReadObservation
        signatures[stage] = fingerprint
      }
      if (!claim()) return@withoutReadObservation
      val event = when (stage) { TINT -> "tint"; DARK -> "dark"; COMPOSE -> "compose"; else -> "surface" }
      Log.d(TAG, "t=${SystemClock.uptimeMillis()} host=${System.identityHashCode(view)} event=$event " +
        "role=${view.dockRole} tabs=${view.tabsCount} progress=$progress " +
        "currentTint=${hex(currentTint)} paintTint=${hex(paintTint)} " +
        "currentOpacity=$currentOpacity paintOpacity=$paintOpacity currentDark=$currentDark paintDark=$paintDark " +
        "systemNight=$systemNight alphaProduct=$alphaProduct previous=${if (stage == TINT) hex(previousValue) else previousValue}")
    }
  }

  /** Window capture diagnostics share the same process-wide budget. */
  fun recordWindow(owner: Any, event: String, fingerprint: Long, details: () -> String) {
    if (!enabled || remaining.get() <= 0) return
    synchronized(windowSignatures) {
      val signatures = windowSignatures.getOrPut(owner) { mutableMapOf() }
      if (signatures[event] == fingerprint) return
      signatures[event] = fingerprint
    }
    if (!claim()) return
    Log.d(TAG, "t=${SystemClock.uptimeMillis()} window=${System.identityHashCode(owner)} event=$event ${details()}")
  }
}
