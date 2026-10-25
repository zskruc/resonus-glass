package expo.modules.liquidglass

import kotlin.math.ceil
import kotlin.math.round

/** Slider domain, distinct from the nonzero interval required by spring math. */
internal class CatalogSliderRange private constructor(
  val minimum: Float,
  val maximum: Float,
  val step: Float
) {
  val isInteractive: Boolean get() = maximum > minimum
  val animationRange: ClosedFloatingPointRange<Float> get() = if (isInteractive) minimum..maximum else 0f..1f
  val visibilityThreshold: Float get() = if (isInteractive) ((maximum.toDouble() - minimum) * 0.001).toFloat() else 0.001f
  val accessibilitySteps: Int get() = if (isInteractive && step > 0f)
    (ceil((maximum.toDouble() - minimum) / step).coerceAtMost(Int.MAX_VALUE.toDouble()) - 1).toInt().coerceAtLeast(0) else 0

  fun normalize(input: Float): Float {
    if (!isInteractive || input.isNaN()) return minimum
    val clamped = input.coerceIn(minimum, maximum)
    // Keep both endpoints reachable for durations not divisible by the step.
    if (step == 0f || clamped == minimum || clamped == maximum) return clamped
    val snapped = minimum.toDouble() + round((clamped.toDouble() - minimum) / step) * step
    return snapped.coerceIn(minimum.toDouble(), maximum.toDouble()).toFloat()
  }

  fun animationValue(input: Float): Float = if (isInteractive) normalize(input) else 0f

  companion object {
    fun of(minimum: Float, maximum: Float, step: Float): CatalogSliderRange {
      val low = minimum.takeIf { it.isFinite() } ?: 0f
      val high = maximum.takeIf { it.isFinite() && it >= low } ?: low
      val increment = step.takeIf { it.isFinite() && it > 0f } ?: 0f
      return CatalogSliderRange(low, high, increment)
    }
  }
}

/** External controlled props never dispatch a user event. */
internal class CatalogControlledToggle(initial: Boolean = false) {
  var value: Boolean = initial
    private set
  fun setFromJs(next: Boolean) { value = next }
  fun select(next: Boolean, disabled: Boolean): Boolean? {
    if (disabled || next == value) return null
    value = next
    return next
  }
}

/** A cancelled scroll/gesture cannot later produce an accidental selection. */
internal class CatalogToggleGesture {
  private var active = false
  private var dragged = false
  fun begin() { active = true; dragged = false }
  fun drag(deltaX: Float) { if (active && deltaX.isFinite() && deltaX != 0f) dragged = true }
  fun finish(selected: Boolean, target: Float): Boolean? {
    if (!active) return null
    active = false
    return if (dragged) target >= 0.5f else !selected
  }
  fun cancel() { active = false; dragged = false }
}


/** Completion is a commit; cancellation restores the press origin without committing. */
internal class CatalogSliderGesture {
  private var active = false
  private var originalValue = 0f
  fun begin(value: Float): Boolean {
    if (active) return false
    originalValue = value
    active = true
    return true
  }
  fun complete(): Boolean {
    if (!active) return false
    active = false
    return true
  }
  fun cancel(): Float? {
    if (!active) return null
    active = false
    return originalValue
  }
}

/**
 * Finger movement stays continuous even when emitted controlled values are
 * snapped to steps. Animated/JS feedback must never become the next origin.
 */
internal class CatalogSliderDragAccumulator(private val range: ClosedFloatingPointRange<Float>) {
  private var active = false
  private var target = range.start.toDouble()

  fun begin(value: Float) {
    target = (value.takeIf { it.isFinite() } ?: range.start).toDouble()
      .coerceIn(range.start.toDouble(), range.endInclusive.toDouble())
    active = range.endInclusive > range.start
  }

  fun move(delta: Float): Float? {
    if (!active || !delta.isFinite()) return null
    target = (target + delta.toDouble()).coerceIn(range.start.toDouble(), range.endInclusive.toDouble())
    return target.toFloat()
  }

  fun finish(): Float? {
    if (!active) return null
    active = false
    return target.toFloat()
  }

  fun cancel() { active = false }
}
