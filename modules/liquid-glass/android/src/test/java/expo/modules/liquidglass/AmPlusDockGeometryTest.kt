package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AmPlusDockGeometryTest {
  @Test fun endpointsPreserveExpandedAndCompactControls() {
    assertEquals(360f, AmPlusDockGeometry.sideWidth(360f, 43f, 360f, 0f, 8f), 0f)
    assertEquals(43f, AmPlusDockGeometry.sideWidth(360f, 43f, 360f, 1f, 8f), 0f)
    assertEquals(88f, AmPlusDockGeometry.sideWidth(88f, 43f, 360f, 0f, 8f), 0f)
    assertEquals(43f, AmPlusDockGeometry.sideWidth(88f, 43f, 360f, 1f, 8f), 0f)
  }

  @Test fun capsuleAndSearchReboundByTheSameVisibleDistance() {
    for (p in listOf(-0.027f, 1.046f)) {
      val nav = AmPlusDockGeometry.sideWidth(360f, 43f, 360f, p, 8f)
      val search = AmPlusDockGeometry.sideWidth(88f, 43f, 360f, p, 8f)
      val restingNav = if (p < 0f) 360f else 43f
      val restingSearch = if (p < 0f) 88f else 43f
      assertEquals(nav - restingNav, search - restingSearch, 0.0001f)
    }
    assertEquals(368f, AmPlusDockGeometry.sideWidth(360f, 43f, 360f, -0.09f, 8f), 0.0001f)
  }

  @Test fun searchRightAnchorAndMiniTravelKeepTheirOwnCoordinates() {
    val search = AmPlusDockGeometry.sideWidth(88f, 43f, 360f, 1.046f, 8f)
    val x = AmPlusDockGeometry.left("search", 88f, search, 45f, 1.046f)
    assertEquals(88f, x + search, 0.0001f)
    assertEquals(0f, AmPlusDockGeometry.left("navigation", 360f, 43f, 0f, 1f), 0f)
    assertEquals(51f * 1.046f, AmPlusDockGeometry.left("mini", 360f, 258f, 51f, 1.046f), 0.0001f)
    assertTrue(AmPlusDockGeometry.miniWidth(360f, 258f, 1.046f) < 258f)
  }

  @Test fun heightBottomAnchorsWithoutDiscardingSpringOvershoot() {
    assertEquals(56f, AmPlusDockGeometry.height(56f, 43f, 0f), 0f)
    assertEquals(43f, AmPlusDockGeometry.height(56f, 43f, 1f), 0f)
    assertTrue(AmPlusDockGeometry.height(56f, 43f, 1.046f) < 43f)
    assertEquals(43f, AmPlusDockGeometry.height(43f, 43f, 1.046f), 0f)
    assertEquals(0f, AmPlusDockGeometry.top("navigation", 56f, 56f, 43f, 56f, 0f), 0f)
    assertEquals(13f, AmPlusDockGeometry.top("navigation", 56f, 56f, 43f, 43f, 1f), 0f)
    assertEquals(13.299f, AmPlusDockGeometry.top("search", 56f, 56f, 43f, 42.402f, 1.046f), 0.0001f)
  }

  @Test fun invalidProgressAndSmallCapsulesRemainFinite() {
    assertEquals(0f, AmPlusDockGeometry.rawProgress(Float.NaN), 0f)
    assertEquals(-0.09f, AmPlusDockGeometry.rawProgress(-10f), 0f)
    assertEquals(1.09f, AmPlusDockGeometry.rawProgress(10f), 0f)
    assertEquals(16.125f, AmPlusDockGeometry.edgeLens(43f, 260f, 24f), 0f)
    assertEquals(0f, AmPlusDockGeometry.edgeLens(0f, 260f, 24f), 0f)
  }
}
