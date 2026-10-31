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
  private val awaitingDockReplay = ConcurrentHashMap.newKeySet<Int>()
  private var motionCalls = 0L
  private var dockCalls = 0L
  private var buttonCalls = 0L
  private var lastLog = 0L

  fun attach(view: LiquidGlassView): Int {
    val token = nextToken.incrementAndGet()
    hosts[token] = WeakReference(view)
    awaitingDockReplay.add(token)
    if (Log.isLoggable("ResonusDockLifecycle", Log.DEBUG))
      Log.d("ResonusDockLifecycle", "ready token=$token role=${view.dockRole} progress=${view.dockProgress} compactWidth=${view.dockCompactWidth}")
    return token
  }

  fun detach(token: Int) { hosts.remove(token); awaitingDockReplay.remove(token) }

  fun readDockScrollIntent(token: Int, scope: String): Double {
    if (Looper.myLooper() !== Looper.getMainLooper()) return 0.0
    val view = hosts[token]?.get() ?: return 0.0
    if (!view.isAttachedToWindow || view.materialPreset != "amPlus") return 0.0
    return AmPlusDockScrollInput.read(view, scope)
  }

  fun expandDockScrollInput(token: Int) {
    if (Looper.myLooper() !== Looper.getMainLooper()) return
    hosts[token]?.get()?.let { AmPlusDockScrollInput.expand(it) }
  }

  fun restoreDockScrollTarget(token: Int, scope: String, collapsed: Boolean): Boolean {
    if (Looper.myLooper() !== Looper.getMainLooper()) return false
    return hosts[token]?.get()?.restoreDockScrollTarget(scope, collapsed) ?: false
  }

  fun diagnostics(): Map<String, Any> = mapOf(
    "registeredMotionHosts" to hosts.size,
    "directMotionCalls" to motionCalls,
    "directDockCalls" to dockCalls,
    "directButtonCalls" to buttonCalls
  )

  fun updateButton(token: Int, progress: Double, x: Double, y: Double): Boolean {
    if (Looper.myLooper() !== Looper.getMainLooper() || !progress.isFinite() || !x.isFinite() || !y.isFinite()) return false
    val view = hosts[token]?.get()
    if (view == null) { detach(token); return false }
    if (!view.isAttachedToWindow || view.materialPreset != "amPlus" || view.dockRole != "mini") return false
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
    return true
  }

  fun updateDock(token: Int, progress: Double): Boolean {
    if (Looper.myLooper() !== Looper.getMainLooper() || !progress.isFinite()) return false
    val view = hosts[token]?.get()
    if (view == null) {
      detach(token)
      return false
    }
    if (!view.isAttachedToWindow || view.dockCompactWidth <= 0f) return false
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
    if (awaitingDockReplay.remove(token) && Log.isLoggable("ResonusDockLifecycle", Log.DEBUG))
      Log.d("ResonusDockLifecycle", "replayed token=$token role=${view.dockRole} progress=${view.dockProgress} compactWidth=${view.dockCompactWidth}")
    return true
  }

  fun update(token: Int, position: Double, progress: Double, scaleX: Double,
    scaleY: Double, velocity: Double, panelOffset: Double, opacity: Double): Boolean {
    // The sync HostFunction is shared into Worklets' UI runtime. Ignore calls
    // from the RN JS thread rather than posting one task for each input event.
    if (Looper.myLooper() !== Looper.getMainLooper()) return false
    if (!position.isFinite() || !progress.isFinite() || !scaleX.isFinite() || !scaleY.isFinite() ||
      !velocity.isFinite() || !panelOffset.isFinite() || !opacity.isFinite()) return false
    val view = hosts[token]?.get()
    if (view == null) {
      detach(token)
      return false
    }
    if (!view.isAttachedToWindow || view.tabsCount <= 0) return false
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
    return true
  }
}
