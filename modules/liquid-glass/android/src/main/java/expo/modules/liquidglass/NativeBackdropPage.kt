package expo.modules.liquidglass

import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import com.facebook.react.uimanager.util.ReactFindViewUtil
import com.swmansion.rnscreens.Screen
import com.swmansion.rnscreens.ScreenContainer
import com.swmansion.rnscreens.ScreenStack
import java.lang.ref.WeakReference

/** Reads cached navigation containers, including the active tab, during steady drawing. */
internal class NativeBackdropPage {
  val policy = BackdropPageEpoch()
  private var sourceReference: WeakReference<View>? = null
  private var stackReference: WeakReference<ScreenStack>? = null
  private var observedTopReference: WeakReference<Screen>? = null
  private var childContainerReference: WeakReference<ScreenContainer>? = null
  private var searchedChildContainer = false
  private var childDiscoveryObserver: ViewTreeObserver? = null
  private val childDiscoveryLayoutListener = ViewTreeObserver.OnGlobalLayoutListener {
    // A drawable outer Screen can precede its nested navigator's mount. Only
    // permit another discovery here; the next pre-draw performs the actual DFS.
    searchedChildContainer = false
  }
  private var searchedSource = false
  private val visibleRect = Rect()

  /** A newly attached material can arrive while the content hierarchy is mounting. */
  fun retryMissingStack() {
    if (stackReference?.get() == null) searchedSource = false
    if (childContainerReference?.get() == null) searchedChildContainer = false
  }

  fun observe(source: View): Boolean {
    val stack = findStack(source)
    if (stack == null) {
      stopChildDiscoveryObservation()
      observedTopReference = null
      childContainerReference = null
      searchedChildContainer = false
      // Ordinary non-navigation roots retain their original capture behavior.
      return policy.observe(source, isDrawable(source, source))
    }
    // ScreenStack assigns its new top before committing the Fragment swap.
    // If that top has not attached/laid out, pause instead of sampling the
    // outgoing screen and incorrectly stamping it as the new page.
    val top = stack.topScreen
    if (top == null || observedTopReference?.get() !== top) {
      stopChildDiscoveryObservation()
      observedTopReference = top?.let { WeakReference(it) }
      childContainerReference = null
      searchedChildContainer = false
    }
    val outerReady = top != null && isDrawable(top, source)
    val childContainer = top?.let { findChildContainer(it, outerReady) }
    if (childContainer != null) {
      // Bottom tabs change this ON_TOP identity while their outer Stack page
      // remains attached. A selected tab can precede its Fragment attachment;
      // block capture then instead of stamping outgoing pixels as the new tab.
      val child = childContainer.topScreen
      return policy.observe(top, outerReady && child != null && isDrawable(child, source), child)
    }
    return policy.observe(top, outerReady)
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

  private fun findChildContainer(top: Screen, ready: Boolean): ScreenContainer? {
    val cached = childContainerReference?.get()
    // Keep reading a cached container during a temporary detach. Readiness of
    // its selected child, not a fallback outer identity, controls capture then.
    if (cached != null && isDescendantOf(cached, top)) {
      stopChildDiscoveryObservation()
      return cached
    }
    if (childContainerReference != null) {
      childContainerReference = null
      searchedChildContainer = false
    }
    observeMissingChildLayouts(top)
    // Discover once after this outer page becomes drawable. A negative result
    // is retried only after a global layout, a parent change or replacement,
    // never just because another animation frame was drawn.
    if (!ready || searchedChildContainer) return null
    searchedChildContainer = true
    val found = findOutermostChildContainer(top)
    childContainerReference = found?.let { WeakReference(it) }
    if (found != null) stopChildDiscoveryObservation()
    return found
  }

  private fun observeMissingChildLayouts(top: Screen) {
    val observer = top.viewTreeObserver
    if (observer === childDiscoveryObserver && observer.isAlive) return
    // A detached view's floating observer dies when merged into the window's
    // observer. Migrate the listener and allow one discovery on that new tree.
    stopChildDiscoveryObservation()
    searchedChildContainer = false
    if (observer.isAlive) {
      // Android may have merged the listener from a now-dead floating VTO.
      // Remove that migrated registration before attaching it to this tree.
      observer.removeOnGlobalLayoutListener(childDiscoveryLayoutListener)
      observer.addOnGlobalLayoutListener(childDiscoveryLayoutListener)
      childDiscoveryObserver = observer
    }
  }

  private fun stopChildDiscoveryObservation() {
    val previous = childDiscoveryObserver
    if (previous != null) {
      val live = previous.takeIf { it.isAlive }
        ?: observedTopReference?.get()?.viewTreeObserver?.takeIf { it.isAlive }
      live?.removeOnGlobalLayoutListener(childDiscoveryLayoutListener)
    }
    childDiscoveryObserver = null
  }

  private fun findOutermostChildContainer(view: View): ScreenContainer? {
    if (view is ScreenContainer) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findOutermostChildContainer(view.getChildAt(index))?.let { return it }
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
    stopChildDiscoveryObservation()
    sourceReference = null
    stackReference = null
    observedTopReference = null
    childContainerReference = null
    searchedChildContainer = false
    searchedSource = false
    policy.observe(null, false)
  }

  private companion object {
    const val CONTENT_NATIVE_ID = "resonus-glass-content"
  }
}
