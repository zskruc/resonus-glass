package expo.modules.highrefresh

import org.junit.Assert.*
import org.junit.Test

class HighRefreshPolicyTest {
  @Test fun `request covers a stale 60 Hz physical-mode override without pinning resolution`() {
    val before = RefreshPreferences(60f, 4, true)
    assertEquals(RefreshPreferences(120f, 0, false), HighRefreshPolicy.foreground(before))
  }

  @Test fun `leaving foreground restores the original unspecified adaptive window policy`() {
    val before = RefreshPreferences(0f, 0, true)
    val requested = HighRefreshPolicy.foreground(before)
    assertEquals(before, HighRefreshPolicy.restore(before, requested))
  }

  @Test fun `leaving foreground restores a previous exact display mode and rate`() {
    val before = RefreshPreferences(90f, 7, false)
    assertEquals(before, HighRefreshPolicy.restore(before, HighRefreshPolicy.foreground(before)))
  }

  @Test fun `restoration does not overwrite newer window owners`() {
    val before = RefreshPreferences(0f, 4, true)
    val changedAfterUs = RefreshPreferences(24f, 9, true)
    assertEquals(changedAfterUs, HighRefreshPolicy.restore(before, changedAfterUs))
    assertEquals(RefreshPreferences(24f, 4, true), HighRefreshPolicy.restore(before,
      RefreshPreferences(24f, 0, false)))
  }

  @Test fun `pre Android 15 windows do not acquire an unavailable adaptive refresh property`() {
    val before = RefreshPreferences(0f, 0, null)
    val requested = HighRefreshPolicy.foreground(before)
    assertNull(requested.balancedPowerSavings)
    assertEquals(before, HighRefreshPolicy.restore(before, requested))
  }

  @Test fun `only attached visible foreground windows receive the high refresh request`() {
    assertFalse(HighRefreshPolicy.isEligible(0, true, true))
    assertFalse(HighRefreshPolicy.isEligible(1, false, true))
    assertFalse(HighRefreshPolicy.isEligible(1, true, false))
    assertTrue(HighRefreshPolicy.isEligible(1, true, true))
    assertTrue(HighRefreshPolicy.isEligible(2, true, true))
  }

  @Test fun `repeated playlist navigation never changes the foreground preference`() {
    val before = RefreshPreferences(0f, 0, true)
    var preference = HighRefreshPolicy.foreground(before)
    repeat(200) { preference = HighRefreshPolicy.foreground(preference) }
    assertEquals(RefreshPreferences(120f, 0, false), preference)
    assertEquals(before, HighRefreshPolicy.restore(before, preference))
  }
}
