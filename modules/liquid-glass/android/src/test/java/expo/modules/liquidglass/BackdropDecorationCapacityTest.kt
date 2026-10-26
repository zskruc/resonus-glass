package expo.modules.liquidglass

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.toSize
import com.kyant.backdrop.backdropHighlightRecordSize
import com.kyant.backdrop.backdropHighlightSize
import com.kyant.backdrop.backdropShadowRecordSize
import com.kyant.backdrop.backdropShadowSize
import com.kyant.backdrop.withBackdropLogicalSize
import kotlin.math.ceil
import kotlin.math.roundToInt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BackdropDecorationCapacityTest {
  @Test fun zeroCapacityPreservesFractionalExtentRoundingAndBothOffsetDirections() {
    for (size in listOf(Size(1320f, 161f), Size(129.2f, 147.6f), Size(.1f, .9f))) {
      for (radius in listOf(0f, 9.25f, 90f)) {
        for (offsetX in listOf(-3.25f, 0f, 3.25f)) {
          for (offsetY in listOf(-4.75f, 0f, 15.5f)) {
            val original = IntSize(ceil(size.width + radius * 4f + offsetX).toInt(),
              ceil(size.height + radius * 4f + offsetY).toInt())
            assertEquals(original, backdropShadowRecordSize(size, radius, offsetX, offsetY, IntSize.Zero))
          }
        }
      }
      val originalHighlight = IntSize(ceil(size.width).toInt() + 2, ceil(size.height).toInt() + 2)
      assertEquals(originalHighlight, backdropHighlightRecordSize(size, IntSize.Zero))
    }
  }

  @Test fun shadowAndHighlightPhysicalSizesStayFixedWhileTheirRealClipAndOutlineShrink() {
    // Samsung: 3.75 density, original 24dp shadow -> 90px radius.
    // This reproduces the 1680x536-style shadow backing observed in Perfetto.
    val expanded = IntSize(1320, 161)
    val capacity = amPlusPaddedCapacity(expanded, 15f)
    val physicalShadows = mutableSetOf<IntSize>()
    val physicalHighlights = mutableSetOf<IntSize>()
    val logicalShadowClips = mutableSetOf<IntSize>()
    val logicalHighlightClips = mutableSetOf<IntSize>()
    for (i in 0..400) {
      val p = -.027f + 1.073f * i / 400f
      val live = Size(AmPlusDockGeometry.miniWidth(1320f, 938f, p).roundToInt().toFloat(), 161f)
      val shadowClip = backdropShadowSize(live, 90f, 0f, 15f)
      val highlightClip = backdropHighlightSize(live)
      val shadowBacking = backdropShadowRecordSize(live, 90f, 0f, 15f, capacity)
      val highlightBacking = backdropHighlightRecordSize(live, capacity)
      physicalShadows += shadowBacking
      physicalHighlights += highlightBacking
      logicalShadowClips += shadowClip
      logicalHighlightClips += highlightClip
      // Larger physical capacity must not change the drawn outline or original clip.
      val outline = RoundedCornerShape(50).createOutline(live, LayoutDirection.Ltr, Density(3.75f)) as Outline.Rounded
      assertEquals(live.width, outline.roundRect.width, 0f)
      assertEquals(live.height, outline.roundRect.height, 0f)
      assertEquals(80.5f, outline.roundRect.topLeftCornerRadius.x, 0f)
      assertTrue(shadowBacking.width >= shadowClip.width && shadowBacking.height >= shadowClip.height)
      assertTrue(highlightBacking.width >= highlightClip.width && highlightBacking.height >= highlightClip.height)
    }
    assertEquals(setOf(IntSize(1710, 566)), physicalShadows)
    assertEquals(setOf(IntSize(1352, 193)), physicalHighlights)
    assertTrue(logicalShadowClips.size > 100)
    assertTrue(logicalHighlightClips.size > 100)
    // The settled endpoint releases both expanded allocations through the zero default.
    assertEquals(IntSize(1298, 536), backdropShadowRecordSize(Size(938f, 161f), 90f, 0f, 15f, IntSize.Zero))
    assertEquals(IntSize(940, 163), backdropHighlightRecordSize(Size(938f, 161f), IntSize.Zero))
  }

  @Test fun aLargerRealOutlineOrShadowMarginAlwaysWinsOverAnInsufficientReservation() {
    val live = Size(1450.25f, 220.5f)
    val reservation = IntSize(1320, 161)
    assertEquals(backdropShadowSize(live, 90f, -15f, 15f),
      backdropShadowRecordSize(live, 90f, -15f, 15f, reservation))
    assertEquals(backdropHighlightSize(live), backdropHighlightRecordSize(live, reservation))
    // Changing radius/offset still expands the real margin; capacity never caps user optics.
    assertNotEquals(backdropShadowRecordSize(live, 90f, 0f, 0f, reservation),
      backdropShadowRecordSize(live, 120f, -15f, 30f, reservation))
  }

  @Test fun recordedCommandsSeeTheOriginalClipExtentAndAlwaysRestorePhysicalContext() {
    val scope = CanvasDrawScope()
    val backing = IntSize(1710, 566)
    val logicalShadow = IntSize(1298, 536)
    val logicalHighlight = IntSize(940, 163)
    scope.drawContext.size = backing.toSize()
    scope.withBackdropLogicalSize(logicalShadow) {
      assertEquals(logicalShadow.toSize(), size)
      withBackdropLogicalSize(logicalHighlight) { assertEquals(logicalHighlight.toSize(), size) }
      assertEquals(logicalShadow.toSize(), size)
    }
    assertEquals(backing.toSize(), scope.size)
    assertThrows(IllegalStateException::class.java) {
      scope.withBackdropLogicalSize(logicalShadow) {
        assertEquals(logicalShadow.toSize(), size)
        error("Interrupted layer recording")
      }
    }
    assertEquals(backing.toSize(), scope.size)
  }
}
