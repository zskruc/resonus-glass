package expo.modules.upnpcast

import org.junit.Assert.*
import org.junit.Test

class RendererPollTimingTest {
  private var now = 0L
  private val timing = RendererPollTiming { now }

  @Test fun healthyForegroundAndBackgroundHaveDifferentRealCadence() {
    assertEquals(1_000L, timing.waitMs(background = false))
    assertEquals(5_000L, timing.waitMs(background = true))
    assertEquals(1_000L, timing.waitMs(background = true, confirmingTransition = true))
    assertEquals(1_000L, timing.waitMs(background = false))
  }

  @Test fun extrasAreTimedNotOneEveryThreeBackgroundPolls() {
    assertTrue(timing.extrasDue())
    now = 1_000; assertFalse(timing.extrasDue())
    now = 2_999; assertFalse(timing.extrasDue())
    now = 3_000; assertTrue(timing.extrasDue())
    now = 8_000; assertTrue(timing.extrasDue())
    assertFalse(timing.extrasDue())
    assertTrue(timing.extrasDue(force = true))
  }

  @Test fun failuresWakeBackgroundAtOriginalDeadlinesInsteadOfMultiplyingCountsByFive() {
    val first = timing.failed()
    assertFalse(first.unreachable); assertFalse(first.recover); assertFalse(first.lost)
    assertEquals(1_000L, timing.waitMs(background = true))
    now = 1_000
    assertTrue(timing.failed().announceUnreachable)
    assertEquals(1_000L, timing.waitMs(background = true))
    now = 2_000
    val recover = timing.failed()
    assertTrue(recover.recover); assertFalse(recover.rediscover)
    assertEquals(3_000L, timing.waitMs(background = true))
    now = 5_000
    val search = timing.failed()
    assertTrue(search.recover); assertTrue(search.rediscover)
    assertFalse(search.announceUnreachable)
  }

  @Test fun manyImmediateInteractionPollFailuresCannotLoseASessionEarly() {
    repeat(50) { assertFalse(timing.failed().lost) }
    assertFalse(timing.lost())
    now = 29_999; assertFalse(timing.lost())
    now = 30_000; assertTrue(timing.lost())
    val lost = timing.failed(); assertTrue(lost.lost); assertFalse(lost.recover)
  }

  @Test fun aSlowPollStillUsesElapsedFailureTimeAndNeverNeedsThirtyBackgroundPolls() {
    timing.failed()
    now = 6_500
    val failure = timing.failed()
    assertTrue(failure.announceUnreachable); assertTrue(failure.recover); assertTrue(failure.rediscover)
    assertEquals(3_000L, timing.waitMs(background = true))
    now = 30_001; assertTrue(timing.lost()); assertEquals(0L, timing.waitMs(background = true))
  }

  @Test fun recoveryClearsOnlyTheFailureWindowAndDoesNotCreateRepeatedNotices() {
    timing.failed(); now = 1_000; timing.failed()
    assertEquals(2, timing.recovered())
    assertEquals(0, timing.recovered())
    now = 40_000; assertFalse(timing.lost())
    assertEquals(5_000L, timing.waitMs(background = true))
    assertFalse(timing.failed().unreachable)
  }

  @Test fun foregroundRestorationDoesNotRestartOrExtendFailureDeadline() {
    timing.failed(); now = 5_000; timing.failed()
    assertEquals(1_000L, timing.waitMs(background = false))
    now = 29_500
    assertEquals(0L, timing.waitMs(background = true)) // an overdue recovery is due now
    timing.failed()
    assertEquals(500L, timing.waitMs(background = true))
    now = 30_000; assertTrue(timing.lost())
  }

  @Test fun confirmationWindowsCannotBeAcceleratedByManyImmediatePollsOrMultipliedByBackgroundCadence() {
    val foreign = RendererConfirmation({ now }, 2_000)
    repeat(30) { assertFalse(foreign.observe()) }
    now = 1_999; assertFalse(foreign.observe())
    now = 2_000; assertTrue(foreign.observe())
    foreign.reset(); assertFalse(foreign.pending)
    now = 10_000; assertFalse(foreign.observe())
    now = 15_000; assertTrue(foreign.observe())
    val echo = RendererConfirmation({ now }, 9_000)
    assertFalse(echo.observe())
    now += 8_999; assertFalse(echo.observe())
    now += 1; assertTrue(echo.observe())
  }

  @Test fun onlyPlayingKnownTrackEndsKeepTheOriginalFastPollWindow() {
    assertFalse(RendererPollTiming.nearKnownTrackEnd(true, 189_999, 200_000, 200_000))
    assertTrue(RendererPollTiming.nearKnownTrackEnd(true, 190_000, 200_000, 200_000))
    assertTrue(RendererPollTiming.nearKnownTrackEnd(true, 201_000, 200_000, 200_000))
    assertFalse(RendererPollTiming.nearKnownTrackEnd(false, 199_000, 200_000, 200_000))
    assertFalse(RendererPollTiming.nearKnownTrackEnd(true, 199_000, 0, 0))
    assertTrue(RendererPollTiming.nearKnownTrackEnd(true, 190_000, 300_000, 200_000))
    assertTrue(RendererPollTiming.nearKnownTrackEnd(true, 190_000, 200_000, 0))
    assertEquals(1_000L, timing.waitMs(background = true, confirmingTransition = true))
    assertEquals(5_000L, timing.waitMs(background = true, confirmingTransition = false))
    assertEquals(30_000L, RendererPollTiming.LOST_AFTER_MS)
    assertEquals(20_000L, TrackWatch.OVERDUE_MS)
  }
}
