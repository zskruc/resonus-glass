/*
 * Page-input ownership adapted from Zennmn/AM-plus-plus GlassBarCollapseInput.kt
 * and GlassBarCollapseController.kt (GPL-3.0), commit
 * 36dd119950b001883d3e31e17586f545d404a7c1. Its accumulator and touch tracker are
 * ported alongside this file. Resonus owns its scroll views, so no Xposed,
 * private host symbols or Apple resources are required.
 */
package expo.modules.liquidglass

import android.app.Activity
import android.content.ContextWrapper
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.Window
import android.widget.AbsSeekBar
import android.widget.CompoundButton
import androidx.core.view.ScrollingView
import com.facebook.react.bridge.ReactContext
import java.lang.ref.WeakReference
import java.util.WeakHashMap
import kotlin.math.abs

/** Main-thread only. A target event crosses to RN once; animation remains one shared UI spring. */
internal object AmPlusDockScrollInput {
  private val windows = WeakHashMap<Window, PageInput>()
  private val owners = WeakHashMap<LiquidGlassView, PageInput>()
  private val surfaces = WeakHashMap<LiquidGlassView, Unit>()

  fun attachSurface(view: LiquidGlassView) { surfaces[view] = Unit }

  fun detachSurface(view: LiquidGlassView) {
    surfaces.remove(view)
    owners.remove(view)?.let { release(view, it) }
  }

  /** Signed serial: positive collapses, negative expands, zero has no valid page intent. */
  fun read(view: LiquidGlassView, scope: String): Double = owners[view]?.read(view, scope) ?: 0.0
  fun expand(view: LiquidGlassView) { owners[view]?.expand(view) }

  fun observe(view: LiquidGlassView, enabled: Boolean, scope: String, collapsed: Boolean,
    progress: () -> Float, onIntent: (Boolean, String) -> Unit) {
    if (!enabled) {
      owners.remove(view)?.let { release(view, it) }
      return
    }
    val window = windowFor(view) ?: return
    val input = windows[window] ?: PageInput(window) { event ->
      surfaces.keys.any { it.containsDockChromePoint(event.rawX, event.rawY) }
    }.also { windows[window] = it }
    owners[view]?.takeIf { it !== input }?.let { release(view, it) }
    owners[view] = input
    input.configure(view, scope, collapsed, progress, onIntent)
  }

  private fun release(view: LiquidGlassView, input: PageInput) {
    if (!input.release(view)) return
    val entry = windows.entries.firstOrNull { it.value === input }
    if (entry != null) windows.remove(entry.key)
    input.close()
  }

  private fun windowFor(view: View): Window? {
    var context = view.context
    repeat(16) {
      if (context is Activity) return (context as Activity).window
      if (context is ReactContext) (context as ReactContext).currentActivity?.window?.let { return it }
      val next = (context as? ContextWrapper)?.baseContext ?: return null
      if (next === context) return null
      context = next
    }
    return null
  }

  private class PageInput(window: Window, private val chromeOrigin: (MotionEvent) -> Boolean) {
    private data class PageGesture(
      val downTime: Long,
      val target: WeakReference<View>,
      var touching: Boolean = true,
      var direction: Boolean? = null,
      var offset: Int? = null,
    )

    private val window = WeakReference(window)
    private var owner: WeakReference<View>? = null
    private var scope = ""
    private var targetCollapsed = false
    private var controlledCollapsed = false
    private var serial = 0L
    private var lastIntent = 0.0
    private var progress: (() -> Float)? = null
    private var intent: ((Boolean, String) -> Unit)? = null
    private var gesture: PageGesture? = null
    private var density = 0f
    private var touch: GlassTouchCollapseTracker? = null
    private var scroll: GlassScrollCollapseAccumulator? = null
    private val location = IntArray(2)
    private var observer: ViewTreeObserver? = null
    private var closed = false
    private val delegate = requireNotNull(window.callback)
    private val callback = object : Window.Callback by delegate {
      override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (!closed) onTouch(event)
        return delegate.dispatchTouchEvent(event)
      }
      override fun onWindowFocusChanged(hasFocus: Boolean) {
        reset()
        lastIntent = 0.0
        if (hasFocus) targetCollapsed = controlledCollapsed
        delegate.onWindowFocusChanged(hasFocus)
      }
    }
    private val scrollListener = ViewTreeObserver.OnScrollChangedListener {
      if (!closed) onScroll()
    }

    init {
      window.callback = callback
      attachObserver()
    }

    fun configure(view: View, scope: String, collapsed: Boolean, progress: () -> Float,
      onIntent: (Boolean, String) -> Unit) {
      val newDensity = view.resources.displayMetrics.density
      if (density != newDensity || touch == null) {
        density = newDensity
        val configuration = ViewConfiguration.get(view.context)
        touch = GlassTouchCollapseTracker(configuration.scaledTouchSlop.toFloat(),
          configuration.scaledMinimumFlingVelocity.toFloat(), AmPlusPhoneDefaults.SCROLL_THRESHOLD_DP * density)
        scroll = GlassScrollCollapseAccumulator(AmPlusPhoneDefaults.SCROLL_THRESHOLD_DP * density)
        reset()
      }
      if (owner?.get() !== view || this.scope != scope || targetCollapsed != collapsed) {
        reset()
        lastIntent = 0.0
      }
      owner = WeakReference(view)
      this.scope = scope
      targetCollapsed = collapsed
      controlledCollapsed = collapsed
      this.progress = progress
      intent = onIntent
      attachObserver()
    }

