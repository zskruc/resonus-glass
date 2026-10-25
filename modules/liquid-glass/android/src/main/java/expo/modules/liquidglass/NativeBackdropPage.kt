package expo.modules.liquidglass

import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import com.facebook.react.uimanager.util.ReactFindViewUtil
import com.swmansion.rnscreens.Screen
import com.swmansion.rnscreens.ScreenStack
import java.lang.ref.WeakReference

/** Reads only the cached outer stack's current native page during steady drawing. */
internal class NativeBackdropPage {
  val policy = BackdropPageEpoch()
  private var sourceReference: WeakReference<View>? = null
  private var stackReference: WeakReference<ScreenStack>? = null
  private var observedTopReference: WeakReference<Screen>? = null
  private var searchedSource = false
  private val visibleRect = Rect()

  /** A newly attached material can arrive while the content hierarchy is mounting. */
  fun retryMissingStack() {
    if (stackReference?.get() == null) searchedSource = false
  }

  fun observe(source: View): Boolean {
    val stack = findStack(source)
    if (stack == null) {
      observedTopReference = null
      // Ordinary non-navigation roots retain their original capture behavior.
      return policy.observe(source, isDrawable(source, source))
    }
    // ScreenStack assigns its new top before committing the Fragment swap.
    // If that top has not attached/laid out, pause instead of sampling the
    // outgoing screen and incorrectly stamping it as the new page.
    val top = stack.topScreen
    if (observedTopReference?.get() !== top) {
      observedTopReference = top?.let { WeakReference(it) }
    }
    return policy.observe(top, top != null && isDrawable(top, source))
  }

  /**
   * A transitionless opaque page must not sample disappearing siblings retained
   * by ScreenStack. Use only the exact top whose identity/readiness we observed.
   * Player reveals, transparent presentations, and animations retain root capture.
   */
  fun isolatedOpaqueSource(): View? {
    val top = observedTopReference?.get() ?: return null
    if (stackReference?.get()?.topScreen !== top || !policy.allowsIsolatedSource(
        top.stackPresentation === Screen.StackPresentation.PUSH,
        top.stackAnimation === Screen.StackAnimation.NONE)) return null
    return top
  }

  private fun isDrawable(view: View, source: View): Boolean {
    if (!view.isAttachedToWindow || !view.isShown || view.width <= 0 || view.height <= 0 ||
      view.rootView !== source.rootView || !isDescendantOf(view, source)) return false
    var ancestor: View? = view
    while (ancestor != null) {
      if (ancestor.alpha <= 0f) return false
      ancestor = ancestor.parent as? View
    }
    return view.getGlobalVisibleRect(visibleRect)
  }

  private fun findStack(source: View): ScreenStack? {
    val cached = stackReference?.get()
    if (sourceReference?.get() === source && cached != null && cached.isAttachedToWindow &&
      cached.rootView === source.rootView && isDescendantOf(cached, source)) return cached
    // A cleared weak reference differs from a source that never had a Stack:
    // after an RN remount, rediscover once even if the old Stack was collected.
    if (sourceReference?.get() !== source || stackReference != null) {
      sourceReference = WeakReference(source)
      stackReference = null
      searchedSource = false
    }
    if (searchedSource) return null
    searchedSource = true
    // The content host excludes sibling bottom chrome and leads directly to
    // the root Stack. Never descend into a ScreenStack to pick a hidden nested
    // stack. This tree search occurs on discovery/replacement, not each frame.
    val host = ReactFindViewUtil.findView(source, CONTENT_NATIVE_ID) ?: source
    val found = findOutermostStack(host)
    stackReference = found?.let { WeakReference(it) }
    return found
  }

  private fun findOutermostStack(view: View): ScreenStack? {
    if (view is ScreenStack) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findOutermostStack(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }

  private fun isDescendantOf(view: View, source: View): Boolean {
    var current: View? = view
    while (current != null) {
      if (current === source) return true
      current = current.parent as? View
    }
    return false
  }

  fun clear() {
    sourceReference = null
    stackReference = null
    observedTopReference = null
    searchedSource = false
    policy.observe(null, false)
  }

  private companion object {
    const val CONTENT_NATIVE_ID = "resonus-glass-content"
  }
}
