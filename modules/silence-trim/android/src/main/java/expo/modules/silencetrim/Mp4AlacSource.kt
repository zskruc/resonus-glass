package expo.modules.silencetrim

import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.DummyTrackOutput
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.mp4.Mp4Extractor
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.util.concurrent.CancellationException
import kotlin.math.min

/** Seekable local bytes only; implementations must not open a network source. */
internal interface LocalAudioData {
  val length: Long
  fun readAt(position: Long, bytes: ByteArray, offset: Int, length: Int): Int
}

/**
 * A private MP4 parser for audio inspection, independent of the live player.
 * Android's NuMediaExtractor labels many valid ALAC tracks audio/unknown.
 * Media3's actual sample entry and initialization cookie identify the codec;
 * neither the filename nor an unknown framework MIME is treated as ALAC.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class Mp4AlacSource private constructor(
  private val data: LocalAudioData,
  private val current: () -> Boolean,
) : AutoCloseable {
  private val extractor = Mp4Extractor()
  private val holder = PositionHolder()
  private var input: ExtractorInput? = null
  private var seekMap: SeekMap? = null
  private var audio: AudioTrack? = null
  private var tracksEnded = false
  private var budgetBytes = 0L
  private var deadline = 0L
  private var seeks = 0
  private var steps = 0
  private var stopped = false
  private var windowBeginUs = 0L
  private var windowEndUs = 0L
  private var firstWindowSample = true
  private var consumer: ((ByteArray, Long) -> Boolean)? = null

  val format: Format get() = audio?.format ?: throw IOException("Missing audio format")
  val durationUs: Long get() = seekMap?.durationUs ?: C.TIME_UNSET

  companion object {
    private const val MAX_IO_BYTES = 24L * 1024 * 1024
    private const val MAX_MOOV_BYTES = 16L * 1024 * 1024
    private const val MAX_SAMPLE_BYTES = 2 * 1024 * 1024
    private const val MAX_STEPS = 100_000

    fun open(data: LocalAudioData, current: () -> Boolean): Mp4AlacSource? {
      val source = Mp4AlacSource(data, current)
      return try {
        if (source.prepare()) source else { source.close(); null }
      } catch (error: Exception) { source.close(); throw error }
    }
  }

  private fun resetBudget() {
    budgetBytes = 0
    deadline = System.nanoTime() + 8_000_000_000L
    seeks = 0
    steps = 0
  }

  private fun ensureBudget() {
    if (!current() || Thread.currentThread().isInterrupted) throw CancellationException("Superseded MP4 inspection")
    if (System.nanoTime() > deadline || budgetBytes > MAX_IO_BYTES || seeks > 128 || ++steps > MAX_STEPS)
      throw IOException("Bounded MP4 inspection exhausted")
  }

  private fun read(position: Long, bytes: ByteArray, offset: Int, length: Int): Int {
    ensureBudget()
    if (position < 0 || position > data.length || length < 0 || budgetBytes + length > MAX_IO_BYTES)
      throw IOException("Bounded MP4 read exhausted")
    if (length == 0) return 0
    if (position == data.length) return C.RESULT_END_OF_INPUT
    val count = data.readAt(position, bytes, offset, min(length.toLong(), data.length - position).toInt())
    if (count < 0) return C.RESULT_END_OF_INPUT
    if (count == 0 && length > 0) throw EOFException("MP4 read made no progress")
    budgetBytes += count
    return count
  }

  private fun exact(position: Long, bytes: ByteArray, count: Int) {
    var done = 0
    while (done < count) {
      val n = read(position + done, bytes, done, count - done)
      if (n < 0) throw EOFException("Truncated MP4 box")
      done += n
    }
  }

  /**
   * Bound allocations before Media3 parses a moov/metadata atom. Only box
   * headers are read; mdat payload and large free/padding boxes are skipped by
   * offset, including when moov lives after tens of megabytes of audio.
   */
  private fun safeContainer(): Boolean {
    val header = ByteArray(16)
    var position = 0L
    var boxes = 0
    var moov = false
    while (position < data.length) {
      ensureBudget()
      if (++boxes > 4096 || data.length - position < 8) return false
      exact(position, header, 8)
      var size = unsigned32(header, 0)
      var headerSize = 8
      if (size == 1L) {
        if (data.length - position < 16) return false
        exact(position + 8, header, 8)
        val high = unsigned32(header, 0)
        val low = unsigned32(header, 4)
        if (high > 0x7fffffffL) return false
        size = (high shl 32) or low
        // Restore the type overwritten by the extended size read.
        exact(position + 4, header, 4)
        headerSize = 16
      } else if (size == 0L) size = data.length - position
      if (size < headerSize || size > data.length - position) return false
      val type = if (headerSize == 16) String(header, 0, 4, Charsets.US_ASCII) else String(header, 4, 4, Charsets.US_ASCII)
      if (type == "moov") {
        if (size > MAX_MOOV_BYTES) return false
        val counts = TableLimits()
        if (!safeBoxes(position + headerSize, position + size, 0, "moov", counts)
          || counts.samples * counts.edits > 500_000L) return false
        moov = true
      }
      // A fragmented stream requires a different index. Never walk through
      // every fragment merely to discover a tail for optional inspection.
      if (type == "moof") return false
      position += size
    }
    return moov
  }

  private class TableLimits(var boxes: Int = 0, var samples: Long = 0, var edits: Long = 1)

  /** Guard count-driven allocations before handing a small corrupt moov to Media3. */
  private fun safeBoxes(begin: Long, end: Long, depth: Int, parent: String, limits: TableLimits): Boolean {
    if (depth > 12) return false
    var position = begin
    val header = ByteArray(16)
    while (position < end) {
      ensureBudget()
      if (++limits.boxes > 4096 || end - position < 8) return false
      exact(position, header, 8)
      val type = String(header, 4, 4, Charsets.US_ASCII)
      var size = unsigned32(header, 0)
      var head = 8L
      if (size == 1L) {
        if (end - position < 16) return false
        exact(position + 8, header, 8)
        val high = unsigned32(header, 0)
        if (high > 0x7fffffffL) return false
        size = (high shl 32) or unsigned32(header, 4)
        head = 16
      } else if (size == 0L) size = end - position
      if (size < head || size > end - position) return false
      var payload = position + head
      val finish = position + size
      val length = finish - payload
      fun number(offset: Long): Long {
        if (offset < 0 || offset + 4 > length) throw IOException("Truncated MP4 table")
        exact(payload + offset, header, 4)
        return unsigned32(header, 0)
      }
      fun rows(countOffset: Long, prefix: Long, width: Long, maximum: Long = 250_000): Long {
        val count = number(countOffset)
        if (count > maximum || prefix + count * width > length) throw IOException("Invalid MP4 table count")
        return count
      }
      when (type) {
        "stsz" -> {
          val fixed = number(4)
          val count = rows(8, 12, if (fixed == 0L) 4 else 0)
          limits.samples += count
          if (limits.samples > 250_000) return false
        }
        "stz2" -> {
          val bits = number(4) and 255
          if (bits != 4L && bits != 8L && bits != 16L) return false
          val count = rows(8, 12, 0)
          if (12 + (count * bits + 7) / 8 > length) return false
          limits.samples += count
          if (limits.samples > 250_000) return false
        }
        "stco" -> rows(4, 8, 4)
        "co64" -> rows(4, 8, 8)
        "stsc" -> rows(4, 8, 12)
        "stts", "ctts" -> rows(4, 8, 8)
        "stss" -> rows(4, 8, 4)
        "elst" -> {
          val version = number(0) ushr 24
          if (version > 1) return false
          limits.edits = maxOf(limits.edits, rows(4, 8, if (version == 1L) 20 else 12, 8))
        }
        "keys" -> {
          val count = rows(4, 8, 8, 4096)
          var entry = payload + 8
          repeat(count.toInt()) {
            if (finish - entry < 8) throw IOException("Invalid MP4 metadata key")
            exact(entry, header, 4)
            val entrySize = unsigned32(header, 0)
            if (entrySize < 8 || entrySize > finish - entry) throw IOException("Invalid MP4 metadata key")
            entry += entrySize
          }
        }
        "stsd" -> {
          val count = rows(4, 8, 8, 32)
          var entry = payload + 8
          repeat(count.toInt()) {
            if (finish - entry < 36) throw IOException("Invalid MP4 audio description")
            exact(entry, header, 8)
            val entrySize = unsigned32(header, 0)
            val codec = String(header, 4, 4, Charsets.US_ASCII)
            // Inspection is for ALAC only. Reject other description parsers
            // before their codec-private length fields can allocate memory.
            if (codec != "alac" || entrySize < 36 || entrySize > finish - entry) return false
            exact(entry + 16, header, 2)
            val version = ((header[0].toInt() and 255) shl 8) or (header[1].toInt() and 255)
            val body = when (version) { 0 -> 36L; 1 -> 52L; 2 -> 72L; else -> return false }
            if (entrySize < body || !safeBoxes(entry + body, entry + entrySize, depth + 1, "alac-description", limits)) return false
            entry += entrySize
          }
        }
      }
      if (parent == "alac-description" || parent == "wave") {
        if (type == "alac" && length != 28L) return false
        if (type !in setOf("alac", "btrt", "wave", "chan", "frma", "free")) return false
      }
      val container = type in setOf("trak", "mdia", "minf", "stbl", "edts", "udta", "meta", "ilst", "wave") || parent == "ilst"
      if (container) {
        if (type == "meta") {
          if (length < 4) return false
          // ISO full-box metadata carries version/flags; QuickTime may omit it.
          if (number(0) < 8) payload += 4
        }
        if (!safeBoxes(payload, finish, depth + 1, if (parent == "ilst") "ilst-item" else type, limits)) return false
      }
      position = finish
    }
    return position == end
  }

  private fun unsigned32(bytes: ByteArray, offset: Int): Long =
    ((bytes[offset].toLong() and 255) shl 24) or ((bytes[offset + 1].toLong() and 255) shl 16) or
      ((bytes[offset + 2].toLong() and 255) shl 8) or (bytes[offset + 3].toLong() and 255)

  private fun openInput(position: Long) {
    ensureBudget()
    if (position < 0 || position >= data.length) throw IOException("Invalid MP4 sample position")
    if (++seeks > 128) throw IOException("MP4 seek budget exhausted")
    var cursor = position
    input = DefaultExtractorInput(DataReader { bytes, offset, length ->
      val n = read(cursor, bytes, offset, length)
      if (n > 0) cursor += n
      n
    }, position, data.length)
  }

  private fun prepare(): Boolean {
    resetBudget()
    if (data.length < 16 || !safeContainer()) return false
    openInput(0)
    if (!extractor.sniff(input!!)) return false
    input!!.resetPeekPosition()
    extractor.init(object : ExtractorOutput {
      override fun track(id: Int, type: Int): TrackOutput {
        if (type != C.TRACK_TYPE_AUDIO || audio != null) return DummyTrackOutput()
        return AudioTrack().also { audio = it }
      }
      override fun endTracks() { tracksEnded = true }
      override fun seekMap(map: SeekMap) { seekMap = map }
    })
    while (!tracksEnded || audio?.format == null || seekMap == null) {
      if (!step()) return false
    }
    val format = format
    // MIME is produced by Media3's parsed 'alac' sample entry. Unknown, AAC,
    // encrypted and malformed tracks are not routed to the ALAC decoder.
    return format.sampleMimeType == MimeTypes.AUDIO_ALAC && format.drmInitData == null
      && format.sampleRate in 8_000..384_000 && format.channelCount in 1..32
      && format.initializationData.size == 1 && format.initializationData[0].size in intArrayOf(24, 36)
      && seekMap?.isSeekable == true && durationUs in 1_000_000L..43_200_000_000L
  }

  private fun step(): Boolean {
    ensureBudget()
    return when (extractor.read(input!!, holder)) {
      Extractor.RESULT_END_OF_INPUT -> false
      Extractor.RESULT_SEEK -> { openInput(holder.position); true }
      else -> true
    }
  }

  /** Consumer returns true when enough PCM has been inspected for this edge. */
  fun readWindow(beginUs: Long, endUs: Long, consume: (ByteArray, Long) -> Boolean) {
    require(beginUs >= 0 && endUs > beginUs && endUs <= durationUs)
    resetBudget()
    val point = seekMap!!.getSeekPoints(beginUs).first
    audio!!.clear()
    stopped = false
    windowBeginUs = beginUs
    windowEndUs = endUs
    firstWindowSample = true
    consumer = consume
    try {
      extractor.seek(point.position, beginUs)
      openInput(point.position)
      while (!stopped && step()) { /* Each read emits at most a bounded sample. */ }
    } finally {
      consumer = null
      audio!!.clear()
    }
  }

  override fun close() {
    consumer = null
    input = null
    extractor.release()
  }

  private inner class AudioTrack : TrackOutput {
    var format: Format? = null
    private val pending = ByteArrayOutputStream()
    private val dummy = DummyTrackOutput()
    override fun format(format: Format) { this.format = format }
    fun clear() { pending.reset() }

    override fun sampleData(reader: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
      if (consumer == null) return dummy.sampleData(reader, length, allowEndOfInput, sampleDataPart)
      if (length < 0 || pending.size().toLong() + length > MAX_SAMPLE_BYTES) throw IOException("Oversized ALAC packet")
      val bytes = ByteArray(min(length, 32768))
      val count = reader.read(bytes, 0, bytes.size)
      if (count == C.RESULT_END_OF_INPUT) {
        if (allowEndOfInput) return count
        throw EOFException("Truncated ALAC packet")
      }
      if (count == 0 && length > 0) throw EOFException("ALAC packet made no progress")
      pending.write(bytes, 0, count)
      return count
    }

    override fun sampleData(bytes: ParsableByteArray, length: Int, sampleDataPart: Int) {
      if (consumer == null) { bytes.skipBytes(length); return }
      if (length < 0 || pending.size().toLong() + length > MAX_SAMPLE_BYTES) throw IOException("Oversized ALAC packet")
      val chunk = ByteArray(length)
      bytes.readBytes(chunk, 0, length)
      pending.write(chunk)
    }

    override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
      val consume = consumer ?: return
      if (firstWindowSample) {
        firstWindowSample = false
        if (timeUs < windowBeginUs - 2_000_000L) throw IOException("MP4 seek did not reach requested edge")
      }
      if (timeUs >= windowEndUs) { stopped = true; pending.reset(); return }
      if (cryptoData != null || flags and C.BUFFER_FLAG_ENCRYPTED != 0) throw IOException("Encrypted ALAC packet")
      val all = pending.toByteArray()
      val first = all.size - offset - size
      if (size < 0 || size > MAX_SAMPLE_BYTES || offset < 0 || first < 0) throw IOException("Invalid ALAC packet framing")
      val packet = all.copyOfRange(first, first + size)
      pending.reset()
      if (offset > 0) pending.write(all, all.size - offset, offset)
      stopped = consume(packet, timeUs)
    }
  }
}
