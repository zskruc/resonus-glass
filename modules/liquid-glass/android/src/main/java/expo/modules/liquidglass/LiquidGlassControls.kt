/*
 * Toggle and slider adapted from Kyant0/AndroidLiquidGlass, revision 65ab177.
 * Copyright 2025 Kyant. Apache-2.0; see ANDROID_LIQUID_GLASS_LICENSE.
 * Modified for controlled Expo props, accessibility, disabled controls and a
 * shared window capture. Catalog geometry, springs and material defaults stay.
 */
package expo.modules.liquidglass

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
import com.facebook.react.uimanager.PointerEvents
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.emptyBackdrop
import com.kyant.backdrop.backdrops.rememberBackdrop
import com.kyant.backdrop.backdrops.rememberCombinedBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import androidx.compose.foundation.shape.RoundedCornerShape
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import kotlinx.coroutines.flow.collectLatest
import kotlin.math.abs
import kotlin.math.roundToInt

/** The catalog's opaque resting surface hides every optical effect underneath it. */
private fun restingCatalogThumb(): Modifier = Modifier.drawBackdrop(
  backdrop = emptyBackdrop(),
  shape = { RoundedCornerShape(percent = 50) },
  effects = {},
  highlight = null,
  // Preserve the exact catalog shadow, not Android elevation or a different blur.
  shadow = { Shadow(radius = 4f.dp, color = Color.Black.copy(alpha = 0.05f)) },
  onDrawSurface = { drawRect(Color.White) }
)

/** Uses the existing consumer rather than allocating another screen capturer. */
abstract class LiquidGlassInteractiveControl(context: Context, appContext: AppContext) : LiquidGlassView(context, appContext) {
  override val pointerEvents: PointerEvents = PointerEvents.AUTO
  // Resting white thumbs have no sampled source. Clearing their display list
  // during somebody else's capture would only force a redundant restore.
  override val suppressDuringBackdropCapture: Boolean get() = glassEnabled && super.suppressDuringBackdropCapture
  internal var controlDisabled by mutableStateOf(false)
  private var downX = 0f
  private var downY = 0f
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val finishCapture = Runnable { setGlassEnabled(false) }

  init {
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    composeView.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    // The catalog's resting thumb is white and needs no sampled background.
    // Only an actual press and its finite spring tail join the shared sampler.
    setGlassEnabled(false)
  }

  protected fun samplingInteraction(pressed: Boolean) {
    removeCallbacks(finishCapture)
    if (pressed) setGlassEnabled(true) else postDelayed(finishCapture, 900L)
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (controlDisabled) return false
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = abs(event.x - downX)
        val dy = abs(event.y - downY)
        // Horizontal adjustment owns the gesture; vertical list scrolling may
        // still cancel it. Do not turn a cancelled list scroll into a toggle.
        if (dx > touchSlop && dx > dy) parent?.requestDisallowInterceptTouchEvent(true)
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> parent?.requestDisallowInterceptTouchEvent(false)
    }
    return composeView.dispatchTouchEvent(event)
  }

  @Composable
  protected fun controlBackdrop(backdrop: Backdrop): Backdrop = remember(backdrop) {
    object : Backdrop {
      override val isCoordinatesDependent = true
      private val origin = IntArray(2)
      override fun DrawScope.drawBackdrop(
        density: Density,
        coordinates: LayoutCoordinates?,
        layerBlock: (GraphicsLayerScope.() -> Unit)?
      ) {
        // CanvasBackdrop normally paints at its host origin. A moving thumb
        // must sample its own window position, never the control's left edge.
        this@LiquidGlassInteractiveControl.getLocationInWindow(origin)
        val position = coordinates?.positionInWindow()
        val x = (position?.x ?: origin[0].toFloat()) - origin[0]
        val y = (position?.y ?: origin[1].toFloat()) - origin[1]
        translate(-x, -y) { with(backdrop) { drawBackdrop(density, coordinates, layerBlock) } }
      }
    }
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(finishCapture)
    setGlassEnabled(false)
    super.onDetachedFromWindow()
  }
}

class LiquidGlassToggleView(context: Context, appContext: AppContext) : LiquidGlassInteractiveControl(context, appContext) {
  private val controlled = CatalogControlledToggle()
  private var selectedState by mutableStateOf(false)
  internal var value: Boolean
    get() = selectedState
    set(next) { controlled.setFromJs(next); selectedState = controlled.value }
  private val onValueChange by EventDispatcher()

  private fun select(next: Boolean) {
    val changed = controlled.select(next, controlDisabled) ?: return
    selectedState = changed
    onValueChange(mapOf("value" to changed, "target" to id))
  }

