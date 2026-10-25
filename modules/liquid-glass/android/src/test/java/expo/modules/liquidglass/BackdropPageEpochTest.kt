package expo.modules.liquidglass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class BackdropPageEpochTest {
  @Test fun firstDrawablePageAcceptsItsOwnFirstFrame() {
    val policy = BackdropPageEpoch()
    assertFalse(policy.accepts(0))
    assertTrue(policy.observe(Any(), true))
    assertTrue(policy.accepts(policy.epoch))
  }

  @Test fun newPageRejectsDelayedPreviousPageFrame() {
    val policy = BackdropPageEpoch()
    policy.observe(Any(), true)
    val oldTicket = policy.epoch
    assertTrue(policy.observe(Any(), true))
    assertFalse(policy.accepts(oldTicket))
    assertTrue(policy.accepts(policy.epoch))
  }

  @Test fun unchangedPageDoesNotScheduleWorkOrAdvanceEpoch() {
    val policy = BackdropPageEpoch()
    val page = Any()
    policy.observe(page, true)
    val ticket = policy.epoch
    repeat(1_000) {
      assertFalse(policy.observe(page, true))
      assertEquals(ticket, policy.epoch)
      assertTrue(policy.accepts(ticket))
    }
  }

  @Test fun returningToSamePageRejectsItsPreviousVisit() {
    val policy = BackdropPageEpoch()
    val home = Any()
    policy.observe(home, true)
    val firstHomeTicket = policy.epoch
    policy.observe(Any(), true)
    val settingsTicket = policy.epoch
    policy.observe(home, true)
    assertFalse(policy.accepts(firstHomeTicket))
    assertFalse(policy.accepts(settingsTicket))
    assertTrue(policy.accepts(policy.epoch))
  }

  @Test fun changingTabInsideSameOuterPageRejectsPreviousTabTicket() {
    val policy = BackdropPageEpoch()
    val outerPage = Any()
    val home = Any()
    val library = Any()
    policy.observe(outerPage, true, home)
    val homeTicket = policy.epoch
    assertTrue(policy.observe(outerPage, true, library))
    assertFalse(policy.accepts(homeTicket))
    assertTrue(policy.accepts(policy.epoch))
    assertTrue(policy.allowsIsolatedSource(true, true))
  }

  @Test fun rapidTabRoundTripRejectsBothEarlierVisits() {
    val policy = BackdropPageEpoch()
    val outerPage = Any()
    val home = Any()
    val library = Any()
    policy.observe(outerPage, true, home)
    val firstHomeTicket = policy.epoch
    policy.observe(outerPage, true, library)
    val libraryTicket = policy.epoch
    policy.observe(outerPage, true, home)
    assertFalse(policy.accepts(firstHomeTicket))
    assertFalse(policy.accepts(libraryTicket))
    assertTrue(policy.accepts(policy.epoch))
  }

  @Test fun unchangedOuterAndTabDoNotScheduleWork() {
    val policy = BackdropPageEpoch()
    val outerPage = Any()
    val home = Any()
    policy.observe(outerPage, true, home)
    val ticket = policy.epoch
    repeat(1_000) {
      assertFalse(policy.observe(outerPage, true, home))
      assertEquals(ticket, policy.epoch)
      assertTrue(policy.accepts(ticket))
    }
  }

  @Test fun selectedTabMustAttachBeforeItsFirstFrameCanBeAccepted() {
    val policy = BackdropPageEpoch()
    val outerPage = Any()
    policy.observe(outerPage, true, Any())
    val oldTicket = policy.epoch
    val nextTab = Any()
    policy.observe(outerPage, false, nextTab)
    val nextTabEpoch = policy.epoch
    assertFalse(policy.accepts(oldTicket))
    assertFalse(policy.accepts(nextTabEpoch))
    assertFalse(policy.allowsIsolatedSource(true, true))
    assertTrue(policy.observe(outerPage, true, nextTab))
    assertEquals(nextTabEpoch, policy.epoch)
    assertTrue(policy.accepts(nextTabEpoch))
  }

  @Test fun sameChildUnderNewOuterPageIsStillANewVisit() {
    val policy = BackdropPageEpoch()
    val child = Any()
    policy.observe(Any(), true, child)
    val oldTicket = policy.epoch
    assertTrue(policy.observe(Any(), true, child))
    assertFalse(policy.accepts(oldTicket))
    assertTrue(policy.accepts(policy.epoch))
  }

  @Test fun newUnattachedTopCannotAcceptOrCaptureOldScreen() {
    val policy = BackdropPageEpoch()
    policy.observe(Any(), true)
    val homeTicket = policy.epoch
    val settings = Any()
    assertTrue(policy.observe(settings, false))
    val settingsEpoch = policy.epoch
    assertFalse(policy.captureAllowed)
    assertFalse(policy.accepts(homeTicket))
    assertFalse(policy.accepts(settingsEpoch))
    assertFalse(policy.observe(settings, false))
    assertTrue(policy.observe(settings, true))
    assertEquals(settingsEpoch, policy.epoch)
    assertTrue(policy.accepts(settingsEpoch))
  }

  @Test fun temporarilyUnavailablePageRejectsEarlierFramesWhenShownAgain() {
    val policy = BackdropPageEpoch()
    val page = Any()
    policy.observe(page, true)
    val beforeSuspension = policy.epoch
    assertTrue(policy.observe(page, false))
    assertFalse(policy.accepts(beforeSuspension))
    val suspendedEpoch = policy.epoch
    assertFalse(policy.observe(page, false))
    assertEquals(suspendedEpoch, policy.epoch)
    policy.observe(page, true)
    assertFalse(policy.accepts(beforeSuspension))
    assertTrue(policy.accepts(policy.epoch))
  }

  @Test fun missingTopRemainsBlockedEvenIfCallerMarksReady() {
    val policy = BackdropPageEpoch()
    policy.observe(Any(), true)
    val oldTicket = policy.epoch
    policy.observe(null, true)
    assertFalse(policy.captureAllowed)
    assertFalse(policy.accepts(oldTicket))
    assertFalse(policy.accepts(policy.epoch))
  }

  @Test fun isolatedSourceRequiresDrawableOpaquePageWithNoTransition() {
    val policy = BackdropPageEpoch()
    val page = Any()
    assertFalse(policy.allowsIsolatedSource(true, true))
    policy.observe(page, true)
    assertTrue(policy.allowsIsolatedSource(true, true))
    assertFalse(policy.allowsIsolatedSource(false, true))
    assertFalse(policy.allowsIsolatedSource(true, false))
    assertFalse(policy.allowsIsolatedSource(false, false))
    policy.observe(page, false)
    assertFalse(policy.allowsIsolatedSource(true, true))
  }
}
