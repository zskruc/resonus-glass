package expo.modules.highrefresh

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewTreeObserver
import android.view.Window
import android.view.WindowManager
import android.view.inspector.WindowInspector

/**
 * Keep the foreground app's UI on its requested 120 Hz cadence. Android 15+
 * otherwise votes many RN/Compose redraws as "Normal" (usually 60 Hz) once the
 * temporary touch/launch boost ends. This policy belongs to app windows rather
 * than a tab or glass view, so navigation cannot drop it or leave it behind.
 *
 * Discovery is event driven: resume, window focus/attach, and layout. There is
 * no polling, perpetual invalidation, wake lock, or modification of user/system
 * refresh settings. Android still owns thermal, power-save and hardware limits.
 */
object HighRefresh : Application.ActivityLifecycleCallbacks {
  private val handler = Handler(Looper.getMainLooper())
  private val resumed = mutableSetOf<Activity>()
  private val roots = mutableMapOf<View, RootState>()
  private val extraWindows = mutableSetOf<Window>()
  private var application: Application? = null
  private var syncScheduled = false
  private val sync = Runnable {
    syncScheduled = false
    syncWindows()
  }

  @JvmStatic
  fun install(app: Application) {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (application != null) return
    application = app
    app.registerActivityLifecycleCallbacks(this)
  }

  private fun scheduleSync() {
    if (resumed.isEmpty() || syncScheduled) return
    syncScheduled = true
    handler.post(sync)
  }

  private fun observe(root: View, window: Window? = null): RootState = roots.getOrPut(root) {
    RootState(root).also { it.observe() }
  }.also { if (window != null) it.bind(window) }

  internal fun onExtraWindowCreate(window: Window) {
    extraWindows.add(window)
    if (resumed.isNotEmpty()) observe(window.decorView, window).request()
    scheduleSync()
  }

  internal fun onExtraWindowDestroy(window: Window) {
    extraWindows.remove(window)
    roots.remove(window.decorView)?.release()
    scheduleSync()
  }

