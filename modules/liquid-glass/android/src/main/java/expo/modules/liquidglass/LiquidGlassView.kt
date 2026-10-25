package expo.modules.liquidglass

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.view.MotionEvent
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.Canvas as ComposeCanvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.LayoutDirection
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.rememberCanvasBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.colorControls
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.highlight.HighlightStyle
import com.kyant.backdrop.shadow.Shadow
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import kotlin.math.roundToInt
import kotlin.math.abs
import kotlin.math.ceil
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Background-only host: all taps and accessibility remain with the RN control. */
open class LiquidGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ReactPointerEventsView {
  override val shouldUseAndroidLayout = true
  // RN and RNGH choose targets before dispatchTouchEvent. This decorative
  // native host must be skipped even where its fixed bounds exceed the glass.
  override open val pointerEvents: PointerEvents = PointerEvents.NONE

  internal var radius by mutableFloatStateOf(0f)
  internal var radiusTopLeft: Float? by mutableStateOf(null)
  internal var radiusTopRight: Float? by mutableStateOf(null)
  internal var radiusBottomLeft: Float? by mutableStateOf(null)
  internal var radiusBottomRight: Float? by mutableStateOf(null)
  internal var materialPreset by mutableStateOf("button")
  internal var blurRadius by mutableFloatStateOf(2f)
  internal var progressiveBlur by mutableStateOf(false)
    private set
  internal var preferUnblurredBackdrop by mutableStateOf(false)
    private set
  internal var isolateModalForeground = false
    private set
  internal var refraction by mutableFloatStateOf(24f)
  internal var refractionHeight: Float? by mutableStateOf(null)
  internal var highlightWidth by mutableFloatStateOf(0.5f)
  internal var highlightOpacity: Float? by mutableStateOf(null)
  internal var depthEffect by mutableStateOf(false)
  internal var chromaticAberration by mutableStateOf(false)
  internal var tintColor by mutableIntStateOf(AndroidColor.TRANSPARENT)
  internal var tintOpacity by mutableFloatStateOf(0f)
  internal var dark by mutableStateOf(false)
  internal var staticBackdropColor: Int? by mutableStateOf(null)
    private set
  /** Local opaque/control drawing may safely remain in another material's source. */
  protected open val suppressDuringBackdropCapture: Boolean get() = staticBackdropColor == null
  // Only the complete bottom navigation opts into this interactive material.
  // Reanimated updates these on the UI thread; the shared capture is unchanged.
  internal var tabsCount by mutableIntStateOf(0)
  internal var tabHorizontalInset by mutableFloatStateOf(12f)
  internal var tabVerticalInset by mutableFloatStateOf(4f)
  internal var tabPosition by mutableFloatStateOf(0f)
  internal var tabPressProgress by mutableFloatStateOf(0f)
  internal var tabScaleX by mutableFloatStateOf(1f)
  internal var tabScaleY by mutableFloatStateOf(1f)
  internal var tabVelocity by mutableFloatStateOf(0f)
  internal var tabPanelOffset by mutableFloatStateOf(0f)
  internal var tabSelectionOpacity by mutableFloatStateOf(1f)
  internal var dockCompactWidth by mutableFloatStateOf(0f)
    private set
  internal var dockRole by mutableStateOf("mini")
  internal var dockRowWidth by mutableFloatStateOf(0f)
  internal var dockExpandedHeight by mutableFloatStateOf(0f)
  internal var dockCompactHeight by mutableFloatStateOf(0f)
  internal var dockCompactOffsetX by mutableFloatStateOf(0f)
  internal var dockProgress by mutableFloatStateOf(0f)
  internal var buttonPressProgress by mutableFloatStateOf(0f)
  internal var buttonPressX by mutableFloatStateOf(0f)
  internal var buttonPressY by mutableFloatStateOf(0f)
  internal var glassEnabled by mutableStateOf(true)
    private set

