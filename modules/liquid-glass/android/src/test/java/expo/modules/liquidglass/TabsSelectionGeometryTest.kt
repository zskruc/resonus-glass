package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TabsSelectionGeometryTest {
  @Test fun idleKeepsTheRealTabInsideItsOriginalBarAndPressCanBulgePastBothEdges() {
    val idle = TabsSelectionGeometry.bounds(320f, 64f, 4f, 4f, 4, 1f, 0f, 1f, 1f)
    assertEquals(4f, idle.top, 0f)
    assertEquals(60f, idle.bottom, 0f)
    // The catalog uses 78/56 for the lens; 1.2 is only the hidden row's content.
    val sourceScale = 78f / 56f
    val pressed = TabsSelectionGeometry.bounds(320f, 64f, 4f, 4f, 4, 1f, 0f,
      TabsSelectionGeometry.scaleX(false, sourceScale, -10f, 1f),
      TabsSelectionGeometry.scaleY(false, sourceScale, -10f, 1f))
    assertEquals(-14.8f, pressed.top, .0001f)
    assertEquals(78.8f, pressed.bottom, .0001f)
    assertTrue(pressed.top < 0f && pressed.bottom > 64f)
  }

  @Test fun maximumSourceEnvelopeCoversEveryPressDirectionWithoutChangingPerFrame() {
    for (amPlus in listOf(false, true)) {
      for (count in 1..5) {
        val envelope = TabsSelectionGeometry.interactionBounds(320f, 64f, 4f, 4f, count, amPlus, 4f)
        val peakX = TabsSelectionGeometry.maximumScaleX(amPlus, count)
        val peakY = TabsSelectionGeometry.maximumScaleY(amPlus)
        for (i in 0..100) {
          val p = i / 100f
          for (velocity in listOf(-100f, -10f, 0f, 10f, 100f)) {
            // Include the scale springs' overshoot by testing up to their guarded peaks.
            val scaleX = TabsSelectionGeometry.scaleX(amPlus, 1f + (peakX * .8f - 1f) * p, velocity, p)
            val scaleY = TabsSelectionGeometry.scaleY(amPlus, 1f + (peakY / 1.2f - 1f) * p, velocity, p)
            val actual = TabsSelectionGeometry.bounds(320f, 64f, 4f, 4f, count,
              (count - 1) * p, 8f * p - 4f, scaleX, scaleY)
            assertTrue(actual.left >= envelope.left - .001f && actual.right <= envelope.right + .001f)
            assertTrue(actual.top >= envelope.top - .001f && actual.bottom <= envelope.bottom + .001f)
          }
        }
      }
    }
  }

  @Test fun speedClampAndModeSpecificCouplingRemainExactlyTheUpstreamFormulas() {
    assertEquals(1.5f / .8f, TabsSelectionGeometry.scaleX(true, 1.5f, 100f, 1f), 0f)
    assertEquals(1.45f * 1.2f, TabsSelectionGeometry.scaleY(true, 1.45f, -100f, 1f), 0f)
    assertEquals(1f, TabsSelectionGeometry.scaleX(true, 1f, 100f, 0f), 0f)
    assertEquals(1.25f, TabsSelectionGeometry.scaleX(false, 1f, 100f, 0f), 0f)
    assertEquals(.8f, TabsSelectionGeometry.scaleY(false, 1f, 100f, 0f), 0f)
  }

  @Test fun paddedOverlayFollowsAncestorTranslationRotationAndScaleWithoutMovingTouchLayout() {
    val result = TabsOverlayBounds()
    val translated = floatArrayOf(1f, 0f, 100f, 0f, 1f, 200f, 0f, 0f, 1f)
    assertTrue(TabsSelectionGeometry.mapRecordBounds(320f, 64f, 8f, 4f, 96, translated, result))
    assertEquals(12, result.left); assertEquals(108, result.top)
    assertEquals(524, result.right); assertEquals(364, result.bottom)
    val rotatedScaled = floatArrayOf(0f, -2f, 100f, 2f, 0f, 200f, 0f, 0f, 1f)
    assertTrue(TabsSelectionGeometry.mapRecordBounds(320f, 64f, 0f, 0f, 10, rotatedScaled, result))
    assertEquals(-48, result.left); assertEquals(180, result.top)
    assertEquals(120, result.right); assertEquals(860, result.bottom)
    // A zero/invertible transform fails closed rather than painting in another coordinate space.
    assertFalse(TabsSelectionGeometry.mapRecordBounds(320f, 64f, 0f, 0f, 10, FloatArray(9), result))
  }

  @Test fun fixedGuardContainsTheFullDefaultShadowAndRoiIncludesTheSourceBulge() {
    val width = 320f
    val height = 64f
    val count = 3
    val tabWidth = (width - 8f) / count
    val tabHeight = height - 8f
    val radius = 24f
    val guard = TabsSelectionGeometry.recordOutset(radius, tabWidth, tabHeight, count, true, 4f)
    val x = TabsSelectionGeometry.maximumScaleX(true, count)
    val y = TabsSelectionGeometry.maximumScaleY(true)
    assertTrue(guard >= tabWidth * (x - 1f) / 2 + radius * 2f * x + 4f)
    assertTrue(guard >= tabHeight * (y - 1f) / 2 + (radius * 2f + radius / 6f) * y)
    val envelope = TabsSelectionGeometry.interactionBounds(width, height, 4f, 4f, count, true, 4f)
    val roi = BackdropCaptureRegion()
    roi.include(0, 1000, 320, 1064, 4)
    roi.include(kotlin.math.floor(envelope.left).toInt(), kotlin.math.floor(1000 + envelope.top).toInt(),
      kotlin.math.ceil(envelope.right).toInt(), kotlin.math.ceil(1000 + envelope.bottom).toInt(), 4)
    assertTrue(roi.top <= 1000 + envelope.top - 4f)
    assertTrue(roi.bottom >= 1000 + envelope.bottom + 4f)
    assertTrue(roi.left <= envelope.left - 4f && roi.right >= envelope.right + 4f)
  }
}
