package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogControlStateTest {
  @Test fun sliderClampsAtBothEndpointsAndHandlesNonFiniteInput() {
    val range = CatalogSliderRange.of(-10f, 10f, 0f)
    assertEquals(-10f, range.normalize(-99f), 0f)
    assertEquals(10f, range.normalize(99f), 0f)
    assertEquals(-10f, range.normalize(Float.NaN), 0f)
    assertEquals(10f, range.normalize(Float.POSITIVE_INFINITY), 0f)
    assertEquals(-10f, range.normalize(Float.NEGATIVE_INFINITY), 0f)
    assertEquals(2.25f, range.normalize(2.25f), 0f)
  }

  @Test fun sliderStepIsRelativeToMinimumAndKeepsNonDivisibleMaximumReachable() {
    val range = CatalogSliderRange.of(2f, 12f, 3f)
    assertEquals(2f, range.normalize(2f), 0f)
    assertEquals(5f, range.normalize(4f), 0f)
    assertEquals(11f, range.normalize(10.8f), 0f)
    assertEquals(12f, range.normalize(12f), 0f)
    assertEquals(12f, range.normalize(99f), 0f)
    assertEquals(3, range.accessibilitySteps)
  }

  @Test fun zeroDurationPlayerCannotBecomeAnArtificialOneSecondSeekRange() {
    val range = CatalogSliderRange.of(0f, 0f, 0f)
    assertFalse(range.isInteractive)
    assertEquals(0f, range.normalize(0.7f), 0f)
    assertEquals(0f, range.animationValue(99f), 0f)
    assertTrue(range.animationRange.endInclusive > range.animationRange.start)
    assertTrue(range.visibilityThreshold.isFinite())
    assertEquals(0, range.accessibilitySteps)
  }

  @Test fun invalidRangeIsDisabledWithoutInvalidSpringMath() {
    for (range in listOf(
      CatalogSliderRange.of(20f, 10f, 1f),
      CatalogSliderRange.of(Float.NaN, Float.NaN, Float.NaN),
      CatalogSliderRange.of(5f, Float.POSITIVE_INFINITY, 1f)
    )) {
      assertFalse(range.isInteractive)
      assertEquals(range.minimum, range.normalize(100f), 0f)
      assertEquals(0f, range.animationValue(100f), 0f)
      assertTrue(range.visibilityThreshold > 0f)
    }
  }

  @Test fun invalidOrZeroStepRemainsContinuousAndReconfigurationReclampsControlledValue() {
    for (step in listOf(0f, -1f, Float.NaN, Float.POSITIVE_INFINITY)) {
      assertEquals(0.375f, CatalogSliderRange.of(0f, 1f, step).normalize(0.375f), 0f)
    }
    val oldControlledValue = 180f
    assertEquals(60f, CatalogSliderRange.of(0f, 60f, 1f).normalize(oldControlledValue), 0f)
    assertEquals(2.5f, CatalogSliderRange.of(0f, 10f, 0.5f).normalize(2.4f), 0f)
  }

  @Test fun externalControlledSwitchUpdateDoesNotGenerateOrSuppressNextRealUserChange() {
    val controlled = CatalogControlledToggle()
    controlled.setFromJs(true)
    assertTrue(controlled.value)
    assertEquals(false, controlled.select(false, false))
    assertFalse(controlled.value)
    assertNull(controlled.select(false, false))
    controlled.setFromJs(true)
    assertNull(controlled.select(false, true))
    assertTrue(controlled.value)
    controlled.setFromJs(false)
    assertFalse(controlled.value)
  }

  @Test fun switchTapTogglesExactlyOnceAndDragSelectsNearestEndpoint() {
    val gesture = CatalogToggleGesture()
    gesture.begin()
    assertEquals(true, gesture.finish(false, 0f))
    assertNull(gesture.finish(false, 0f))
    gesture.begin()
    gesture.drag(-1f)
    assertEquals(false, gesture.finish(true, 0.49f))
    gesture.begin()
    gesture.drag(1f)
    assertEquals(true, gesture.finish(false, 0.5f))
  }

  @Test fun cancelledScrollCannotToggleAndNextTapStillWorks() {
    val gesture = CatalogToggleGesture()
    gesture.begin()
    gesture.drag(0.001f)
    gesture.cancel()
    assertNull(gesture.finish(false, 0.9f))
    gesture.begin()
    gesture.drag(0f)
    assertEquals(true, gesture.finish(false, 0f))
  }

  @Test fun switchTapUsesLatestControlledSelection() {
    val gesture = CatalogToggleGesture()
    gesture.begin()
    // Another setting/source updated the controlled value during the press.
    assertEquals(false, gesture.finish(true, 0f))
  }

  @Test fun cancelledSliderGestureRestoresOriginWithoutCommit() {
    val gesture = CatalogSliderGesture()
    assertTrue(gesture.begin(42f))
    assertFalse(gesture.begin(99f))
    assertEquals(42f, gesture.cancel()!!, 0f)
    assertFalse(gesture.complete())
    assertNull(gesture.cancel())
    assertTrue(gesture.begin(50f))
    assertTrue(gesture.complete())
    assertFalse(gesture.complete())
    assertNull(gesture.cancel())
  }


  @Test fun oneHundredSubHalfStepDeltasAccumulateAcrossControlledStepFeedback() {
    val range = CatalogSliderRange.of(0f, 10f, 1f)
    val drag = CatalogSliderDragAccumulator(range.animationRange)
    var controlledValue = 0f
    drag.begin(controlledValue)
    repeat(100) {
      controlledValue = range.normalize(drag.move(0.02f)!!)
    }
    assertEquals(2f, controlledValue, 0f)
    assertEquals(2f, range.normalize(drag.finish()!!), 0f)
    assertNull(drag.finish())
  }

  @Test fun slowReverseMovementKeepsItsFractionalRemainder() {
    val range = CatalogSliderRange.of(0f, 10f, 1f)
    val drag = CatalogSliderDragAccumulator(range.animationRange)
    drag.begin(5f)
    repeat(100) { range.normalize(drag.move(-0.02f)!!) }
    assertEquals(3f, range.normalize(drag.finish()!!), 0f)
    drag.begin(3f)
    repeat(100) { drag.move(0.02f) }
    repeat(50) { drag.move(-0.02f) }
    assertEquals(4f, range.normalize(drag.finish()!!), 0f)
  }

  @Test fun draggingAgainstAnEndpointDoesNotCreateAnInvisibleOvershootDebt() {
    val range = CatalogSliderRange.of(2f, 12f, 3f)
    val drag = CatalogSliderDragAccumulator(range.animationRange)
    drag.begin(11f)
    assertEquals(12f, drag.move(100f)!!, 0f)
    assertEquals(11.5f, drag.move(-0.5f)!!, 0f)
    assertEquals(2f, drag.move(-100f)!!, 0f)
    assertEquals(2.5f, drag.move(0.5f)!!, 0f)
    assertEquals(2f, range.normalize(drag.finish()!!), 0f)
  }

  @Test fun continuousSliderKeepsFineMovementWithoutDependingOnAnimationProgress() {
    val range = CatalogSliderRange.of(-1f, 1f, 0f)
    val drag = CatalogSliderDragAccumulator(range.animationRange)
    drag.begin(-0.5f)
    repeat(100) { drag.move(0.001f) }
    assertEquals(-0.4f, range.normalize(drag.finish()!!), 0.000001f)
  }

  @Test fun cancelledDragCannotCommitAndNextPressUsesLatestControlledValue() {
    val range = CatalogSliderRange.of(0f, 100f, 1f)
    val drag = CatalogSliderDragAccumulator(range.animationRange)
    drag.begin(25f)
    repeat(100) { drag.move(0.02f) }
    drag.cancel()
    assertNull(drag.finish())
    assertNull(drag.move(1f))
    // The caller subsequently changed the controlled prop to a different song.
    drag.begin(70f)
    repeat(100) { drag.move(0.02f) }
    assertEquals(72f, range.normalize(drag.finish()!!), 0f)
  }

  @Test fun invalidMovementDoesNotPoisonTheNextFiniteDelta() {
    val drag = CatalogSliderDragAccumulator(0f..10f)
    drag.begin(4f)
    assertNull(drag.move(Float.NaN))
    assertNull(drag.move(Float.POSITIVE_INFINITY))
    assertEquals(4.25f, drag.move(0.25f)!!, 0f)
    assertEquals(4.25f, drag.finish()!!, 0f)
  }

}