  @Composable
  override fun RenderInteractiveControl(backdrop: Backdrop): Boolean {
    CatalogLiquidToggle(
      selected = { value },
      onSelect = ::select,
      backdrop = controlBackdrop(backdrop),
      dark = dark,
      enabled = !controlDisabled,
      onInteraction = ::samplingInteraction,
      modifier = Modifier.fillMaxSize().graphicsLayer { alpha = if (controlDisabled) 0.5f else 1f }
    )
    return true
  }
}

class LiquidGlassSliderView(context: Context, appContext: AppContext) : LiquidGlassInteractiveControl(context, appContext) {
  internal var activeTrackTintColor by mutableStateOf<Int?>(null)
  internal var value by mutableFloatStateOf(0f)
  internal var minimumValue by mutableFloatStateOf(0f)
  internal var maximumValue by mutableFloatStateOf(1f)
  internal var step by mutableFloatStateOf(0f)
  private val onValueChange by EventDispatcher()
  private val onSlidingStart by EventDispatcher()
  private val onSlidingComplete by EventDispatcher()
  private val onSlidingCancel by EventDispatcher()
  private val gesture = CatalogSliderGesture()

  private fun currentRange(): CatalogSliderRange = CatalogSliderRange.of(minimumValue, maximumValue, step)

  internal fun normalizeControlledValue() {
    value = currentRange().normalize(value)
  }

  private fun change(next: Float) {
    val range = currentRange()
    if (controlDisabled || !range.isInteractive) return
    val adjusted = range.normalize(next)
    if (value == adjusted) return
    value = adjusted
    onValueChange(mapOf("value" to adjusted))
  }

  @Composable
  override fun RenderInteractiveControl(backdrop: Backdrop): Boolean {
    val range = currentRange()
    val interactive = !controlDisabled && range.isInteractive
    CatalogLiquidSlider(
      value = { range.animationValue(value) },
      onValueChange = ::change,
      normalizeValue = { currentRange().animationValue(it) },
      valueRange = range.animationRange,
      visibilityThreshold = range.visibilityThreshold,
      backdrop = controlBackdrop(backdrop),
      activeTrackTintColor = activeTrackTintColor?.let { Color(it) },
      dark = dark,
      enabled = interactive,
      steps = range.accessibilitySteps,
      onInteraction = { pressed ->
        samplingInteraction(pressed)
        if (pressed) {
          if (gesture.begin(value)) onSlidingStart(mapOf("value" to value))
        } else if (gesture.complete()) onSlidingComplete(mapOf("value" to value))
      },
      onCancel = {
        samplingInteraction(false)
        gesture.cancel()?.let { original ->
          value = currentRange().normalize(original)
          onSlidingCancel(mapOf("value" to value))
        }
      },
      modifier = Modifier.fillMaxSize().graphicsLayer { alpha = if (controlDisabled) 0.5f else 1f }
    )
    return true
  }
}

