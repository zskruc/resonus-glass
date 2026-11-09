package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StaticDecorationKeyTest {
  private fun style() = StaticDecorationStyle(
    sourceArgb = 0xff121316.toInt(), preset = "button", tuningMask = 32, dark = true,
    densityBits = 3.75f.toRawBits(), fontScaleBits = 1f.toRawBits(), rtl = false, api = 36,
    topLeftBits = 22f.toRawBits(), topRightBits = 22f.toRawBits(),
    bottomLeftBits = 22f.toRawBits(), bottomRightBits = 22f.toRawBits(),
    blurBits = 10f.toRawBits(), refractionBits = 24f.toRawBits(), refractionHeightBits = 12f.toRawBits(),
    highlightWidthBits = .5f.toRawBits(), highlightOpacityBits = 1f.toRawBits(),
    tintArgb = 0xff404042.toInt(), tintOpacityBits = .4f.toRawBits(), depth = false, dispersion = false
  )

  @Test fun fullOfficialShadowAndSeparateHighlightKeepTheirOriginalPositiveCaptureEnvelopes() {
    val g = staticDecorationGeometry(StaticDecorationKey(1320, 555, style()))!!
    assertEquals(StaticRasterEnvelope(180, 180, 1680, 930), g.body)
    assertEquals(StaticRasterEnvelope(1, 1, 1322, 557), g.highlight)
    val rawBytes = (1680L * 930L + 1322L * 557L) * 4L
    assertTrue(g.reservationBytes >= rawBytes)
    assertTrue(g.reservationBytes < 16L * 1024 * 1024)
    // Actual Samsung layout has both heights; never normalize the shader size.
    val second = staticDecorationGeometry(StaticDecorationKey(1320, 554, style()))!!
    assertEquals(929, second.body.height)
    assertTrue(g.reservationBytes + second.reservationBytes < 24L * 1024 * 1024)
  }

  @Test fun fractionalDensityEnclosesTheOriginalFractionalShadowTranslationWithoutScaling() {
    val g = staticDecorationGeometry(StaticDecorationKey(1320, 555,
      style().copy(densityBits = 2.625f.toRawBits())))!!
    assertEquals(StaticRasterEnvelope(126, 126, 1572, 818), g.body)
    assertEquals(StaticRasterEnvelope(1, 1, 1322, 557), g.highlight)
    val custom = staticDecorationGeometry(StaticDecorationKey(1320, 555, style().copy(preset = "custom")))!!
    assertEquals(StaticRasterEnvelope(1, 1, 1322, 557), custom.body)
  }

  @Test fun everyRecipeInputAndOnePixelOrFloatBitChangeHasADistinctKey() {
    val s = style()
    val variants = listOf(
      s.copy(sourceArgb = s.sourceArgb + 1), s.copy(preset = "custom"),
      s.copy(tuningMask = 0), s.copy(dark = false),
      s.copy(densityBits = s.densityBits + 1), s.copy(fontScaleBits = s.fontScaleBits + 1),
      s.copy(rtl = true), s.copy(api = 33),
      s.copy(topLeftBits = s.topLeftBits + 1), s.copy(topRightBits = s.topRightBits + 1),
      s.copy(bottomLeftBits = s.bottomLeftBits + 1), s.copy(bottomRightBits = s.bottomRightBits + 1),
      s.copy(blurBits = s.blurBits + 1), s.copy(refractionBits = s.refractionBits + 1),
      s.copy(refractionHeightBits = s.refractionHeightBits + 1),
      s.copy(highlightWidthBits = s.highlightWidthBits + 1), s.copy(highlightOpacityBits = s.highlightOpacityBits + 1),
      s.copy(tintArgb = s.tintArgb + 1), s.copy(tintOpacityBits = s.tintOpacityBits + 1),
      s.copy(depth = true), s.copy(dispersion = true)
    )
    val original = StaticDecorationKey(1320, 555, s)
    assertEquals(21, variants.toSet().size)
    variants.forEach { assertNotEquals(original, original.copy(style = it)) }
    assertNotEquals(original, original.copy(height = 554))
    assertNotEquals(original, original.copy(width = 1319))
    assertNotEquals(original, original.copy(recipeRevision = 2))
  }

  @Test fun invalidGeometryOrOverBudgetRasterFallsBackBeforeAllocating() {
    val s = style()
    for (width in listOf(0, -1, 8193)) assertNull(staticDecorationGeometry(StaticDecorationKey(width, 555, s)))
    for (height in listOf(0, -1, 8193)) assertNull(staticDecorationGeometry(StaticDecorationKey(1320, height, s)))
    for (density in listOf(0f, -1f, Float.NaN, Float.POSITIVE_INFINITY, 17f)) {
      assertNull(staticDecorationGeometry(StaticDecorationKey(1320, 555, s.copy(densityBits = density.toRawBits()))))
    }
    val enormous = StaticDecorationKey(4096, 4096, s)
    val g = staticDecorationGeometry(enormous)!!
    val budget = StaticRasterBudget<StaticDecorationKey, Any>(24L * 1024 * 1024)
    assertNull(budget.acquire(enormous, g.reservationBytes))
    assertEquals(0L, budget.stats().bytes)
  }
}
