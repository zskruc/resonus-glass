package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class BackdropCaptureSourceTest {
  @Test fun everyActivityStyleUsesTheWholeStackWithoutItsSiblingConsumers() {
    val decor = Any()
    val stack = Any()
    val isolated = Any()
    // No progressive-edge flag is involved: AM++, Kyant and custom all sample
    // the same Stack when they cannot safely isolate an opaque current page.
    assertSame(stack, selectBackdropCaptureSource(decor, true, null, stack))
    assertSame(isolated, selectBackdropCaptureSource(decor, true, isolated, stack))
    // Missing/unready content, including an unknown underlay, keeps old behavior.
    assertSame(decor, selectBackdropCaptureSource(decor, true, null, null))
  }

  @Test fun playerFadeRemainsInsideTheStackAndModalStillRecordsItsOwnWindow() {
    val decor = Any()
    val completeFadeStack = Any()
    val playerOrPage = Any()
    val modal = Any()
    assertSame(completeFadeStack, selectBackdropCaptureSource(decor, true, null, completeFadeStack))
    assertSame(modal, selectBackdropCaptureSource(modal, false, playerOrPage, completeFadeStack))
    assertSame(modal, selectBackdropCaptureSource(modal, false, null, null))
  }

  @Test fun croppedSourceDoesNotTouchSiblingOverlayButFullModalIncludesTheActivity() {
    assertFalse(backdropSourceContainsSurface(false, false, true))
    assertTrue(backdropSourceContainsSurface(false, true, true))
    assertTrue(backdropSourceContainsSurface(true, false, true))
    assertTrue(backdropSourceContainsSurface(true, true, false))
    assertFalse(backdropSourceContainsSurface(true, false, false))
  }

  @Test fun compactRestUsesItsActualFootprintWithTheSameBlurLensAndShadowPadding() {
    val region = BackdropCaptureRegion()
    // Navigation, mini and Search keep the same outer footprint across styles.
    region.include(40, 900, 169, 1029, 168)
    region.include(193, 900, 1169, 1029, 168)
    region.include(1193, 900, 1322, 1029, 168)
    assertFalse(region.empty)
    assertEquals(-128, region.left)
    assertEquals(732, region.top)
    assertEquals(1490, region.right)
    assertEquals(1197, region.bottom)
    assertFalse(retainBackdropHostBounds(true, 1f, false))
  }

  @Test fun motionAndPressKeepTheOldHostEnvelopeIncludingOvershootAndRawPatchGuard() {
    for (progress in listOf(-.09f, .001f, .5f, .999f, 1.09f)) {
      assertTrue(retainBackdropHostBounds(true, progress, false))
      val region = BackdropCaptureRegion()
      region.include(193, 900, 1169, 1029, 168)
      // The host is added only during motion; it preserves the old outer
      // coverage, so intermediate shape/selected-lens extents cannot be cut.
      region.include(40, 850, 1322, 1060, 168)
      assertEquals(682, region.top)
      assertEquals(1228, region.bottom)
      // Existing raw patch + motion guard is unioned after the main region.
      region.include(160, 815, 1200, 1050, 24)
      assertEquals(682, region.top)
      assertEquals(1228, region.bottom)
    }
    assertTrue(retainBackdropHostBounds(true, 0f, true))
    assertTrue(retainBackdropHostBounds(true, 1f, true))
    assertFalse(retainBackdropHostBounds(false, .5f, false))
  }

  @Test fun discardedGeometryDoesNotLeakIntoTheNextFrameRegion() {
    val region = BackdropCaptureRegion()
    region.include(0, 0, 1440, 3120, 168)
    region.clear()
    assertTrue(region.empty)
    region.include(0, 0, 0, 0, 168)
    assertTrue(region.empty)
    region.include(40, 900, 169, 1029, 168)
    assertEquals(732, region.top)
    assertEquals(1197, region.bottom)
  }
}
