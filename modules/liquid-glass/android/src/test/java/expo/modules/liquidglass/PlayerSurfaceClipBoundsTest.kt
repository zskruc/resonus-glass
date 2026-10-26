package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerSurfaceClipBoundsTest {
  @Test fun densityConvertsDistancesWithoutMovingOrScalingTheNativePlayer() {
    val b = PlayerSurfaceClipBounds()
    assertEquals(3, b.update(3f, 10.0, 20.0, 200.0, 100.0, 28.0, .75))
    assertEquals(30f, b.left, 0f); assertEquals(60f, b.top, 0f)
    assertEquals(630f, b.right, 0f); assertEquals(360f, b.bottom, 0f)
    assertEquals(84f, b.radius, 0f); assertEquals(.75f, b.opacity, 0f)
  }

  @Test fun repeatedFramesAreNoOpsAndAlphaAloneDoesNotRebuildThePath() {
    val b = PlayerSurfaceClipBounds()
    b.update(1f, 0.0, 0.0, 400.0, 800.0, 22.0, 1.0)
    assertEquals(0, b.update(1f, 0.0, 0.0, 400.0, 800.0, 22.0, 1.0))
    assertEquals(PlayerSurfaceClipBounds.ALPHA, b.update(1f, 0.0, 0.0, 400.0, 800.0, 22.0, .5))
    assertEquals(PlayerSurfaceClipBounds.CLIP, b.update(1f, 8.0, 0.0, 384.0, 800.0, 22.0, .5))
  }

  @Test fun invalidFramesCannotOverwriteTheLastValidClip() {
    val b = PlayerSurfaceClipBounds()
    b.update(1f, 10.0, 20.0, 200.0, 100.0, 28.0, .75)
    for (bad in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.MAX_VALUE)) {
      assertEquals(PlayerSurfaceClipBounds.INVALID, b.update(3f, bad, 0.0, 200.0, 100.0, 28.0, 1.0))
      assertEquals(PlayerSurfaceClipBounds.INVALID, b.update(3f, 0.0, 0.0, bad, 100.0, 28.0, 1.0))
    }
    assertEquals(PlayerSurfaceClipBounds.INVALID, b.update(1f, 0.0, 0.0, -1.0, 100.0, 28.0, 1.0))
    assertEquals(PlayerSurfaceClipBounds.INVALID, b.update(1f, 0.0, 0.0, 200.0, -1.0, 28.0, 1.0))
    assertEquals(PlayerSurfaceClipBounds.INVALID, b.update(1f, 0.0, 0.0, 200.0, 100.0, -1.0, 1.0))
    assertEquals(PlayerSurfaceClipBounds.INVALID, b.update(0f, 0.0, 0.0, 200.0, 100.0, 28.0, 1.0))
    assertEquals(10f, b.left, 0f); assertEquals(20f, b.top, 0f)
    assertEquals(.75f, b.opacity, 0f)
  }

  @Test fun clipsMayExtendPastTheViewportWhileRadiusAndOpacityStayBounded() {
    val b = PlayerSurfaceClipBounds()
    b.update(1f, -20.0, -10.0, 100.0, 20.0, 100.0, 2.0)
    assertEquals(-20f, b.left, 0f); assertEquals(-10f, b.top, 0f)
    assertEquals(80f, b.right, 0f); assertEquals(10f, b.bottom, 0f)
    assertEquals(10f, b.radius, 0f); assertEquals(1f, b.opacity, 0f)
    b.update(1f, 8.0, 700.0, 0.0, 0.0, 28.0, -.5)
    assertEquals(0f, b.radius, 0f); assertEquals(0f, b.opacity, 0f)
  }

  @Test fun combinedCoordinateOverflowIsRejectedAndDensityChangesRecomputeTheClip() {
    val b = PlayerSurfaceClipBounds()
    b.update(1f, 2.0, 4.0, 100.0, 50.0, 20.0, 1.0)
    assertEquals(PlayerSurfaceClipBounds.INVALID, b.update(1f, 2e38, 0.0, 2e38, 50.0, 20.0, 1.0))
    assertEquals(2f, b.left, 0f)
    assertEquals(PlayerSurfaceClipBounds.CLIP, b.update(2f, 2.0, 4.0, 100.0, 50.0, 20.0, 1.0))
    assertEquals(4f, b.left, 0f); assertEquals(204f, b.right, 0f)
    assertEquals(40f, b.radius, 0f)
  }

  @Test fun clearingAnAttachmentRequiresAFreshFrameBeforeDrawing() {
    val b = PlayerSurfaceClipBounds()
    b.update(1f, 0.0, 0.0, 400.0, 800.0, 0.0, 1.0)
    assertTrue(b.hasFrame)
    b.clear()
    assertFalse(b.hasFrame)
    assertEquals(0f, b.opacity, 0f)
    assertEquals(3, b.update(1f, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0))
    assertTrue(b.hasFrame)
  }

  @Test fun staleAttachmentTokensCannotFindANewOrReattachedBackground() {
    val registry = PlayerSurfaceClipRegistry<Any>()
    val a = Any(); val b = Any()
    val old = registry.attach(a)
    registry.detach(old)
    val next = registry.attach(b)
    val reattached = registry.attach(a)
    assertTrue(old != next && old != reattached && next != reattached)
    assertNull(registry.get(old))
    assertSame(b, registry.get(next)); assertSame(a, registry.get(reattached))
    registry.detach(next); registry.detach(reattached)
    assertEquals(0, registry.size)
  }
}