  private var frameVersion by mutableIntStateOf(0)
  private var geometryVersion by mutableIntStateOf(0)
  private var snapshot: WindowBackdrop? = null
  private var needsDisplayListRestore = true
  private var motionHostToken = 0
  private val onMotionHostReady by EventDispatcher()
  private val samplePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val sampleLocation = IntArray(2)
  private val sampleRootLocation = IntArray(2)
  private val sampleSourceRect = Rect()
  private val sampleDestinationRect = RectF()
  private val progressiveOverlay = ProgressiveBlurOverlayCache()
  // Written by the native-only material layout; all backdrop consumers sample
  // from this physical origin, including the smaller selected-tab canvas.
  private var materialOffsetX = 0
  private var materialOffsetY = 0
  private var materialWidth = 0
  private var materialHeight = 0
  internal val progressiveMaterialId = System.identityHashCode(this)

  internal fun setProgressiveBlurEnabled(enabled: Boolean) {
    if (progressiveBlur == enabled) return
    progressiveBlur = enabled
    snapshot?.onMaterialChanged()
  }

  internal fun setPreferUnblurredBackdrop(enabled: Boolean) {
    if (preferUnblurredBackdrop == enabled) return
    preferUnblurredBackdrop = enabled
    snapshot?.onMaterialChanged()
  }

  internal fun setIsolateModalForeground(enabled: Boolean) {
    if (isolateModalForeground == enabled) return
    isolateModalForeground = enabled
    snapshot?.onMaterialChanged()
  }

  internal fun updateBlurRadius(value: Float) {
    if (blurRadius == value) return
    blurRadius = value
    if (progressiveBlur || preferUnblurredBackdrop) snapshot?.onMaterialChanged()
  }

  internal fun updateRefraction(value: Float) {
    if (refraction == value) return
    refraction = value
    if (preferUnblurredBackdrop) snapshot?.onMaterialChanged()
  }

  internal fun updateRefractionHeight(value: Float?) {
    if (refractionHeight == value) return
    refractionHeight = value
    if (preferUnblurredBackdrop) snapshot?.onMaterialChanged()
  }

  internal fun updateTintColor(value: Int) {
    if (tintColor == value) return
    tintColor = value
    if (progressiveBlur) snapshot?.onMaterialChanged()
  }

  internal fun updateTintOpacity(value: Float) {
    if (tintOpacity == value) return
    tintOpacity = value
    if (progressiveBlur) snapshot?.onMaterialChanged()
  }

  internal fun updateStaticBackdropColor(value: Int?) {
    if (staticBackdropColor == value) return
    staticBackdropColor = value
    if (isAttachedToWindow) {
      if (value == null) attachBackdrop() else detachBackdrop()
    }
  }

  /** Actual physical child bounds, rather than the fixed RN host. */
  internal fun getMaterialBoundsOnScreen(bounds: Rect) {
    getLocationOnScreen(sampleLocation)
    bounds.set(sampleLocation[0] + materialOffsetX, sampleLocation[1] + materialOffsetY,
      sampleLocation[0] + materialOffsetX + if (materialWidth > 0) materialWidth else width,
      sampleLocation[1] + materialOffsetY + if (materialHeight > 0) materialHeight else height)
  }

  private fun isProgressiveFrameCurrent(captured: BackdropFrame): Boolean {
    val stamp = captured.progressiveBlur ?: return false
    return stamp.materialId == progressiveMaterialId && stamp.blurRadius == blurRadius &&
      stamp.tintColor == tintColor && stamp.tintOpacity == tintOpacity
  }

