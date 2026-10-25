package expo.modules.liquidglass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UniformBackdropOpticsTest {
  private fun eligible(color: Int? = 0xff141619.toInt(), preset: String = "button",
    depth: Boolean = false, chromatic: Boolean = false, sdk: Int = 36,
    blur: Float = 2f, height: Float = 12f, amount: Float = 24f): Boolean =
    canFoldUniformButtonOptics(color, preset, depth, chromatic, sdk, blur, height, amount)

  @Test fun defaultOpaqueUniformButtonCanFoldOnlySpatiallyInvariantEffects() {
    assertTrue(eligible())
    assertTrue(eligible(color = 0xffffffff.toInt()))
    assertTrue(eligible(blur = 0f))
    assertTrue(eligible(blur = 12f, height = 12f))
  }

  @Test fun liveAndTranslucentSourcesNeverTakeTheUniformFastPath() {
    assertFalse(eligible(color = null))
    assertFalse(eligible(color = 0x80141619.toInt()))
    assertFalse(eligible(color = 0x00141619))
  }

  @Test fun otherMaterialsDepthAndDispersionPreserveTheirPipeline() {
    for (preset in listOf("custom", "dialog", "tabs", "amPlus")) assertFalse(eligible(preset = preset))
    assertFalse(eligible(depth = true))
    assertFalse(eligible(chromatic = true))
  }

  @Test fun lensAvailabilityAndPaddingEdgesAreConservative() {
    assertFalse(eligible(sdk = 31))
    assertFalse(eligible(sdk = 32))
    assertFalse(eligible(height = 0f))
    assertFalse(eligible(amount = 0f))
    assertFalse(eligible(blur = 13f, height = 12f))
    assertFalse(eligible(blur = Float.NaN))
    assertFalse(eligible(height = Float.POSITIVE_INFINITY))
    assertFalse(eligible(amount = Float.NaN))
  }
}
