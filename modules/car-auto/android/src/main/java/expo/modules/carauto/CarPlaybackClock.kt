package expo.modules.carauto

/** Native position anchors, extrapolated without a second JS timer. */
internal class CarPlaybackClock(private val now: () -> Long) {
  private var positionMs = 0L
  private var updatedAt = now()
  var playing = false
    private set
  var buffering = false
    private set
  var speed = 1f
    private set

  fun update(isPlaying: Boolean, position: Long, rate: Double = 1.0, isBuffering: Boolean = false) {
    positionMs = position.coerceAtLeast(0L)
    updatedAt = now()
    playing = isPlaying
    buffering = isBuffering
    speed = rate.toFloat().takeIf { it.isFinite() && it > 0f } ?: 1f
  }

  fun position(): Long {
    if (!playing || buffering) return positionMs
    val elapsed = (now() - updatedAt).coerceAtLeast(0L)
    val result = positionMs.toDouble() + elapsed.toDouble() * speed
    return if (result >= Long.MAX_VALUE.toDouble()) Long.MAX_VALUE else result.toLong().coerceAtLeast(0L)
  }

  fun seek(position: Long) { positionMs = position.coerceAtLeast(0L); updatedAt = now() }

  /** Metadata refreshes keep the elapsed part of the same track's clock. */
  fun rebase() { positionMs = position(); updatedAt = now() }
}