  private fun drawCapturedBackdrop(canvas: Canvas, captured: BackdropFrame, originX: Int, originY: Int) {
    val patch = if (preferUnblurredBackdrop &&
      captured.unblurredPatch?.materialId == progressiveMaterialId) captured.unblurredPatch else null
    val childWidth = if (materialWidth > 0) materialWidth else width
    val childHeight = if (materialHeight > 0) materialHeight else height
    // Geometry can advance while a GPU image is in flight. If the current
    // child is outside this frozen ROI, sample the processed main region until
    // a covering patch arrives. Never stretch or sample adjacent atlas rows.
    val useRaw = if (patch != null) {
      val padding = ceil((blurRadius * 2f + abs(refraction) +
        abs(refractionHeight ?: (refraction * 0.65f))) * resources.displayMetrics.density).toInt()
      rootView.getLocationOnScreen(sampleRootLocation)
      val neededLeft = maxOf(sampleRootLocation[0], originX - padding)
      val neededTop = maxOf(sampleRootLocation[1], originY - padding)
      val neededRight = minOf(sampleRootLocation[0] + rootView.width, originX + childWidth + padding)
      val neededBottom = minOf(sampleRootLocation[1] + rootView.height, originY + childHeight + padding)
      neededLeft >= patch.screenX && neededTop >= patch.screenY &&
        neededRight <= patch.screenX + patch.pixelWidth / captured.scale &&
        neededBottom <= patch.screenY + patch.pixelHeight / captured.scale
    } else false
    // Follow the existing morph in drawing, without recomposing the material.
    // Keep an opaque processed base during the transition so blending the raw
    // patch cannot expose an empty backdrop or change the final source alpha.
    val progress = if (useRaw && dockCompactWidth > 0f) dockProgress.coerceIn(0f, 1f) else 0f
    val previousAlpha = samplePaint.alpha
    val previousShader = samplePaint.shader
    try {
      samplePaint.shader = null
      if (!useRaw || progress > 0f) {
        sampleSourceRect.set(0, 0, captured.mainPixelWidth, captured.mainPixelHeight)
        val left = (captured.screenX - originX).toFloat()
        val top = (captured.screenY - originY).toFloat()
        sampleDestinationRect.set(left, top, left + captured.mainPixelWidth / captured.scale,
          top + captured.mainPixelHeight / captured.scale)
        samplePaint.alpha = 255
        drawCapturedRegion(canvas, captured)
      }
      if (useRaw && patch != null && progress < 1f) {
        sampleSourceRect.set(patch.atlasX, patch.atlasY,
          patch.atlasX + patch.pixelWidth, patch.atlasY + patch.pixelHeight)
        sampleDestinationRect.set(patch.screenX - originX, patch.screenY - originY,
          patch.screenX - originX + patch.pixelWidth / captured.scale,
          patch.screenY - originY + patch.pixelHeight / captured.scale)
        samplePaint.alpha = ((1f - progress) * 255f).roundToInt()
        drawCapturedRegion(canvas, captured)
      }
    } finally {
      samplePaint.alpha = previousAlpha
      samplePaint.shader = previousShader
    }
  }

  private fun drawCapturedRegion(canvas: Canvas, captured: BackdropFrame) {
    val checkpoint = canvas.save()
    try {
      canvas.clipRect(sampleDestinationRect)
      canvas.drawBitmap(captured.bitmap, sampleSourceRect, sampleDestinationRect, samplePaint)
    } finally { canvas.restoreToCount(checkpoint) }
  }

  protected val composeView = ComposeView(context).apply {
    id = View.generateViewId()
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    isClickable = false
    isFocusable = false
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
    setContent { GlassMaterial() }
  }

  init {
    isClickable = false
    isFocusable = false
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    clipChildren = false
    clipToPadding = false
    addView(composeView)
  }

  internal fun setGlassEnabled(enabled: Boolean) {
    if (glassEnabled == enabled) return
    glassEnabled = enabled
    if (isAttachedToWindow) {
      if (enabled) attachBackdrop() else detachBackdrop()
    }
  }

  internal fun setDockCompactWidth(value: Float) {
    val width = if (value.isFinite()) value.coerceIn(0f, 2000f) else 0f
    if (dockCompactWidth == width) return
    dockCompactWidth = width
    if (width == 0f) dockProgress = 0f
    if (isAttachedToWindow) post { if (isAttachedToWindow) syncMotionHost() }
  }

