package expo.modules.upnpcast

import java.net.URLDecoder

/** Pure decisions shared by polling and unit tests. */
internal object GenericQueueProgression {
  fun nextIndex(size: Int, currentIndex: Int, playMode: String): Int? {
    if (size <= 0 || currentIndex !in 0 until size) return null
    return when (playMode.uppercase()) {
      "REPEAT_ONE" -> currentIndex
      "REPEAT_ALL", "SHUFFLE" -> (currentIndex + 1) % size
      else -> (currentIndex + 1).takeIf { it < size }
    }
  }

  /**
   * The length a track's end is measured against: the shorter of what the
   * renderer reports and what the server said the song lasts.
   *
   * A renderer can be wrong about a stream it is handed without a length, a
   * transcoded one above all, and guess it longer than it is. The stream then
   * runs out before the renderer's own end, and measured against that alone the
   * stop read as a stop in the middle of the song: the queue did not move (#285).
   */
  fun referenceDurationMs(rendererDurationMs: Long, expectedDurationMs: Long): Long =
    listOf(rendererDurationMs, expectedDurationMs).filter { it > 0 }.minOrNull() ?: 0

  /**
   * Whether `positionMs` is close enough to the end to call a stop there the
   * track ending. Wide (10% of the track, at least 5 s): polling is once a
   * second and some renderers stop reporting the position in the last seconds.
   * With no length known at all, `unknownIsEnd` decides.
   */
  fun isNearEnd(
    positionMs: Long,
    rendererDurationMs: Long,
    expectedDurationMs: Long,
    unknownIsEnd: Boolean = true,
  ): Boolean {
    val reference = referenceDurationMs(rendererDurationMs, expectedDurationMs)
    if (reference <= 0) return unknownIsEnd
    return positionMs >= reference - maxOf(5_000L, reference / 10)
  }

  /**
   * Whether two stream addresses are the same one, as a renderer hands back
   * what it was given: some escape it again, some unescape it, some trim it.
   */
  fun sameUri(a: String?, b: String?): Boolean {
    if (a.isNullOrBlank() || b.isNullOrBlank()) return false
    return normalizeUri(a) == normalizeUri(b)
  }

  private fun normalizeUri(uri: String): String {
    val unescaped = Soap.unescape(uri.trim())
    return try {
      URLDecoder.decode(unescaped.replace("+", "%2B"), "UTF-8")
    } catch (_: Exception) {
      unescaped
    }
  }
}
