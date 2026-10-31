package expo.modules.silencetrim

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.pow

/** 10 ms RMS windows across all channels, without phase cancellation. */
internal class PcmBoundaryScanner(private val thresholdDb: Double) {
  var firstAudibleUs: Long? = null
    private set
  var lastAudibleEndUs: Long? = null
    private set
  var firstSeenUs: Long? = null
    private set
  var lastSeenUs: Long = -1
    private set
  private val thresholdSquared = 10.0.pow(thresholdDb / 10.0)
  private var energy = 0.0
  private var windowFrames = 0
  private var windowStartUs = 0L
  private var windowEndUs = 0L
  private var previousRate = 0
  private var previousChannels = 0

  /** Returns decoded frame count, including discarded seek preroll. */
  fun feed(buffer: ByteBuffer, encoding: Int, rate: Int, channels: Int,
           presentationUs: Long, beginUs: Long, endUs: Long): Int {
    require(rate in 8_000..384_000 && channels in 1..32)
    val bytesPerSample = when (encoding) {
      3 -> 1 // PCM unsigned 8
      2 -> 2 // PCM signed 16
      21 -> 3 // PCM packed signed 24
      4, 22 -> 4 // PCM float / signed 32
      else -> throw IllegalArgumentException("Unsupported PCM encoding")
    }
    if (rate != previousRate || channels != previousChannels) {
      flush()
      previousRate = rate
      previousChannels = channels
    }
    val input = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    val frames = input.remaining() / (bytesPerSample * channels)
    val perWindow = max(1, rate / 100)
    for (frame in 0 until frames) {
      val timeUs = presentationUs + frame * 1_000_000L / rate
      var sum = 0.0
      for (channel in 0 until channels) {
        val sample = when (encoding) {
          3 -> ((input.get().toInt() and 255) - 128) / 128.0
          2 -> input.short.toDouble() / 32768.0
          4 -> input.float.toDouble()
          22 -> input.int.toDouble() / 2147483648.0
          else -> {
            val low = input.get().toInt() and 255
            val mid = input.get().toInt() and 255
            val high = input.get().toInt()
            (low or (mid shl 8) or (high shl 16)) / 8388608.0
          }
        }
        // Invalid floating data is not proof of silence: fail closed.
        require(sample.isFinite()) { "Invalid PCM sample" }
        sum += sample * sample
      }
      if (timeUs < beginUs || timeUs >= endUs) continue
      // Missing or reversed decoded packets cannot establish a silent edge.
      // A small timestamp rounding tolerance is allowed, not a gap of audio.
      require(lastSeenUs < 0 || timeUs in (lastSeenUs - 20_000)..(lastSeenUs + 20_000)) { "Discontinuous PCM timestamps" }
      if (firstSeenUs == null) firstSeenUs = timeUs
      lastSeenUs = timeUs + 1_000_000L / rate
      if (windowFrames == 0) windowStartUs = timeUs
      windowEndUs = lastSeenUs
      energy += sum / channels
      windowFrames++
      if (windowFrames >= perWindow) flush()
    }
    return frames
  }

  fun flush() {
    if (windowFrames > 0 && energy / windowFrames >= thresholdSquared) {
      if (firstAudibleUs == null) firstAudibleUs = windowStartUs
      lastAudibleEndUs = windowEndUs
    }
    energy = 0.0
    windowFrames = 0
  }
}