  private fun syncMotionHost() {
    if (tabsCount <= 0 && dockCompactWidth <= 0f) {
      if (motionHostToken != 0) TabsMotionHosts.detach(motionHostToken)
      motionHostToken = 0
      return
    }
    if (motionHostToken == 0) {
      motionHostToken = TabsMotionHosts.attach(this)
      onMotionHostReady(mapOf("hostId" to motionHostToken))
    }
  }

  private fun attachBackdrop() {
    if (!glassEnabled || staticBackdropColor != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S || snapshot != null) return
    snapshot = WindowBackdrops.attach(this, appContext.currentActivity?.window?.decorView)
  }

  private fun detachBackdrop() {
    progressiveOverlay.clear()
    snapshot?.let { WindowBackdrops.detach(this, it) }
    snapshot = null
    frameVersion++
  }

  override fun onAttachedToWindow() {
    needsDisplayListRestore = true
    // Dialog windows do not necessarily inherit these owners. Pin to the
    // Activity, matching Expo's own Compose host, including RN-screens swaps.
    val activity = appContext.currentActivity
    if (activity is LifecycleOwner && activity is SavedStateRegistryOwner) {
      composeView.setViewTreeLifecycleOwner(activity)
      composeView.setViewTreeSavedStateRegistryOwner(activity)
    }
    super.onAttachedToWindow()
    attachBackdrop()
    // ViewGroup attaches its children after this callback. Re-measure on the
    // next UI turn, once Compose can safely obtain its window Recomposer.
    post {
      if (isAttachedToWindow && composeView.isAttachedToWindow) {
        measureAndLayout()
        syncMotionHost()
      }
    }
  }

  override fun onDetachedFromWindow() {
    if (motionHostToken != 0) TabsMotionHosts.detach(motionHostToken)
    motionHostToken = 0
    detachBackdrop()
    super.onDetachedFromWindow()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Fabric updates Yoga layout even while removeClippedSubviews has detached
    // a row. ComposeView.onMeasure creates a composition; after detachment its
    // prior composition is disposed and there is no window Recomposer yet.
    // The host's size is already fixed by Yoga, so defer child measurement.
    if (!isAttachedToWindow || !composeView.isAttachedToWindow) {
      setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
      return
    }
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    if (!composeView.isAttachedToWindow) return
    super.onLayout(changed, left, top, right, bottom)
    composeView.layout(0, 0, width, height)
  }

  override open fun dispatchTouchEvent(event: MotionEvent): Boolean = false

  override fun dispatchDraw(canvas: Canvas) {
    // Also prevents nested capture if a wrapper was flattened by React Native.
    if (WindowBackdrops.isCapturing && suppressDuringBackdropCapture) {
      needsDisplayListRestore = true
      WindowBackdrops.onHostSuppressed(this)
      return
    }
    super.dispatchDraw(canvas)
    needsDisplayListRestore = false
  }

  internal fun onBackdropFrame(): Boolean {
    frameVersion++
    // The first draw has no Compose state observer yet. Normal image delivery
    // uses drawing state alone; a capture restores suppressed hosts immediately.
    return restoreDisplayListAfterCapture()
  }

  /** Called after the window has applied one batch of frame drawing changes. */
  internal fun invalidateBackdropDrawing() {
    composeView.invalidate()
    invalidate()
  }

  internal fun restoreDisplayListAfterCapture(): Boolean {
    if (needsDisplayListRestore) {
      needsDisplayListRestore = false
      composeView.invalidate()
      invalidate()
      return true
    }
    return false
  }

  /** A translated RN parent does not relayout Compose or invalidate its cached backdrop. */
  internal fun onBackdropGeometryChanged() {
    geometryVersion++
    // Called before drawing the moving menu: reuse the existing image at the
    // current screen origin instead of waiting for asynchronous capture delivery.
    // WindowBackdrop applies all changed materials' drawing observers once,
    // before this pre-draw finishes, so they cannot lag the parent transform.
    composeView.invalidate()
    invalidate()
  }

