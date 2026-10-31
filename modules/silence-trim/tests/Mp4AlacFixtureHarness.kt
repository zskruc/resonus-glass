package expo.modules.silencetrim

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import kotlin.math.abs

/** The real production reader + PCM scanner, on independently decoded fixtures. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
object Mp4AlacFixtureHarness {
  private var checks = 0
  private fun verify(value: Boolean, message: String) { checks++; if (!value) error(message) }
  private fun hash(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes)
    .joinToString("") { "%02x".format(it.toInt() and 255) }

  private class FileData(file: File) : LocalAudioData, AutoCloseable {
    private val input = RandomAccessFile(file, "r")
    override val length = input.length()
    var bytesRead = 0L
    val positions = mutableListOf<Long>()
    override fun readAt(position: Long, bytes: ByteArray, offset: Int, length: Int): Int {
      require(position >= 0 && position <= this.length)
      positions.add(position)
      input.seek(position)
      val read = input.read(bytes, offset, length)
      if (read > 0) bytesRead += read
      return read
    }
    override fun close() { input.close() }
  }

  private data class Packet(val at: Long, val size: Int, val hash: String)
  private fun references(file: File): List<Packet> = File(file.path + ".packets.tsv").readLines().map { row ->
    val fields = row.split('\t'); Packet(fields[0].toLong(), fields[1].toInt(), fields[2])
  }
  private fun boundaryPcm(directory: File, stem: String) {
    val rate = 48000; val channels = 2
    val head = PcmBoundaryScanner(-60.0)
    val headBytes = File(directory, "$stem.head.f32le").readBytes()
    head.feed(ByteBuffer.wrap(headBytes), 4, rate, channels, 0, 0, 3_000_000); head.flush()
    verify(abs((head.firstAudibleUs ?: -1) - 1_200_000L) <= 10_000, "$stem real decoded leading PCM boundary")
    val tail = PcmBoundaryScanner(-60.0)
    val tailBytes = File(directory, "$stem.tail.f32le").readBytes()
    tail.feed(ByteBuffer.wrap(tailBytes), 4, rate, channels, 56_000_000, 56_000_000, 60_000_000); tail.flush()
    verify(abs((tail.lastAudibleEndUs ?: -1) - 58_000_000L) <= 10_000, "$stem real decoded trailing PCM boundary")
    verify(head.firstSeenUs == 0L && tail.firstSeenUs == 56_000_000L, "$stem PCM retains absolute file clock")
  }

  private fun fixture(directory: File, name: String) {
    val file = File(directory, name)
    val expected = references(file)
    FileData(file).use { data ->
      var active = true
      val source = Mp4AlacSource.open(data) { active } ?: error("$name was not recognized as real ALAC")
      source.use {
        verify(source.format.sampleMimeType == "audio/alac", "$name confirmed codec")
        verify(source.format.sampleRate == 48000 && source.format.channelCount == 2, "$name audio format")
        verify(source.format.initializationData.firstOrNull()?.size in listOf(24, 36), "$name nonempty ALAC cookie")
        val cookie = source.format.initializationData[0]
        val depth = cookie[if (cookie.size == 24) 5 else 17].toInt() and 255
        verify(depth == if (name.startsWith("alac16")) 16 else 24, "$name real codec-cookie bit depth")
        verify(abs(source.durationUs - 60_000_000L) < 1000, "$name original duration")
        verify(data.bytesRead < 2L * 1024 * 1024, "$name metadata reads are bounded and skip media payload")
        val headPackets = mutableListOf<Packet>()
        source.readWindow(0, 3_000_000) { bytes, at ->
          headPackets.add(Packet(at, bytes.size, hash(bytes))); false
        }
        verify(headPackets.size in 30..40, "$name head window packet count ${headPackets.size}")
        verify(headPackets.first().at == 0L, "$name starts at the first sample")
        verify(headPackets.all { it.at < 3_000_000L }, "$name readWindow enforces its own end even when consumer returns false")
        for (packet in headPackets) {
          verify(expected.any { abs(it.at - packet.at) <= 1 && it.size == packet.size && it.hash == packet.hash }, "$name head sample equals independent ffprobe bytes and time")
        }
        val beforeTail = data.bytesRead
        data.positions.clear()
        val tailPackets = mutableListOf<Packet>()
        source.readWindow(48_000_000, 60_000_000) { bytes, at ->
          tailPackets.add(Packet(at, bytes.size, hash(bytes))); false
        }
        verify(tailPackets.size in 135..150, "$name tail window packet count ${tailPackets.size}")
        verify(tailPackets.first().at in 47_850_000..48_000_000, "$name seek starts on the correct sample/preroll")
        verify(tailPackets.last().at > 59_900_000, "$name tail reaches the original end")
        for (packet in tailPackets) {
          verify(expected.any { abs(it.at - packet.at) <= 1 && it.size == packet.size && it.hash == packet.hash }, "$name tail sample equals independent ffprobe bytes and time")
        }
        verify(data.bytesRead - beforeTail < file.length() / 2, "$name tail scan does not read the whole song")
        verify(data.positions.isNotEmpty() && data.positions.min() > file.length() / 2, "$name tail uses sample-table random access")
        var callbackFailed = false
        try { source.readWindow(0, 3_000_000) { _, _ -> throw IOException("fixture consumer failure") } }
        catch (_: IOException) { callbackFailed = true }
        verify(callbackFailed, "$name decoder/consumer failure is propagated without retaining its callback")
        var invalidWindow = false
        val beforeInvalid = data.bytesRead
        try { source.readWindow(0, source.durationUs + 1) { _, _ -> error("invalid window produced data") } }
        catch (_: IllegalArgumentException) { invalidWindow = true }
        verify(invalidWindow && beforeInvalid == data.bytesRead, "$name invalid window cannot read outside the source")
        var consumed = 0
        source.readWindow(0, 12_000_000) { _, _ -> consumed++; true }
        verify(consumed == 1, "$name consumer can stop the leading scan immediately")
        active = false
        var cancelled = false
        try { source.readWindow(48_000_000, 60_000_000) { _, _ -> error("cancelled source produced a packet") } }
        catch (_: CancellationException) { cancelled = true }
        verify(cancelled, "$name obsolete request is cancelled")
      }
      println("PASS $name: ${expected.size} independent reference packets; local reads=${data.bytesRead} bytes")
    }
    boundaryPcm(directory, file.nameWithoutExtension)
  }

  @JvmStatic fun main(args: Array<String>) {
    val directory = File(args.single())
    for (name in listOf("alac16-head.m4a", "alac16-tail.m4a", "alac24-head-cover-padding.m4a", "alac24-tail-cover-padding.m4a")) fixture(directory, name)
    FileData(File(directory, "aac-negative.m4a")).use { data ->
      verify(Mp4AlacSource.open(data) { true } == null, "AAC in the same MP4 container must not be mistaken for ALAC")
    }
    FileData(File(directory, "alac16-head.m4a")).use { data ->
      var cancelled = false
      try { Mp4AlacSource.open(data) { false } }
      catch (_: CancellationException) { cancelled = true }
      verify(cancelled, "an obsolete request is rejected before analysis")
      verify(data.bytesRead == 0L, "a cancelled request performs no file IO")
    }
    for (table in listOf("stsz", "elst", "stco")) {
      FileData(File(directory, "corrupt-$table-count.m4a")).use { data ->
        // Do not catch OutOfMemoryError: a parser allocation is a test failure,
        // not a successful malformed-input rejection.
        val rejected = try { Mp4AlacSource.open(data) { true }?.let { it.close(); false } ?: true }
          catch (_: IOException) { true }
        verify(rejected, "forged $table count in a short moov must be rejected")
        verify(data.bytesRead <= 128 * 1024, "forged $table count is refused before reading audio or allocating from its count (read ${data.bytesRead} bytes)")
        println("PASS corrupt-$table-count.m4a: rejected after ${data.bytesRead} local bytes")
      }
    }
    val continuous = PcmBoundaryScanner(-60.0)
    continuous.feed(ByteBuffer.allocate(480 * 2 * 2), 2, 48000, 2, 0, 0, 2_000_000)
    var gapRejected = false
    try { continuous.feed(ByteBuffer.allocate(480 * 2 * 2), 2, 48000, 2, 1_000_000, 0, 2_000_000) }
    catch (_: IllegalArgumentException) { gapRejected = true }
    verify(gapRejected, "missing PCM packets cannot turn an uninspected timestamp gap into a silent boundary")
    val oversizedHeader = ByteBuffer.allocate(32).putInt(24).put("ftyp".toByteArray())
      .put(ByteArray(16)).putInt(16 * 1024 * 1024 + 1).put("moov".toByteArray()).array()
    var oversizedReads = 0L
    val oversized = object : LocalAudioData {
      override val length = 24L + 16 * 1024 * 1024 + 1
      override fun readAt(position: Long, bytes: ByteArray, offset: Int, length: Int): Int {
        val count = minOf(length.toLong(), this.length - position).toInt()
        bytes.fill(0, offset, offset + count)
        if (position < oversizedHeader.size) {
          val copy = minOf(count, oversizedHeader.size - position.toInt())
          System.arraycopy(oversizedHeader, position.toInt(), bytes, offset, copy)
        }
        oversizedReads += count
        return count
      }
    }
    val rejected = try { Mp4AlacSource.open(oversized) { true } == null } catch (_: IOException) { true }
    verify(rejected, "oversized declared moov is rejected before a parser allocation")
    verify(oversizedReads <= 64, "oversized moov rejection reads only headers, not its declared payload")
    println("Production MP4 ALAC parser / boundary checks passed: $checks")
  }
}
