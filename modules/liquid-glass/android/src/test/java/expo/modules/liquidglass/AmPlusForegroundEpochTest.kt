package expo.modules.liquidglass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AmPlusForegroundEpochTest {
  @Test fun firstVisibleRowRecordsBeforeTouchAndStableFramesDoNotLoop() {
    val epoch = AmPlusForegroundEpoch()
    assertTrue(epoch.needsRecord(true, 24, false))
    repeat(120) { assertFalse(epoch.needsRecord(true, 24, false)) }
  }

  @Test fun routeLabelsTypographyAndDirtyDrawsRefreshWithoutWaitingForPress() {
    val epoch = AmPlusForegroundEpoch()
    epoch.needsRecord(true, 24, false)
    assertTrue(epoch.needsRecord(true, 25, false))
    assertFalse(epoch.needsRecord(true, 25, false))
    assertTrue(epoch.needsRecord(true, 25, true))
    assertFalse(epoch.needsRecord(true, 25, false))
  }

  @Test fun hiddenCollapsedOrDetachedRowsCannotReuseAnOldSourceWhenRestored() {
    val epoch = AmPlusForegroundEpoch()
    epoch.needsRecord(true, 24, false)
    assertFalse(epoch.needsRecord(false, 25, true))
    assertTrue(epoch.needsRecord(true, 24, false))
    epoch.invalidate()
    assertTrue(epoch.needsRecord(true, 24, false))
  }
}