  @Composable
  private fun GlassMaterial() {
    val cornerRadius = radius
    val topLeft = radiusTopLeft ?: cornerRadius
    val topRight = radiusTopRight ?: cornerRadius
    val bottomLeft = radiusBottomLeft ?: cornerRadius
    val bottomRight = radiusBottomRight ?: cornerRadius
    val isLtr = LocalLayoutDirection.current == LayoutDirection.Ltr
    val glassBlur = blurRadius
    val isProgressiveBlur = progressiveBlur
    val glassRefraction = refraction
    val tint = Color(tintColor)
    val opacity = tintOpacity
    val isDark = dark
    val staticBackground = staticBackdropColor
    val enabled = glassEnabled
    val preset = materialPreset
    val amPlusMaterial = preset == "amPlus"
    val amPlusButtonHighlight = if (amPlusMaterial && tabsCount == 0)
      remember { AmPlusInteractiveHighlight() } else null
    val officialMaterial = preset != "custom"
    val dialogMaterial = preset == "dialog"
    val glassRefractionHeight = refractionHeight ?: if (officialMaterial) 12f else glassRefraction * 0.65f
    val glassHighlightWidth = highlightWidth
    val glassHighlightOpacity = highlightOpacity ?: if (officialMaterial) 1f else if (isDark) 0.28f else 0.20f
    val glassDepthEffect = depthEffect
    val glassChromaticAberration = chromaticAberration
    val backdrop = rememberCanvasBackdrop {
      // Read in drawing, so a capture only invalidates drawing, not RN layout.
      @Suppress("UNUSED_VARIABLE") val version = frameVersion
      @Suppress("UNUSED_VARIABLE") val geometry = geometryVersion
      val captured = snapshot?.frame
      if (enabled && staticBackground != null) {
        // Settings cards sit over a declared flat page color. Keeping the
        // identical source local avoids capturing/repositioning a whole page
        // merely to blur and refract the same uniform color while scrolling.
        drawRect(Color(staticBackground))
      } else if (enabled && captured != null && (!isProgressiveBlur || isProgressiveFrameCurrent(captured))) {
        getLocationOnScreen(sampleLocation)
        drawIntoCanvas { composeCanvas ->
          drawCapturedBackdrop(composeCanvas.nativeCanvas, captured,
            sampleLocation[0] + materialOffsetX, sampleLocation[1] + materialOffsetY)
        }
      }
    }
    if (RenderInteractiveControl(backdrop)) return
    DockMaterialLayout {
      if (isProgressiveBlur) {
        // The producer's edge region is fully blurred; only this final alpha
        // fades it over the live page. There is no copied sharp page overlay.
        ComposeCanvas(Modifier.fillMaxSize()) {
          @Suppress("UNUSED_VARIABLE") val version = frameVersion
          @Suppress("UNUSED_VARIABLE") val geometry = geometryVersion
          val captured = snapshot?.frame
          if (enabled && captured != null && isProgressiveFrameCurrent(captured)) {
            val stamp = captured.progressiveBlur!!
            getLocationOnScreen(sampleLocation)
            val originX = sampleLocation[0] + materialOffsetX
            val originY = sampleLocation[1] + materialOffsetY
            val stampTop = (stamp.screenY - originY).toFloat()
            drawIntoCanvas { composeCanvas ->
              val canvas = composeCanvas.nativeCanvas
              val checkpoint = canvas.save()
              try {
                // Canvas does not automatically clip its drawing scope. The
                // shared ROI may contain padding or even an entire old page.
                canvas.clipRect(0f, 0f, size.width, size.height)
                canvas.clipRect(0f, stampTop, size.width, stampTop + stamp.materialHeight)
                samplePaint.shader = progressiveOverlay.get(captured, originX, originY, size.height)
                canvas.drawRect(0f, 0f, size.width, size.height, samplePaint)
              } finally {
                samplePaint.shader = null
                canvas.restoreToCount(checkpoint)
              }
            }
          } else progressiveOverlay.clear()
        }
      } else if (tabsCount > 0) {
        LiquidBottomTabsMaterial(
          backdrop = backdrop,
          tabsCount = tabsCount,
          horizontalInset = tabHorizontalInset,
          verticalInset = tabVerticalInset,
          position = { tabPosition },
          pressProgress = { tabPressProgress },
          pressedScaleX = { tabScaleX },
          pressedScaleY = { tabScaleY },
          velocity = { tabVelocity },
          panelOffset = { tabPanelOffset },
          selectionOpacity = { tabSelectionOpacity },
          officialMaterial = officialMaterial,
          amPlusMaterial = amPlusMaterial,
          dockProgress = { dockProgress },
          blurRadius = if (enabled) glassBlur else 0f,
          refraction = if (enabled) glassRefraction else 0f,
          refractionHeight = if (enabled) glassRefractionHeight else 0f,
          highlightWidth = glassHighlightWidth,
          highlightOpacity = glassHighlightOpacity,
          depthEffect = glassDepthEffect,
          chromaticAberration = glassChromaticAberration,
          tint = tint,
          tintOpacity = { if (enabled && (officialMaterial || staticBackground != null || snapshot?.frame != null)) opacity else maxOf(opacity, 0.82f) },
          dark = isDark
        )
      } else {
        Box(
          Modifier.fillMaxSize().drawBackdrop(
            backdrop = backdrop,
            shape = {
              // The JS API names physical corners. Mapping them to start/end lets
              // Backdrop's lens and Compose's outline agree in RTL as well as LTR.
              if (amPlusMaterial) RoundedCornerShape(50) else RoundedCornerShape(
                topStart = (if (isLtr) topLeft else topRight).dp,
                topEnd = (if (isLtr) topRight else topLeft).dp,
                bottomEnd = (if (isLtr) bottomRight else bottomLeft).dp,
                bottomStart = (if (isLtr) bottomLeft else bottomRight).dp
              )
            },
            effects = {
              if (enabled) {
                if (dialogMaterial) {
                  colorControls(brightness = if (isDark) 0f else 0.2f, saturation = 1.5f)
                } else {
                  vibrancy()
                }
                blur(glassBlur.dp.toPx())
                val edge = if (amPlusMaterial && glassRefraction > 0f && glassRefractionHeight > 0f)
                  AmPlusDockGeometry.edgeLens(size.height, size.width, 24f.dp.toPx()) else 0f
                lens(
                  if (amPlusMaterial) edge else glassRefractionHeight.dp.toPx(),
                  if (amPlusMaterial) edge else glassRefraction.dp.toPx(),
                  depthEffect = !amPlusMaterial && glassDepthEffect,
                  chromaticAberration = !amPlusMaterial && glassChromaticAberration
                )
              }
            },
            highlight = {
              when {
                dialogMaterial -> Highlight(style = HighlightStyle.Plain)
                officialMaterial -> Highlight.Default
                else -> Highlight(width = glassHighlightWidth.dp, alpha = glassHighlightOpacity)
              }
            },
            shadow = if (officialMaterial) ({ Shadow.Default }) else null,
            onDrawSurface = {
              // API 31/32 retain true background blur, but Android's shader lens
              // and directional highlight require API 33 (handled by Backdrop).
              val hasFrame = staticBackground != null || snapshot?.frame != null
              // A page boundary briefly has no image. Official materials keep
              // their own surface alpha rather than flashing the old .82 fill.
              val materialOpacity = if (enabled && (officialMaterial || hasFrame)) opacity else maxOf(opacity, 0.82f)
              if (preset == "button" && opacity > 0f) {
                // LiquidButton's optional tint: hue blend followed by its
                // exact catalog .75 surface alpha. Untinted remains clear.
                drawRect(tint, blendMode = BlendMode.Hue)
                drawRect(tint.copy(alpha = 0.75f))
              } else {
                // Other materials preserve their surface's own RGBA alpha.
                drawRect(tint.copy(alpha = materialOpacity * tint.alpha))
              }
            },
            onDrawFront = {
              if (amPlusButtonHighlight != null && dockRole == "mini") {
                with(amPlusButtonHighlight) {
                  draw(buttonPressProgress,
                    Offset(buttonPressX.dp.toPx() - materialOffsetX, buttonPressY.dp.toPx() - materialOffsetY))
                }
              }
            }
          )
        )
      }
    }
  }

