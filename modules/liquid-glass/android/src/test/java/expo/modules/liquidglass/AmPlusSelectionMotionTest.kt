package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AmPlusSelectionMotionTest {
  @Test fun releaseRemovesVelocityDeformationEvenBeforeTheVelocitySpringHasSettled() {
    for (velocity in listOf(-10f, -2f, 2f, 10f)) {
      assertEquals(1f, AmPlusSelectionMotion.scaleX(1f, velocity, 0f), 0f)
      assertEquals(1f, AmPlusSelectionMotion.scaleY(1f, velocity, 0f), 0f)
    }
  }

  @Test fun partialPressFadesVelocityAndMatchesTheSourceLensInverse() {
    assertEquals(1.5f / (1f - .15f), AmPlusSelectionMotion.scaleX(1.5f, 4f, .5f), .00001f)
    assertEquals(1.45f * (1f - .05f), AmPlusSelectionMotion.scaleY(1.45f, 4f, .5f), .00001f)
    assertEquals(1.5f / .8f, AmPlusSelectionMotion.scaleX(1.5f, 10f, 1f), .00001f)
    assertEquals(1.45f * .8f, AmPlusSelectionMotion.scaleY(1.45f, 10f, 1f), .00001f)
  }

  @Test fun reverseMotionAndInvalidSamplesCannotInvertTheSelectionSource() {
    for (velocity in listOf(-100f, -10f, 0f, 10f, 100f, Float.NaN)) {
      for (press in listOf(-1f, 0f, .5f, 1f, 2f, Float.NaN)) {
        val x = AmPlusSelectionMotion.scaleX(1f, velocity, press)
        val y = AmPlusSelectionMotion.scaleY(1f, velocity, press)
        assertTrue(x.isFinite() && x > 0f)
        assertTrue(y.isFinite() && y > 0f)
      }
    }
  }
}