    fun release(view: View): Boolean {
      if (owner?.get() !== view) return false
      owner = null
      progress = null
      intent = null
      lastIntent = 0.0
      reset()
      return true
    }

    fun read(view: View, scope: String): Double =
      if (!closed && owner?.get() === view && this.scope == scope && hasActiveWindow()) lastIntent else 0.0

    fun expand(view: View) {
      if (owner?.get() !== view) return
      reset()
      lastIntent = 0.0
      targetCollapsed = false
      controlledCollapsed = false
    }

    private fun attachObserver() {
      val next = window.get()?.decorView?.viewTreeObserver?.takeIf { it.isAlive } ?: return
      if (next === observer) return
      observer?.takeIf { it.isAlive }?.removeOnScrollChangedListener(scrollListener)
      observer = next
      next.addOnScrollChangedListener(scrollListener)
    }

    private fun request(collapsed: Boolean) {
      if (targetCollapsed == collapsed) return
      targetCollapsed = collapsed
      serial++
      lastIntent = if (collapsed) serial.toDouble() else -serial.toDouble()
      intent?.invoke(collapsed, scope)
    }

    private fun onTouch(event: MotionEvent) {
      val host = owner?.get()
      if (host == null || !hasActiveWindow() || !host.isShown || event.actionMasked == MotionEvent.ACTION_CANCEL || event.pointerCount > 1) {
        reset()
        return
      }
      if (event.actionMasked == MotionEvent.ACTION_DOWN) {
        reset()
        if (chromeOrigin(event)) return
        val root = window.get()?.decorView ?: return
        if (containsInteractiveControl(root, event.rawX, event.rawY)) return
        val target = findVerticalTarget(root, event.rawX, event.rawY) ?: return
        gesture = PageGesture(event.downTime, WeakReference(target))
        touch?.down(event.rawX, event.rawY, event.eventTime)
        return
      }
      val current = gesture?.takeIf { it.downTime == event.downTime && it.touching } ?: return
      val decision = when (event.actionMasked) {
        MotionEvent.ACTION_MOVE -> touch?.move(event.rawX, event.rawY, event.eventTime)
        MotionEvent.ACTION_UP -> touch?.up(event.rawX, event.rawY, event.eventTime)
        else -> null
      }
      if (event.actionMasked == MotionEvent.ACTION_UP) current.touching = false
      if (decision == null) return
      val target = current.target.get()
      if (target == null || !target.isShown || !target.canScrollVertically(if (decision) 1 else -1)) {
        current.direction = null
        current.offset = null
        scroll?.reset()
        return
      }
      current.direction = decision
      request(decision)
    }

    private fun onScroll() {
      if (!hasActiveWindow()) { reset(); lastIntent = 0.0; return }
      val current = gesture ?: return
      val target = current.target.get()?.takeIf { it.isShown && it.isAttachedToWindow } ?: return
      val offset = if (target is ScrollingView) target.computeVerticalScrollOffset() else target.scrollY
      val previous = current.offset ?: offset
      current.offset = offset
      val running = abs((progress?.invoke() ?: 0f) - if (targetCollapsed) 1f else 0f) > 0.001f
      // Exact source ownership: layout/peek movement during a press or spring
      // is baseline only; inertia may extend only its previously confirmed direction.
      if (current.touching || running) {
        scroll?.reset()
        return
      }
      val direction = current.direction ?: return
      val decision = scroll?.accumulate(previous - offset) ?: return
      if (decision == direction) request(decision)
    }

    private fun findVerticalTarget(view: View, x: Float, y: Float, depth: Int = 0): View? {
      if (depth > 64 || !view.isShown || view.alpha <= 0.001f || view.width <= 0 || view.height <= 0) return null
      view.getLocationOnScreen(location)
      if (x < location[0] || x >= location[0] + view.width || y < location[1] || y >= location[1] + view.height) return null
      if (view is ViewGroup) for (index in view.childCount - 1 downTo 0) {
        findVerticalTarget(view.getChildAt(index), x, y, depth + 1)?.let { return it }
      }
      return if (view.canScrollVertically(1) || view.canScrollVertically(-1)) view else null
    }

    private fun containsInteractiveControl(view: View, x: Float, y: Float, depth: Int = 0): Boolean {
      if (depth > 64 || !view.isShown || view.alpha <= 0.001f || view.width <= 0 || view.height <= 0) return false
      view.getLocationOnScreen(location)
      if (x < location[0] || x >= location[0] + view.width || y < location[1] || y >= location[1] + view.height) return false
      if (view is LiquidGlassInteractiveControl || view is AbsSeekBar || view is CompoundButton) return true
      if (view is ViewGroup) for (index in view.childCount - 1 downTo 0) {
        if (containsInteractiveControl(view.getChildAt(index), x, y, depth + 1)) return true
      }
      return false
    }

    private fun reset() {
      gesture = null
      touch?.reset()
      scroll?.reset()
    }

    private fun hasActiveWindow(): Boolean {
      val host = owner?.get() ?: return false
      val decor = window.get()?.decorView ?: return false
      return host.isAttachedToWindow && host.windowVisibility == View.VISIBLE &&
        decor.windowVisibility == View.VISIBLE && decor.hasWindowFocus()
    }

    fun close() {
      if (closed) return
      closed = true
      observer?.takeIf { it.isAlive }?.removeOnScrollChangedListener(scrollListener)
      observer = null
      window.get()?.let { if (it.callback === callback) it.callback = delegate }
      owner = null
      progress = null
      intent = null
      reset()
    }
  }
}
