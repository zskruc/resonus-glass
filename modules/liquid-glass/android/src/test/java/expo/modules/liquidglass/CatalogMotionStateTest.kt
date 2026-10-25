package expo.modules.liquidglass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogMotionStateTest {
  @Test fun releaseRejectsPreviouslyQueuedVelocityWrites() {
    val generation = CatalogMotionGeneration()
    val dragFrame = generation.advance()
    assertTrue(generation.accepts(dragFrame))
    generation.advance() // release begins its explicit velocity-to-zero cleanup
    assertFalse(generation.accepts(dragFrame))
    assertTrue(generation.accepts(generation.current))
  }

  @Test fun anotherPressRejectsTheOldReleaseAndOldMotionGeneration() {
    val generation = CatalogMotionGeneration()
    val firstPress = generation.advance()
    val released = generation.advance()
    val nextPress = generation.advance()
    assertFalse(generation.accepts(firstPress))
    assertFalse(generation.accepts(released))
    assertTrue(generation.accepts(nextPress))
  }

  @Test fun whiteThumbRequiresEveryAnimationEndpoint() {
    assertTrue(isCatalogThumbResting(0f, 1f, 1f, 0f, 28f, 28f))
    assertFalse(isCatalogThumbResting(0.00001f, 1f, 1f, 0f, 28f, 28f))
    assertFalse(isCatalogThumbResting(0f, 1.00001f, 1f, 0f, 28f, 28f))
    assertFalse(isCatalogThumbResting(0f, 1f, 0.99999f, 0f, 28f, 28f))
    assertFalse(isCatalogThumbResting(0f, 1f, 1f, 0.00001f, 28f, 28f))
    assertFalse(isCatalogThumbResting(0f, 1f, 1f, 0f, 27.99999f, 28f))
    assertFalse(isCatalogThumbResting(0f, 1f, 1f, 0f, Float.NaN, Float.NaN))
  }
}
