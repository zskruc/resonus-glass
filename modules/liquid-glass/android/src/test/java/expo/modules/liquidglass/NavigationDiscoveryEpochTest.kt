package expo.modules.liquidglass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationDiscoveryEpochTest {
  @Test fun hundredsOfRowLayoutsDoNotRepeatANegativeNavigatorSearch() {
    val discovery = NavigationDiscoveryEpoch()
    assertTrue(discovery.needsSearch(true, 100L))
    repeat(10_000) { assertFalse(discovery.needsSearch(true, 100L)) }
    // A navigator mounted outside the pruned scrolling content changes the
    // skeleton even while the same outer native Screen remains on top.
    assertTrue(discovery.needsSearch(true, 101L))
    assertFalse(discovery.needsSearch(true, 101L))
  }

  @Test fun anUnreadyMountAndNewObserverCannotPermanentlyCacheMissingNavigation() {
    val discovery = NavigationDiscoveryEpoch()
    assertFalse(discovery.needsSearch(false, 100L))
    assertTrue(discovery.needsSearch(true, 100L))
    discovery.invalidate()
    assertTrue(discovery.needsSearch(true, 100L))
  }
}
