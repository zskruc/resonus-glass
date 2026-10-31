package expo.modules.silencetrim

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/** Runs the production RMS scanner on deterministic PCM, without an Android device. */
object SilenceBoundaries {
  private var checks = 0
  private fun check(value: Boolean, message: String) { checks++; if (!value) error(message) }
  private fun pcm(encoding: Int, channels: Int, frames: Int, sample: (Int, Int) -> Double): ByteBuffer {
    val width = when (encoding) { 3 -> 1; 2 -> 2; 21 -> 3; else -> 4 }
    val out = ByteBuffer.allocate(width * channels * frames).order(ByteOrder.LITTLE_ENDIAN)
    for (frame in 0 until frames) for (channel in 0 until channels) {
      val value = sample(frame, channel)
      when (encoding) {
        3 -> out.put((value * 128 + 128).toInt().toByte())
        2 -> out.putShort((value * 32768).toInt().toShort())
        4 -> out.putFloat(value.toFloat())
        22 -> out.putInt((value * 2147483648.0).toLong().toInt())
        21 -> { val integer = (value * 8388608).toInt(); out.put(integer.toByte()); out.put((integer shr 8).toByte()); out.put((integer shr 16).toByte()) }
      }
    }
    out.flip(); return out
  }
  @JvmStatic fun main(args: Array<String>) {
    val rate = 8000
    for (encoding in intArrayOf(2, 3, 4, 21, 22)) {
      val scanner = PcmBoundaryScanner(-60.0)
      // Interior silence must not erase time or split the result. Stereo
      // channels have opposite phase to catch erroneous channel averaging.
      val frames = scanner.feed(pcm(encoding, 2, rate) { frame, channel ->
        if (frame in 2400 until 3200 || frame in 4800 until 5600) if (channel == 0) 0.25 else -0.25 else 0.0
      }, encoding, rate, 2, 0, 0, 1_000_000)
      scanner.flush()
      check(frames == rate, "$encoding frame count")
      check(scanner.firstAudibleUs == 300_000L, "$encoding leading edge ${scanner.firstAudibleUs}")
      check(scanner.lastAudibleEndUs == 700_000L, "$encoding tail edge ${scanner.lastAudibleEndUs}")
      check(scanner.firstSeenUs == 0L && scanner.lastSeenUs == 1_000_000L, "$encoding original clock")
    }
    val preroll = PcmBoundaryScanner(-60.0)
    val total = preroll.feed(pcm(2, 1, rate) { _, _ -> 0.25 }, 2, rate, 1, 0, 500_000, 900_000)
    preroll.flush()
    check(total == rate, "discarded preroll still counts toward bounded decode budget")
    check(preroll.firstSeenUs == 500_000L && preroll.lastSeenUs == 900_000L, "seek preroll and after-window discarded")
    check(preroll.firstAudibleUs == 500_000L && preroll.lastAudibleEndUs == 900_000L, "absolute seek window boundaries")
    for (threshold in doubleArrayOf(-60.0, -70.0)) {
      val scanner = PcmBoundaryScanner(threshold)
      scanner.feed(pcm(4, 1, rate) { _, _ -> 0.0005 }, 4, rate, 1, 0, 0, 1_000_000); scanner.flush()
      check((scanner.firstAudibleUs == null) == (threshold == -60.0), "threshold $threshold must actually affect RMS")
    }
    val split = PcmBoundaryScanner(-60.0)
    split.feed(pcm(2, 1, 37) { _, _ -> 0.25 }, 2, rate, 1, 0, 0, 20_000)
    split.feed(pcm(2, 1, 43) { _, _ -> 0.25 }, 2, rate, 1, 4_625, 0, 20_000); split.flush()
    check(split.firstAudibleUs == 0L && split.lastAudibleEndUs == 10_000L, "10ms RMS survives packet boundaries")
    val quiet = PcmBoundaryScanner(-60.0)
    quiet.feed(pcm(2, 1, rate) { _, _ -> 0.0 }, 2, rate, 1, 0, 0, 1_000_000); quiet.flush()
    check(quiet.firstAudibleUs == null && quiet.lastAudibleEndUs == null, "all-silent windows")
    var rejected = false
    try { PcmBoundaryScanner(-60.0).feed(pcm(4, 1, 80) { _, _ -> Double.NaN }, 4, rate, 1, 0, 0, 10_000) }
    catch (_: IllegalArgumentException) { rejected = true }
    check(rejected, "invalid floating PCM is never proof of silence")
    println("Silence boundary PCM checks passed: $checks")
  }
}