  private fun syncWindows() {
    if (resumed.isEmpty()) return
    val appPackage = application?.packageName ?: return
    val current = resumed.mapTo(mutableSetOf()) { it.window.decorView }
    current.addAll(extraWindows.map { it.decorView })
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // Includes RN Modal Dialogs and popup windows. Watching only the
      // Activity would leave those windows on Android's default 60 Hz policy.
      current.addAll(WindowInspector.getGlobalWindowViews().filter {
        it.context.applicationContext?.packageName == appPackage
      })
    }
    roots.keys.filter { it !in current }.toList().forEach { root ->
      roots.remove(root)?.release()
    }
    current.forEach { observe(it).request() }
  }

  private class RootState(private val root: View) : View.OnAttachStateChangeListener,
    ViewTreeObserver.OnGlobalLayoutListener, ViewTreeObserver.OnWindowFocusChangeListener {
    private var original: RefreshPreferences? = null
    private var observer: ViewTreeObserver? = null
    private var window: Window? = null
    private var lastUpdateFailure: String? = null

    fun bind(value: Window) { window = value }

    private fun parameters() = window?.attributes ?: root.layoutParams as? WindowManager.LayoutParams

    fun observe() {
      root.addOnAttachStateChangeListener(this)
      observeTree()
    }

    private fun observeTree() {
      val tree = root.viewTreeObserver
      if (observer === tree) return
      unobserveTree()
      observer = tree
      tree.addOnGlobalLayoutListener(this)
      tree.addOnWindowFocusChangeListener(this)
    }

    private fun unobserveTree() {
      observer?.takeIf { it.isAlive }?.let {
        it.removeOnGlobalLayoutListener(this)
        it.removeOnWindowFocusChangeListener(this)
      }
      observer = null
    }

    fun request() {
      if (!HighRefreshPolicy.isEligible(
          resumed.size, root.isAttachedToWindow,
          root.visibility == View.VISIBLE && root.windowVisibility == View.VISIBLE,
        )) return
      val params = parameters() ?: return
      val current = params.preferences()
      val before = original ?: current.also { original = it }
      update(params, HighRefreshPolicy.foreground(before))
    }

    private fun update(params: WindowManager.LayoutParams, desired: RefreshPreferences) {
      val applied = (root.layoutParams as? WindowManager.LayoutParams)?.preferences()
      if (params.preferences() == desired && (!root.isAttachedToWindow || applied == desired)) return
      val next = WindowManager.LayoutParams().apply {
        copyFrom(params)
        preferredRefreshRate = desired.refreshRate
        preferredDisplayModeId = desired.displayModeId
        if (Build.VERSION.SDK_INT >= 35 && desired.balancedPowerSavings != null) {
          isFrameRatePowerSavingsBalanced = desired.balancedPowerSavings
        }
      }
      // A window may detach between discovery and this layout update. Its
      // Activity lifecycle will reapply on the next attach/resume if needed.
      runCatching {
        val ownedWindow = window
        if (ownedWindow != null) {
          // Keep Window.attributes in sync, so a later native flags/status-bar
          // update cannot silently replace the decor's request with old values.
          ownedWindow.attributes = next
        } else if (root.isAttachedToWindow) {
          val manager = root.context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
          manager.updateViewLayout(root, next)
        } else {
          // Reused dialog decor views must not retain our foreground vote
          // after detachment, or their next attach would save 120 as baseline.
          root.layoutParams = next
        }
      }.onSuccess { lastUpdateFailure = null }
        .onFailure { lastUpdateFailure = it.javaClass.simpleName }
    }

    fun release() {
      unobserveTree()
      root.removeOnAttachStateChangeListener(this)
      original?.let { before ->
        val params = parameters()
        if (params != null) {
          update(params, HighRefreshPolicy.restore(before, params.preferences()))
        }
      }
      original = null
    }

    fun diagnostics(): Map<String, Any?> {
      val params = parameters()
      return mapOf(
        "root" to root.javaClass.simpleName,
        "attached" to root.isAttachedToWindow,
        "focused" to root.hasWindowFocus(),
        "displayHz" to root.display?.refreshRate,
        "requestedHz" to params?.preferredRefreshRate,
        "rootRequestedHz" to (root.layoutParams as? WindowManager.LayoutParams)?.preferredRefreshRate,
        "preferredDisplayModeId" to params?.preferredDisplayModeId,
        "balancedPowerSavings" to params?.preferences()?.balancedPowerSavings,
        "lastUpdateFailure" to lastUpdateFailure,
      )
    }

    override fun onGlobalLayout() = scheduleSync()
    override fun onWindowFocusChanged(hasFocus: Boolean) = scheduleSync()
    override fun onViewAttachedToWindow(view: View) {
      observeTree()
      scheduleSync()
    }
    override fun onViewDetachedFromWindow(view: View) {
      roots.remove(root)?.release()
      scheduleSync()
    }
  }

  private fun WindowManager.LayoutParams.preferences() = RefreshPreferences(
    refreshRate = preferredRefreshRate,
    displayModeId = preferredDisplayModeId,
    balancedPowerSavings = if (Build.VERSION.SDK_INT >= 35) isFrameRatePowerSavingsBalanced else null,
  )

  internal fun diagnostics(): Map<String, Any?> = mapOf(
    "targetHz" to HighRefreshPolicy.TARGET_HZ,
    "foregroundActivities" to resumed.size,
    "appWindows" to roots.values.map { it.diagnostics() },
  )

  override fun onActivityResumed(activity: Activity) {
    resumed.add(activity)
    // Observe before attachment as well, so the first decor attach requests
    // the policy even when it happens after onResume.
    observe(activity.window.decorView, activity.window).request()
    scheduleSync()
  }

  override fun onActivityPaused(activity: Activity) {
    resumed.remove(activity)
    if (resumed.isEmpty()) {
      handler.removeCallbacks(sync)
      syncScheduled = false
      roots.values.toList().forEach { it.release() }
      roots.clear()
    } else scheduleSync()
  }

  override fun onActivityDestroyed(activity: Activity) = onActivityPaused(activity)
  override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
  override fun onActivityStarted(activity: Activity) = Unit
  override fun onActivityStopped(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
}
