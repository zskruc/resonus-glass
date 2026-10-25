package expo.modules.liquidglass

import android.os.Looper
import android.os.SystemClock
import android.os.Trace
import android.util.Log
import androidx.compose.runtime.snapshots.Snapshot
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Ephemeral view tokens; direct UI-runtime calls never touch RN shadow trees. */
internal object TabsMotionHosts {
  private val nextToken = AtomicInteger(0)
  private val hosts = ConcurrentHashMap<Int, WeakReference<LiquidGlassView>>()
  private var motionCalls = 0L
  private var dockCalls = 0L
  private var buttonCalls = 0L
  private var lastLog = 0L

  fun attach(view: LiquidGlassView): Int {
    val token = nextToken.incrementAndGet()
    hosts[token] = WeakReference(view)
    return token
  }

  fun detach(token: Int) { hosts.remove(token) }

  fun diagnostics(): Map<String, Any> = mapOf(
    "registeredMotionHosts" to hosts.size,
    "directMotionCalls" to motionCalls,
    "directDockCalls" to dockCalls,
    "directButtonCalls" to buttonCalls
  )

  fun updateButton(token: Int, progress: Double, x: Double, y: Double) {
    if (Looper.myLooper() !== Looper.getMainLooper() || !progress.isFinite() || !x.isFinite() || !y.isFinite()) return
    val view = hosts[token]?.get()
    if (view == null) { hosts.remove(token); return }
    if (!view.isAttachedToWindow || view.materialPreset != "amPlus" || view.dockRole != "mini") return
    val p = progress.toFloat().coerceIn(0f, 1f)
    val px = x.toFloat().coerceIn(-2000f, 2000f)
    val py = y.toFloat().coerceIn(-2000f, 2000f)
    if (view.buttonPressProgress != p || view.buttonPressX != px || view.buttonPressY != py) {
      Snapshot.withMutableSnapshot {
        view.buttonPressProgress = p
        view.buttonPressX = px
        view.buttonPressY = py
      }
    }
    buttonCalls++
  }

  fun updateDock(token: Int, progress: Double) {
    if (Looper.myLooper() !== Looper.getMainLooper() || !progress.isFinite()) return
    val view = hosts[token]?.get()
    if (view == null) {
      hosts.remove(token)
      return
    }
    if (!view.isAttachedToWindow || view.dockCompactWidth <= 0f) return
    val nextProgress = if (view.materialPreset == "amPlus") AmPlusDockGeometry.rawProgress(progress.toFloat())
      else progress.toFloat().coerceIn(0f, 1f)
    // Different JS doubles can collapse to the same Float, especially at the
    // spring's tail. Avoid allocating/applying a snapshot with no state change.
    if (view.dockProgress != nextProgress) {
      Snapshot.withMutableSnapshot { view.dockProgress = nextProgress }
      if (Trace.isEnabled()) Trace.setCounter("ResonusDockProgress", (nextProgress * 1000f).toLong())
    }
    // Preserve the diagnostics counter as accepted calls, including no-ops.
    dockCalls++
  }

  fun update(token: Int, position: Double, progress: Double, scaleX: Double,
    scaleY: Double, velocity: Double, panelOffset: Double, opacity: Double) {
    // The sync HostFunction is shared into Worklets' UI runtime. Ignore calls
    // from the RN JS thread rather than posting one task for each input event.
    if (Looper.myLooper() !== Looper.getMainLooper()) return
    if (!position.isFinite() || !progress.isFinite() || !scaleX.isFinite() || !scaleY.isFinite() ||
      !velocity.isFinite() || !panelOffset.isFinite() || !opacity.isFinite()) return
    val view = hosts[token]?.get()
    if (view == null) {
      hosts.remove(token)
      return
    }
    if (!view.isAttachedToWindow || view.tabsCount <= 0) return
    Snapshot.withMutableSnapshot {
      view.tabPosition = position.toFloat().coerceIn(0f, (view.tabsCount - 1).toFloat())
      view.tabPressProgress = progress.toFloat().coerceIn(0f, 1f)
      view.tabScaleX = scaleX.toFloat().coerceIn(0.5f, 1.8f)
      view.tabScaleY = scaleY.toFloat().coerceIn(0.5f, 1.8f)
      view.tabVelocity = velocity.toFloat().coerceIn(-10f, 10f)
      view.tabPanelOffset = panelOffset.toFloat().coerceIn(-4f, 4f)
      view.tabSelectionOpacity = opacity.toFloat().coerceIn(0f, 1f)
    }
    motionCalls++
    val now = SystemClock.uptimeMillis()
    if (motionCalls == 1L || now - lastLog >= 2_000L) {
      lastLog = now
      Log.d("ResonusTabsMotion", "directUpdates=$motionCalls hosts=${hosts.size} " +
        "press=${view.tabPressProgress} scaleX=${view.tabScaleX} scaleY=${view.tabScaleY} " +
        "velocity=${view.tabVelocity} offset=${view.tabPanelOffset}")
    }
  }
}
