package expo.modules.liquidglass

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.unit.IntSize
import com.kyant.backdrop.BackdropEffectScopeImpl
import com.kyant.backdrop.backdropLogicalRecordSize
import com.kyant.backdrop.backdropRecordSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.roundToInt

class AmPlusMaterialCapacityTest {
  @Test fun endpointsAndEveryOtherStyleKeepTheOriginalAllocationAndClipPolicy() {
    for (p in listOf(0f, 1f, Float.NaN, Float.POSITIVE_INFINITY)) {
      assertFalse(reserveAmPlusMaterial(true, true, p))
    }
    for (p in listOf(-.09f, .001f, .5f, .999f, 1.09f)) {
      assertTrue(reserveAmPlusMaterial(true, true, p))
      assertFalse(reserveAmPlusMaterial(false, true, p))
      assertFalse(reserveAmPlusMaterial(true, false, p))
    }
    val actual = Size(137.9f, 52.5f)
    // The default path retains 1.0.0's integer truncation, not ceil/round padding.
    assertEquals(IntSize(155, 70), backdropRecordSize(actual, 9.9f, IntSize.Zero))
    for (role in listOf("mini", "navigation", "search")) {
      assertEquals(IntSize.Zero, amPlusSurfaceCapacity(role, IntSize.Zero, 52f, 8f))
    }
    assertEquals(IntSize.Zero, amPlusPaddedCapacity(IntSize.Zero, 100f))
  }

  @Test fun exactExpandedGapAndPreLensPaddingAreReservedForAllDockParts() {
    val expanded = IntSize(840, 180)
    val panel = amPlusSurfaceCapacity("navigation", expanded, 156f, 24f)
    assertEquals(IntSize(864, 180), panel)
    assertEquals(IntSize(914, 230), amPlusPaddedCapacity(panel, 24.1f))
    assertEquals(IntSize(864, 156), amPlusRefractionCapacity(panel, 12f))
    assertEquals(IntSize(272, 156), amPlusSelectionCapacity(expanded, 12f, 12f, 3))
    // Detached Search reserves its larger endpoint; mini uses its expanded frame.
    assertEquals(IntSize(180, 180), amPlusSurfaceCapacity("search", IntSize(144, 180), 156f, 24f))
    assertEquals(expanded, amPlusSurfaceCapacity("mini", expanded, 780f, 24f))
  }

  @Test fun foldingDoesNotResizeTheEffectBackingWhenLiveLensPaddingChanges() {
    val expanded = IntSize(840, 180)
    val panel = amPlusSurfaceCapacity("navigation", expanded, 156f, 24f)
    val capacity = amPlusPaddedCapacity(panel, 24f)
    val dimensions = mutableSetOf<IntSize>()
    for (i in 0..400) {
      val p = -.027f + 1.073f * i / 400f // The source's actual expand/collapse peaks.
      val width = AmPlusDockGeometry.sideWidth(840f, 156f, 1080f, p, 24f, navigation = true)
      val height = AmPlusDockGeometry.height(180f, 156f, p)
      val live = Size(width.roundToInt().toFloat(), height.roundToInt().toFloat())
      val padding = (24f - AmPlusDockGeometry.edgeLens(live.height, live.width, 72f)).coerceAtLeast(0f)
      dimensions += backdropRecordSize(live, padding, capacity)
      assertEquals(backdropLogicalRecordSize(live, padding),
        IntSize(live.width.toInt() + padding.toInt() * 2, live.height.toInt() + padding.toInt() * 2))
    }
    assertEquals(setOf(capacity), dimensions)
    // Settling releases the large envelope instead of retaining an expanded GPU texture.
    assertEquals(IntSize(156, 156), backdropRecordSize(Size(156f, 156f), 0f, IntSize.Zero))
  }

  @Test fun backingCapacityNeverClampsUnexpectedOvershootOrCustomEffectPadding() {
    val capacity = IntSize(100, 100)
    assertEquals(IntSize(202, 104), backdropRecordSize(Size(180f, 82f), 11f, capacity))
    // The larger actual region wins: changing user optics cannot crop their source.
    assertEquals(IntSize(180, 82), backdropLogicalRecordSize(Size(180f, 82f), 0f))
  }

  @Test fun lensScopeAndSceneCallbackAlwaysSeeLiveLogicalGeometryNotReservedCapacity() {
    val scope = object : BackdropEffectScopeImpl() {
      override val shape: Shape = RoundedCornerShape(50)
    }
    val backing = IntSize(1000, 300)
    for (live in listOf(Size(840f, 180f), Size(380f, 168f), Size(156f, 156f))) {
      assertTrue(scope.update(drawScope(live)))
      // This is the very effectScope consumed by the unchanged lens size/corner uniforms.
      assertEquals(live, scope.size)
      assertEquals(live.minDimension / 2f,
        (scope.shape as RoundedCornerShape).topStart.toPx(scope.size, scope), 0f)
      assertEquals(backing, backdropRecordSize(live, 8f, backing))
      // This is the size restored in recordBackdropBlock before the source callback.
      assertEquals(IntSize(live.width.toInt() + 16, live.height.toInt() + 16),
        backdropLogicalRecordSize(scope.size, 8f))
      assertEquals(live, scope.size)
    }
  }

  private fun drawScope(size: Size): CanvasDrawScope = CanvasDrawScope().also {
    it.drawContext.size = size
  }
}
