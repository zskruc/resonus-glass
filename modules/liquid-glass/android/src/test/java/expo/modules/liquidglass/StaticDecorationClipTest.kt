package expo.modules.liquidglass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StaticDecorationClipTest {
  private fun eligible(color: Int? = 0xff141619.toInt(), enabled: Boolean = true,
    preset: String = "button", tint: Float = 0f, tabs: Int = 0, dock: Float = 0f,
    progressive: Boolean = false): Boolean =
    canUseStaticDecorationAutoClip(color, enabled, preset, tint, tabs, dock, progressive)

  @Test fun opaqueUntintedOrdinaryStaticMaterialCanAvoidOnlyTheExtraClipTarget() {
    assertTrue(eligible())
    assertTrue(eligible(color = 0xffffffff.toInt()))
    assertTrue(eligible(color = 0xff000000.toInt()))
  }

  @Test fun liveTransparentAndAlmostOpaqueSourcesPreserveOffscreenIsolation() {
    assertFalse(eligible(color = null))
    assertFalse(eligible(color = 0x00141619))
    assertFalse(eligible(color = 0x80141619.toInt()))
    assertFalse(eligible(color = 0xfe141619.toInt()))
  }

  @Test fun anyNonzeroOrInvalidTintPreservesTheButtonHueBlendDestination() {
    for (tint in listOf(Float.MIN_VALUE, -Float.MIN_VALUE, 0.01f, 1f, Float.NaN,
        Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)) assertFalse(eligible(tint = tint))
    assertTrue(eligible(tint = -0f)) // Both signed zeros mean no tint paint is applied.
  }

  @Test fun allOtherMaterialsAndDisabledSurfacesRetainTheirOriginalStrategy() {
    for (preset in listOf("custom", "dialog", "tabs", "amPlus", "mediaPopup", "mediaPopupBottom", "mediaMenu", "")) {
      assertFalse(eligible(preset = preset))
    }
    assertFalse(eligible(enabled = false))
  }

  @Test fun dynamicTabsDockAndProgressiveEdgesNeverTakeTheNewStaticBranch() {
    for (tabs in listOf(-1, 1, 2, 4)) assertFalse(eligible(tabs = tabs))
    for (dock in listOf(-1f, Float.MIN_VALUE, 1f, Float.NaN, Float.POSITIVE_INFINITY)) assertFalse(eligible(dock = dock))
    assertFalse(eligible(progressive = true))
  }
}
