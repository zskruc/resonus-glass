package expo.modules.carauto

import org.junit.Assert.*
import org.junit.Test

class CarPlaybackClockTest {
  private var now = 1_000L
  private val clock = CarPlaybackClock { now }

  @Test fun fiveSecondBackgroundAnchorsExtrapolateAtTheActualPlaybackSpeed() {
    for (speed in listOf(.5, 1.0, 1.25, 1.5, 2.0)) {
      clock.update(true, 10_000, speed)
      now += 5_000
      assertEquals(10_000L + (5_000 * speed).toLong(), clock.position())
      assertEquals(speed.toFloat(), clock.speed)
    }
  }

  @Test fun pauseAndBufferingNeverInventAudioProgress() {
    clock.update(false, 30_000, 1.5)
    now += 5_000; assertEquals(30_000L, clock.position())
    clock.update(true, 30_000, 1.5, isBuffering = true)
    now += 5_000; assertEquals(30_000L, clock.position()); assertTrue(clock.buffering)
    clock.update(true, 30_000, 1.5, isBuffering = false)
    now += 2_000; assertEquals(33_000L, clock.position())
  }

  @Test fun metadataRefreshDoesNotThrowAwayElapsedProgressBetweenJsAnchors() {
    clock.update(true, 10_000, 1.25)
    now += 3_000; clock.rebase()
    assertEquals(13_750L, clock.position())
    now += 2_000; assertEquals(16_250L, clock.position())
  }

  @Test fun optimisticCarSeekKeepsSpeedAndBufferingState() {
    clock.update(true, 10_000, 1.5)
    clock.seek(60_000); now += 1_000
    assertEquals(61_500L, clock.position())
    clock.update(true, 61_500, 1.5, isBuffering = true)
    clock.seek(90_000); now += 1_000
    assertEquals(90_000L, clock.position())
  }

  @Test fun oldSendersKeepOneTimesNotBufferingDefaultsAndInvalidRatesAreSafe() {
    clock.update(true, 1_000); now += 5_000
    assertEquals(6_000L, clock.position()); assertEquals(1f, clock.speed); assertFalse(clock.buffering)
    for (invalid in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -1.0, 0.0, 1e100)) {
      clock.update(true, 0, invalid); now += 1_000
      assertEquals(1_000L, clock.position()); assertEquals(1f, clock.speed)
    }
  }

  @Test fun backwardsClockAndMalformedLargePositionsCannotWrapNegative() {
    clock.update(true, 50_000, 2.0); now -= 1_000
    assertEquals(50_000L, clock.position())
    clock.update(true, Long.MAX_VALUE - 100, 2.0); now += 10_000
    assertEquals(Long.MAX_VALUE, clock.position())
    clock.update(false, -10); assertEquals(0L, clock.position())
  }
}