@Composable
private fun CatalogLiquidToggle(
  selected: () -> Boolean,
  onSelect: (Boolean) -> Unit,
  backdrop: Backdrop,
  dark: Boolean,
  enabled: Boolean,
  onInteraction: (Boolean) -> Unit,
  modifier: Modifier = Modifier
) {
  val accentColor = if (!dark) Color(0xFF34C759) else Color(0xFF30D158)
  val trackColor = if (!dark) Color(0xFF787878).copy(0.2f) else Color(0xFF787880).copy(0.36f)
  val density = LocalDensity.current
  val isLtr = LocalLayoutDirection.current == LayoutDirection.Ltr
  val dragWidth = with(density) { 20f.dp.toPx() }
  val scope = rememberCoroutineScope()
  val gesture = remember { CatalogToggleGesture() }
  var fraction by remember { mutableFloatStateOf(if (selected()) 1f else 0f) }
  val drag = remember(scope, enabled) {
    DampedDragAnimation(scope, fraction, 0f..1f, 0.001f, 1f, 1.5f,
      onDragStarted = { gesture.begin(); onInteraction(true) },
      onDragStopped = {
        gesture.finish(selected(), targetValue)?.let { next ->
          fraction = if (next) 1f else 0f
          onSelect(next)
        }
        onInteraction(false)
      },
      onDrag = { _, amount ->
        gesture.drag(amount.x)
        val delta = amount.x / dragWidth
        fraction = (fraction + if (isLtr) delta else -delta).coerceIn(0f, 1f)
      },
      onDragCancelled = {
        fraction = if (selected()) 1f else 0f
        updateValue(fraction)
        gesture.cancel()
        onInteraction(false)
      })
  }
  LaunchedEffect(drag) { snapshotFlow { fraction }.collectLatest { drag.updateValue(it) } }
  LaunchedEffect(drag) {
    snapshotFlow { selected() }.collectLatest {
      val target = if (it) 1f else 0f
      if (target != fraction) { fraction = target; drag.animateToValue(target) }
    }
  }
  val resting by remember(drag) { derivedStateOf {
    isCatalogThumbResting(drag.pressProgress, drag.scaleX, drag.scaleY, drag.velocity, drag.value, drag.targetValue)
  } }
  val trackBackdrop = rememberLayerBackdrop()
  Box(modifier.semantics(mergeDescendants = true) {
    role = Role.Switch
    toggleableState = if (selected()) ToggleableState.On else ToggleableState.Off
    if (!enabled) disabled()
    onClick { if (enabled) { onSelect(!selected()); true } else false }
  }.then(if (enabled) drag.modifier else Modifier), contentAlignment = Alignment.CenterStart) {
    Box(Modifier.then(if (resting) Modifier else Modifier.layerBackdrop(trackBackdrop)).clip(RoundedCornerShape(percent = 50)).drawBehind {
      drawRect(lerp(trackColor, accentColor, drag.value))
    }.size(64f.dp, 28f.dp))
    Box(Modifier.graphicsLayer {
      val padding = 2f.dp.toPx()
      translationX = lerp(padding, padding + dragWidth, drag.value) * if (isLtr) 1f else -1f
    }.then(if (resting) restingCatalogThumb() else Modifier.drawBackdrop(
      backdrop = rememberCombinedBackdrop(backdrop, rememberBackdrop(trackBackdrop) { drawBackdrop ->
        val progress = drag.pressProgress
        scale(lerp(2f / 3f, 0.75f, progress), lerp(0f, 0.75f, progress)) { drawBackdrop() }
      }),
      shape = { RoundedCornerShape(percent = 50) },
      effects = {
        val progress = drag.pressProgress
        blur(8f.dp.toPx() * (1f - progress))
        lens(5f.dp.toPx() * progress, 10f.dp.toPx() * progress, chromaticAberration = true)
      },
      highlight = {
        val progress = drag.pressProgress
        Highlight.Ambient.copy(width = Highlight.Ambient.width / 1.5f, blurRadius = Highlight.Ambient.blurRadius / 1.5f, alpha = progress)
      },
      shadow = { Shadow(radius = 4f.dp, color = Color.Black.copy(alpha = 0.05f)) },
      innerShadow = { val progress = drag.pressProgress; InnerShadow(radius = 4f.dp * progress, alpha = progress) },
      layerBlock = {
        scaleX = drag.scaleX
        scaleY = drag.scaleY
        val velocity = drag.velocity / 50f
        scaleX /= 1f - (velocity * 0.75f).coerceIn(-0.2f, 0.2f)
        scaleY *= 1f - (velocity * 0.25f).coerceIn(-0.2f, 0.2f)
      },
      onDrawSurface = { drawRect(Color.White.copy(alpha = 1f - drag.pressProgress)) }
    )).size(40f.dp, 24f.dp))
  }
}