  /** Interactive catalog controls reuse this host's shared capture and lifecycle. */
  @Composable
  protected open fun RenderInteractiveControl(backdrop: Backdrop): Boolean = false

  @Composable
  private fun DockMaterialLayout(content: @Composable () -> Unit) {
    // Only this one Compose drawing child is measured during a morph. The RN
    // host and its labels, buttons and accessibility bounds keep fixed layout.
    // Read progress in measurement, never the root composition/drawing setup.
    Layout(content = content, modifier = Modifier.fillMaxSize()) { measurables, constraints ->
      val fullWidth = constraints.maxWidth
      val fullHeight = constraints.maxHeight
      val enabled = dockCompactWidth > 0f
      val amPlus = materialPreset == "amPlus"
      val progress = if (!enabled) 0f else if (amPlus) AmPlusDockGeometry.rawProgress(dockProgress)
        else dockProgress.coerceIn(0f, 1f)
      val targetWidth = if (enabled) dockCompactWidth.dp.roundToPx().coerceIn(0, fullWidth) else fullWidth
      // The background edge may grow during collapse. Its RN host reserves
      // the larger endpoint while other controls still start at full height.
      val expandedHeight = if (enabled && dockExpandedHeight > 0f)
        dockExpandedHeight.dp.roundToPx().coerceIn(0, fullHeight) else fullHeight
      val targetHeight = if (enabled && dockCompactHeight > 0f)
        dockCompactHeight.dp.roundToPx().coerceIn(0, fullHeight) else fullHeight
      val role = if (tabsCount > 0) "navigation" else dockRole
      val rowWidth = if (dockRowWidth > 0f) dockRowWidth.dp.toPx() else fullWidth.toFloat()
      val materialWidth = (if (amPlus && enabled) {
        if (role == "mini") AmPlusDockGeometry.miniWidth(fullWidth.toFloat(), targetWidth.toFloat(), progress)
        else AmPlusDockGeometry.sideWidth(fullWidth.toFloat(), targetWidth.toFloat(), rowWidth, progress, 8f.dp.toPx())
      } else fullWidth + (targetWidth - fullWidth) * progress).roundToInt().coerceAtLeast(0)
      val materialHeight = (if (amPlus && enabled)
        AmPlusDockGeometry.height(expandedHeight.toFloat(), targetHeight.toFloat(), progress)
        else expandedHeight + (targetHeight - expandedHeight) * progress).roundToInt().coerceAtLeast(0)
      val offsetX = if (amPlus && enabled) AmPlusDockGeometry.left(role, fullWidth.toFloat(),
        materialWidth.toFloat(), dockCompactOffsetX.dp.toPx(), progress).roundToInt()
        else (dockCompactOffsetX.dp.toPx() * progress).roundToInt()
          .coerceIn(0, (fullWidth - materialWidth).coerceAtLeast(0))
      val offsetY = if (amPlus && enabled) AmPlusDockGeometry.top(role, fullHeight.toFloat(),
        expandedHeight.toFloat(), targetHeight.toFloat(), materialHeight.toFloat(), progress).roundToInt()
        else fullHeight - materialHeight
      val materialChanged = materialOffsetX != offsetX || materialOffsetY != offsetY ||
        this@LiquidGlassView.materialWidth != materialWidth || this@LiquidGlassView.materialHeight != materialHeight
      materialOffsetX = offsetX
      materialOffsetY = offsetY
      this@LiquidGlassView.materialWidth = materialWidth
      this@LiquidGlassView.materialHeight = materialHeight
      if (materialChanged && (progressiveBlur || preferUnblurredBackdrop)) snapshot?.onMaterialChanged()
      val child = measurables.single().measure(Constraints.fixed(materialWidth, materialHeight))
      layout(fullWidth, fullHeight) { child.place(offsetX, offsetY) }
    }
  }
}
