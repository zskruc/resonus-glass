package expo.modules.upnpcast

/** Real-time deadlines, independent of how many foreground/background polls ran. */
internal class RendererPollTiming(private val clock: () -> Long) {
  data class Failure(
    val count: Int,
    val unreachable: Boolean,
    val announceUnreachable: Boolean,
    val lost: Boolean,
    val recover: Boolean,
    val rediscover: Boolean,
  )

  private var firstFailureAt: Long? = null
  private var lastRecoveryAt: Long? = null
  private var extrasAt: Long? = null
  private var announcedUnreachable = false
  private var failures = 0

  fun extrasDue(force: Boolean = false): Boolean {
    val now = clock()
    if (!force && extrasAt?.let { now - it < EXTRAS_INTERVAL_MS } == true) return false
    extrasAt = now
    return true
  }

  fun failed(): Failure {
    val now = clock()
    val first = firstFailureAt ?: now.also { firstFailureAt = it }
    failures++
    val elapsed = now - first
    val unreachable = elapsed >= UNREACHABLE_AFTER_MS
    val announce = unreachable && !announcedUnreachable
    if (announce) announcedUnreachable = true
    val lost = elapsed >= LOST_AFTER_MS
    val recover = !lost && elapsed >= FIRST_RECOVERY_AFTER_MS &&
      (lastRecoveryAt?.let { now - it >= RECOVERY_INTERVAL_MS } ?: true)
    if (recover) lastRecoveryAt = now
    return Failure(failures, unreachable, announce, lost, recover, elapsed >= REDISCOVER_AFTER_MS)
  }

  fun recovered(): Int {
    val reported = if (announcedUnreachable) failures else 0
    firstFailureAt = null
    lastRecoveryAt = null
    announcedUnreachable = false
    failures = 0
    return reported
  }

  fun lost(): Boolean = firstFailureAt?.let { clock() - it >= LOST_AFTER_MS } ?: false

  /** A pending failure deadline can wake sooner than the ordinary5-second tick. */
  fun waitMs(background: Boolean, confirmingTransition: Boolean = false): Long {
    val ordinary = if (background && !confirmingTransition) BACKGROUND_INTERVAL_MS else FOREGROUND_INTERVAL_MS
    val first = firstFailureAt ?: return ordinary
    val now = clock()
    val deadlines = mutableListOf(first + LOST_AFTER_MS)
    if (!announcedUnreachable) deadlines.add(first + UNREACHABLE_AFTER_MS)
    deadlines.add(lastRecoveryAt?.plus(RECOVERY_INTERVAL_MS) ?: (first + FIRST_RECOVERY_AFTER_MS))
    return minOf(ordinary, (deadlines.minOrNull()!! - now).coerceAtLeast(0L))
  }

  companion object {
    const val FOREGROUND_INTERVAL_MS = 1_000L
    const val BACKGROUND_INTERVAL_MS = 5_000L
    const val EXTRAS_INTERVAL_MS = 3_000L
    // Preserve the old1-second loop's nominal failure/recovery windows.
    const val UNREACHABLE_AFTER_MS = 1_000L
    const val FIRST_RECOVERY_AFTER_MS = 2_000L
    const val RECOVERY_INTERVAL_MS = 3_000L
    const val REDISCOVER_AFTER_MS = 5_000L
    const val LOST_AFTER_MS = 30_000L

    /** Ordinary renderers may need the phone to load their next URI at the end. */
    fun nearKnownTrackEnd(playing: Boolean, positionMs: Long, rendererDurationMs: Long, expectedDurationMs: Long): Boolean {
      val duration = GenericQueueProgression.referenceDurationMs(rendererDurationMs, expectedDurationMs)
      return playing && duration > 0 && positionMs >= (duration - 10_000L).coerceAtLeast(0L)
    }
  }
}

/** Consecutive observations are confirmed by elapsed time, never tap/poll count. */
internal class RendererConfirmation(private val clock: () -> Long, private val delayMs: Long) {
  private var since: Long? = null
  val pending: Boolean get() = since != null

  fun observe(): Boolean {
    val now = clock()
    val first = since ?: now.also { since = it }
    return now - first >= delayMs
  }

  fun reset() { since = null }
}