@Composable
private fun CatalogLiquidSlider(
  value: () -> Float,
  onValueChange: (Float) -> Unit,
  normalizeValue: (Float) -> Float,
  valueRange: ClosedFloatingPointRange<Float>,
  visibilityThreshold: Float,
  backdrop: Backdrop,
  activeTrackTintColor: Color?,
  dark: Boolean,
  enabled: Boolean,
  steps: Int,
  onInteraction: (Boolean) -> Unit,
  onCancel: () -> Unit,
  modifier: Modifier = Modifier
) {
  // Track color belongs to the current song and commits with its props.
  // Keep the thumb and value animations independent of this immediate update.
  val accentColor = activeTrackTintColor ?: if (!dark) Color(0xFF0088FF) else Color(0xFF0091FF)
  val trackColor = if (!dark) Color(0xFF787878).copy(0.2f) else Color(0xFF787880).copy(0.36f)
  val trackBackdrop = rememberLayerBackdrop()
  BoxWithConstraints(modifier.fillMaxWidth().semantics {
    progressBarRangeInfo = ProgressBarRangeInfo(value(), valueRange, steps)
    if (!enabled) disabled()
    setProgress {
      if (enabled) {
        onInteraction(true)
        onValueChange(normalizeValue(it.coerceIn(valueRange)))
        onInteraction(false)
        true
      } else false
    }
  }, contentAlignment = Alignment.CenterStart) {
    val trackWidth = constraints.maxWidth.coerceAtLeast(1)
    val isLtr = LocalLayoutDirection.current == LayoutDirection.Ltr
    val scope = rememberCoroutineScope()
    val dragTarget = remember(valueRange, enabled) { CatalogSliderDragAccumulator(valueRange) }
    val drag = remember(scope, valueRange, enabled) {
      DampedDragAnimation(scope, value(), valueRange, visibilityThreshold, 1f, 1.5f,
        onDragStarted = { dragTarget.begin(value()); onInteraction(true) },
        onDragStopped = {
          dragTarget.finish()?.let { rawTarget ->
            val target = normalizeValue(rawTarget)
            onValueChange(target)
            updateValue(target)
          }
          onInteraction(false)
        },
        onDrag = { _, amount ->
          val delta = (valueRange.endInclusive - valueRange.start) * amount.x / trackWidth
          dragTarget.move(if (isLtr) delta else -delta)?.let(onValueChange)
        },
        onDragCancelled = { dragTarget.cancel(); onCancel() })
    }
    LaunchedEffect(drag) { snapshotFlow { value() }.collectLatest { if (drag.targetValue != it) drag.updateValue(it) } }
    val resting by remember(drag) { derivedStateOf {
      isCatalogThumbResting(drag.pressProgress, drag.scaleX, drag.scaleY, drag.velocity, drag.value, drag.targetValue)
    } }
    Box(Modifier.then(if (resting) Modifier else Modifier.layerBackdrop(trackBackdrop))) {
      Box(Modifier.clip(RoundedCornerShape(percent = 50)).background(trackColor).then(if (enabled) Modifier.pointerInput(scope, valueRange) {
        detectTapGestures { position ->
          val delta = (valueRange.endInclusive - valueRange.start) * position.x / trackWidth
          val target = normalizeValue((if (isLtr) valueRange.start + delta else valueRange.endInclusive - delta).coerceIn(valueRange))
          onInteraction(true)
          // Animate the normalized value even if JS/native value was already
          // equal to this step and therefore emits no further state change.
          drag.animateToValue(target)
          onValueChange(target)
          onInteraction(false)
        }
      } else Modifier).height(6f.dp).fillMaxWidth())
      Box(Modifier.clip(RoundedCornerShape(percent = 50)).background(accentColor).height(6f.dp).layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        val width = (constraints.maxWidth * drag.progress).roundToInt().coerceAtLeast(0)
        layout(width, placeable.height) { placeable.place(0, 0) }
      })
    }
    Box(Modifier.graphicsLayer {
      val lower = -size.width / 4f
      val upper = (trackWidth - size.width * 3f / 4f).coerceAtLeast(lower)
      translationX = (-size.width / 2f + trackWidth * drag.progress)
        .coerceIn(lower, upper) * if (isLtr) 1f else -1f
    }.then(if (enabled) drag.modifier else Modifier).then(if (resting) restingCatalogThumb() else Modifier.drawBackdrop(
      backdrop = rememberCombinedBackdrop(backdrop, rememberBackdrop(trackBackdrop) { drawBackdrop ->
        val progress = drag.pressProgress
        scale(lerp(2f / 3f, 1f, progress), lerp(0f, 1f, progress)) { drawBackdrop() }
      }),
      shape = { RoundedCornerShape(percent = 50) },
      effects = {
        val progress = drag.pressProgress
        blur(8f.dp.toPx() * (1f - progress))
        lens(10f.dp.toPx() * progress, 14f.dp.toPx() * progress, chromaticAberration = true)
      },
      highlight = {
        val progress = drag.pressProgress
        Highlight.Ambient.copy(width = Highlight.Ambient.width / 1.5f, blurRadius = Highlight.Ambient.blurRadius / 1.5f, alpha = progress)
      },
      shadow = { Shadow(radius = 4f.dp, color = Color.Black.copy(alpha = 0.05f)) },
      innerShadow = { val progress = drag.pressProgress; InnerShadow(radius = 4f.dp * progress, alpha = progress) },
      layerBlock = {
        scaleX = drag.scaleX
        scaleY = drag.scaleY
        val velocity = drag.velocity / 10f
        scaleX /= 1f - (velocity * 0.75f).coerceIn(-0.2f, 0.2f)
        scaleY *= 1f - (velocity * 0.25f).coerceIn(-0.2f, 0.2f)
      },
      onDrawSurface = { drawRect(Color.White.copy(alpha = 1f - drag.pressProgress)) }
    )).size(40f.dp, 24f.dp))
  }
}
