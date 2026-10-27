package expo.modules.liquidglass

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import android.os.Looper
import android.view.MotionEvent
import android.view.RoundedCorner
import android.view.View
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Decorative background only: fixed RN child layout, no player/content transform. */
class PlayerSurfaceClipView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ReactPointerEventsView {
  // RN and RNGH consult this before Android dispatchTouchEvent. Never let a
  // background mask, including its descendants, intercept player/mini controls.
  override val pointerEvents: PointerEvents get() = PointerEvents.NONE
  private val onClipHostReady by EventDispatcher()
  private val bounds = PlayerSurfaceClipBounds()
  private val clipRect = RectF()
  private val clipPath = Path()
  private var initialOpacity = 0f
  private var hostToken = 0

  init {
    alpha = 0f
    clipChildren = false
    clipToPadding = false
    isClickable = false
    isFocusable = false
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    setWillNotDraw(false)
  }

  internal fun setInitialOpacity(value: Double) {
    if (!value.isFinite()) return
    initialOpacity = value.coerceIn(0.0, 1.0).toFloat()
    if (!bounds.hasFrame) {
      val previousAlpha = alpha
      alpha = initialOpacity
      if (PlayerTransitionTrace.enabled && hostToken > 0 && (previousAlpha > 0f) != (alpha > 0f))
        PlayerTransitionTrace.clip("initialAlpha", hostToken, previousAlpha, alpha, bounds)
    }
  }

  internal fun updateClip(left: Double, top: Double, width: Double, height: Double,
    radius: Double, opacity: Double) {
    val changes = bounds.update(resources.displayMetrics.density, left, top, width, height, radius, opacity)
    if (changes == PlayerSurfaceClipBounds.INVALID || changes == 0) return
    if (changes and PlayerSurfaceClipBounds.ALPHA != 0) {
      val previousAlpha = alpha
      alpha = bounds.opacity
      if (PlayerTransitionTrace.enabled && (previousAlpha > 0f) != (alpha > 0f))
        PlayerTransitionTrace.clip("alpha", hostToken, previousAlpha, alpha, bounds)
    }
    if (changes and PlayerSurfaceClipBounds.CLIP != 0) {
      clipRect.set(bounds.left, bounds.top, bounds.right, bounds.bottom)
      clipPath.rewind()
      clipPath.addRoundRect(clipRect, bounds.radius, bounds.radius, Path.Direction.CW)
      invalidate()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (hostToken != 0) PlayerSurfaceClipHosts.detach(hostToken)
    bounds.clear()
    clipRect.setEmpty()
    clipPath.rewind()
    alpha = initialOpacity
    // Drop a cached display list from a previous attachment before it can be
    // made visible. The first fresh scalar frame will record its own clip.
    invalidate()
    hostToken = PlayerSurfaceClipHosts.attach(this)
    if (PlayerTransitionTrace.enabled) PlayerTransitionTrace.clip("attach", hostToken, 0f, alpha, bounds)
    onClipHostReady(mapOf("hostId" to hostToken, "cornerRadius" to attachmentCornerRadiusDp()))
  }

  /** Public display geometry, sampled once per attachment rather than per frame. */
  private fun attachmentCornerRadiusDp(): Float {
    if (Build.VERSION.SDK_INT < 31) return 0f
    val density = resources.displayMetrics.density
    if (!density.isFinite() || density <= 0f) return 0f
    val radius = rootWindowInsets?.getRoundedCorner(RoundedCorner.POSITION_TOP_LEFT)?.radius ?: 0
    return radius / density
  }

  override fun onDetachedFromWindow() {
    if (PlayerTransitionTrace.enabled) PlayerTransitionTrace.clip("detach", hostToken, alpha, 0f, bounds)
    PlayerSurfaceClipHosts.detach(hostToken)
    hostToken = 0
    bounds.clear()
    alpha = 0f
    super.onDetachedFromWindow()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Every child is RN-managed and measured separately by Fabric. Do not run
    // LinearLayout's column measurement or shrink background to animated clip.
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  @SuppressLint("MissingSuperCall")
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // Fabric owns child positions. Both host and background remain full-screen.
  }

  override fun draw(canvas: Canvas) {
    if (!bounds.hasFrame || clipRect.isEmpty) return
    val save = canvas.save()
    try {
      // Keep a hardware Canvas: TextureView's integrated texture layer obeys
      // this ancestor clip; do not request a software layer or a bitmap copy.
      canvas.clipPath(clipPath)
      super.draw(canvas)
    } finally {
      canvas.restoreToCount(save)
    }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean = false
}

/** No posted frame queue and no strong route/view ownership. */
internal object PlayerSurfaceClipHosts {
  private val registry = PlayerSurfaceClipRegistry<PlayerSurfaceClipView>()
  fun attach(view: PlayerSurfaceClipView): Int = registry.attach(view)
  fun detach(token: Int) = registry.detach(token)
  fun update(token: Int, left: Double, top: Double, width: Double, height: Double,
    radius: Double, opacity: Double) {
    if (Looper.myLooper() !== Looper.getMainLooper()) return
    val view = registry.get(token) ?: return
    if (view.isAttachedToWindow) view.updateClip(left, top, width, height, radius, opacity)
  }
}
