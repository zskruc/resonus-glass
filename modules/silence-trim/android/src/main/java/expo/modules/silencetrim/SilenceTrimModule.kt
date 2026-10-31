package expo.modules.silencetrim

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.Process
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import android.util.Log
import androidx.media3.decoder.ffmpeg.AlacPcmInspector
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * Only examines the beginning and end of seekable local audio. No network
 * data source is accepted, no PCM is kept, and the source is never rewritten.
 *
 * Inspired by Primuse's edge-only RMS boundary policy; this Android decoder
 * and its original-clock result are independently implemented for MediaCodec.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class SilenceTrimModule : Module() {
  private val activeRequest = AtomicReference("")
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread({ Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND); runnable.run() }, "ResonusSilenceTrim")
  }
  private val dispatcher = executor.asCoroutineDispatcher()
  private var cacheLoaded = false
  private var cache = JSONObject()
  // One worker owns this buffer; a playlist never allocates one per packet.
  private val alacPacket by lazy { ByteBuffer.allocateDirect(2 * 1024 * 1024) }

  override fun definition() = ModuleDefinition {
    Name("ResonusSilenceTrim")
    Events("onHeadBoundary")
    Function("activate") { requestId: String -> activeRequest.set(requestId) }
    Function("cancel") { activeRequest.set("") }
    OnDestroy {
      activeRequest.set("")
      dispatcher.close()
      executor.shutdownNow()
    }
    AsyncFunction("inspect") Coroutine { requestId: String, owner: String, localUri: String,
      thresholdDb: Double, minimumSilenceMs: Double, scanSeconds: Double ->
      val context = appContext.reactContext?.applicationContext ?: return@Coroutine null
      withContext(dispatcher) {
        val current = { activeRequest.get() == requestId && !Thread.currentThread().isInterrupted }
        var phase = "open-local"
        try {
          if (!current() || !thresholdDb.isFinite() || !minimumSilenceMs.isFinite() || !scanSeconds.isFinite()) return@withContext null
          val source = openLocal(context, localUri) ?: return@withContext null
          source.descriptor.use { descriptor ->
            val threshold = thresholdDb.coerceIn(-80.0, -35.0)
            val minimumMs = minimumSilenceMs.coerceIn(250.0, 2000.0)
            val scan = scanSeconds.coerceIn(3.0, 20.0)
            val fingerprint = digest("v2|$localUri|${source.length}|${source.modified}")
            val key = digest("$owner|$fingerprint|$threshold|$minimumMs|$scan")
            readCache(context)
            if (source.cacheable) {
              val saved = cache.optJSONObject(key)
              if (saved != null && saved.optString("owner") == owner) {
                return@withContext resultMap(saved, true)
              }
            }
            phase = "framework-metadata"
            val metadata = runCatching { metadata(descriptor) }.getOrNull()
            val mime = metadata?.format?.getString(MediaFormat.KEY_MIME)
            phase = "mp4-identification"
            val indexed = if (mime == null || mime == "audio/unknown" || mime == "audio/alac")
              openIndexedAlac(descriptor, source.length, current) else null
            indexed.use {
              if (indexed == null && (metadata == null || mime == "audio/unknown")) return@withContext null
              val durationUs = indexed?.reader?.durationUs ?: metadata!!.durationUs
              if (durationUs < 1_000_000L || durationUs > 43_200_000_000L) return@withContext null
              val edgeUs = min((scan * 1_000_000).toLong(), durationUs)
              phase = if (indexed != null) "indexed-alac-head" else "codec-head"
              val head = if (indexed != null) decodeIndexedAlacWindow(indexed.reader, 0, edgeUs, threshold, true, current)
                else decodeWindow(descriptor, metadata!!, 0, edgeUs, threshold, true, current)
              ensureCurrent(current)
              val padUs = 100_000L
              val detectedHead = if (!head.coveredStart) 0L else head.firstAudibleUs ?: if (head.coveredEnd) edgeUs else 0L
              var startUs = if (detectedHead >= minimumMs * 1000) max(0, detectedHead - padUs) else 0
              // Do not discard a whole short/quiet file based on a boundary scan.
              if (startUs > durationUs - 1_000_000L) startUs = 0
              val partial = mapOf(
                "requestId" to requestId, "fingerprint" to fingerprint,
                "durationSec" to durationUs / 1_000_000.0,
                "startSec" to startUs / 1_000_000.0,
                "endSec" to durationUs / 1_000_000.0, "complete" to false, "cached" to false,
              )
              if (current()) sendEvent("onHeadBoundary", partial)
              val beginTailUs = max(0, durationUs - edgeUs)
              phase = if (indexed != null) "indexed-alac-tail" else "codec-tail"
              val tail = if (indexed != null) decodeIndexedAlacWindow(indexed.reader, beginTailUs, durationUs, threshold, false, current)
                else decodeWindow(descriptor, metadata!!, beginTailUs, durationUs, threshold, false, current)
              ensureCurrent(current)
              val lastAudible = tail.lastAudibleUs ?: beginTailUs
              val quietTailUs = durationUs - lastAudible
              var endUs = if (tail.coveredEnd && quietTailUs >= minimumMs * 1000)
                min(durationUs, lastAudible + padUs) else durationUs
              if (endUs - startUs < 1_000_000L) endUs = durationUs
              val saved = JSONObject().put("owner", owner).put("fingerprint", fingerprint)
                .put("durationSec", durationUs / 1_000_000.0).put("startSec", startUs / 1_000_000.0)
                .put("endSec", endUs / 1_000_000.0)
              if (source.cacheable) {
                cache.remove(key)
                while (cache.length() >= 512) cache.remove(cache.keys().next())
                cache.put(key, saved)
                persistCache(context)
              }
              phase = "complete"
              resultMap(saved, false)
            }
          }
        } catch (_: CancellationException) {
          null
        } catch (error: Exception) {
          // Never include the source URI, metadata or an exception message:
          // diagnostics distinguish the failing stage without private paths.
          Log.w("ResonusSilenceTrim", "Unavailable: $phase/${error.javaClass.simpleName}")
          // Unsupported codecs, nonseekable files or decoder errors preserve
          // ordinary playback. They are not proof of a silent boundary.
          null
        }
      }
    }
    AsyncFunction("clearCache") Coroutine { owner: String ->
      val context = appContext.reactContext?.applicationContext ?: return@Coroutine
      withContext(dispatcher) {
        readCache(context)
        cache.keys().asSequence().toList().forEach { key ->
          if (cache.optJSONObject(key)?.optString("owner") == owner) cache.remove(key)
        }
        persistCache(context)
      }
    }
  }

  private data class LocalSource(val descriptor: AssetFileDescriptor, val length: Long, val modified: Long) {
    val cacheable: Boolean get() = length > 0 && modified > 0
  }
  private data class Metadata(val track: Int, val format: MediaFormat, val durationUs: Long)
  private data class Window(val firstAudibleUs: Long?, val lastAudibleUs: Long?, val coveredEnd: Boolean, val coveredStart: Boolean)

  private fun openLocal(context: Context, text: String): LocalSource? {
    val uri = Uri.parse(text)
    if (uri.scheme == "file" && (uri.host.isNullOrEmpty() || uri.host == "localhost")) {
      val file = File(uri.path ?: return null)
      if (!file.isFile || file.length() <= 0) return null
      val descriptor = AssetFileDescriptor(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY), 0, file.length())
      return LocalSource(descriptor, file.length(), file.lastModified())
    }
    // MediaStore is a local library. Arbitrary content providers (cloud drives
    // in particular) are deliberately excluded from background inspection.
    if (uri.scheme != "content" || uri.authority != "media") return null
    var size = 0L
    var modified = 0L
    runCatching {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
          val modifiedColumn = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
          if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn)
          if (modifiedColumn >= 0 && !cursor.isNull(modifiedColumn)) modified = cursor.getLong(modifiedColumn) * 1000
        }
      }
    }
    val descriptor = context.contentResolver.openAssetFileDescriptor(uri, "r") ?: return null
    try {
      Os.lseek(descriptor.fileDescriptor, 0L, OsConstants.SEEK_CUR)
      val length = if (descriptor.declaredLength > 0) descriptor.declaredLength else size
      if (length <= 0) { descriptor.close(); return null }
      return LocalSource(descriptor, length, modified)
    } catch (_: Exception) { descriptor.close(); return null }
  }

  private fun extractor(descriptor: AssetFileDescriptor): MediaExtractor {
    val extractor = MediaExtractor()
    try {
      if (descriptor.declaredLength >= 0) extractor.setDataSource(descriptor.fileDescriptor, descriptor.startOffset, descriptor.declaredLength)
      else extractor.setDataSource(descriptor.fileDescriptor)
      return extractor
    } catch (error: Exception) { extractor.release(); throw error }
  }

  private fun metadata(descriptor: AssetFileDescriptor): Metadata? {
    val extractor = extractor(descriptor)
    try {
      for (track in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(track)
        if (format.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true && format.containsKey(MediaFormat.KEY_DURATION)) {
          return Metadata(track, format, format.getLong(MediaFormat.KEY_DURATION))
        }
      }
      return null
    } finally { extractor.release() }
  }

  private class IndexedAlac(val reader: Mp4AlacSource, private val stream: ParcelFileDescriptor.AutoCloseInputStream) : AutoCloseable {
    override fun close() { try { reader.close() } finally { stream.close() } }
  }

  private fun openIndexedAlac(descriptor: AssetFileDescriptor, length: Long, current: () -> Boolean): IndexedAlac? {
    // A duplicate owns its lifetime; positional reads never move another
    // consumer's descriptor or borrow/close the live audio player's source.
    val stream = ParcelFileDescriptor.AutoCloseInputStream(ParcelFileDescriptor.dup(descriptor.fileDescriptor))
    try {
      val data = object : LocalAudioData {
        override val length = length
        override fun readAt(position: Long, bytes: ByteArray, offset: Int, length: Int): Int =
          stream.channel.read(ByteBuffer.wrap(bytes, offset, length), descriptor.startOffset + position)
      }
      val reader = Mp4AlacSource.open(data, current)
      if (reader == null) { stream.close(); return null }
      Log.d("ResonusSilenceTrim", "Identified indexed ALAC")
      return IndexedAlac(reader, stream)
    } catch (error: Exception) { stream.close(); throw error }
  }

  private fun decodeIndexedAlacWindow(reader: Mp4AlacSource, beginUs: Long, endUs: Long,
                                     thresholdDb: Double, stopAtFirstSound: Boolean, current: () -> Boolean): Window {
    val format = reader.format
    val scanner = PcmBoundaryScanner(thresholdDb)
    var frames = 0L
    val deadline = System.nanoTime() + 8_000_000_000L
    AlacPcmInspector(format.sampleRate, format.channelCount, format.initializationData[0]).use { decoder ->
      reader.readWindow(beginUs, endUs) { packet, time ->
        ensureCurrent(current)
        if (System.nanoTime() > deadline || frames > ((endUs - beginUs) / 1_000_000.0 + 2) * format.sampleRate)
          throw IllegalStateException("Bounded indexed ALAC edge scan exhausted")
        val pcm = decoder.decode(ByteBuffer.wrap(packet), time) ?: throw IllegalStateException("Missing ALAC PCM")
        frames += scanner.feed(pcm, decoder.encoding(), decoder.sampleRate(), decoder.channelCount(), time, beginUs, endUs)
        (stopAtFirstSound && scanner.firstAudibleUs != null) || scanner.lastSeenUs >= endUs - 20_000
      }
    }
    scanner.flush()
    val coveredStart = scanner.firstSeenUs?.let { it <= beginUs + 100_000 } == true
    val coveredEnd = scanner.lastSeenUs >= endUs - 20_000
    return Window(scanner.firstAudibleUs, scanner.lastAudibleEndUs, coveredEnd && coveredStart, coveredStart)
  }

  private fun decodeWindow(descriptor: AssetFileDescriptor, metadata: Metadata, beginUs: Long, endUs: Long,
                           thresholdDb: Double, stopAtFirstSound: Boolean, current: () -> Boolean): Window {
    if (metadata.format.getString(MediaFormat.KEY_MIME) == "audio/alac") {
      return decodeAlacWindow(descriptor, metadata, beginUs, endUs, thresholdDb, stopAtFirstSound, current)
    }
    val extractor = extractor(descriptor)
    var codec: MediaCodec? = null
    var started = false
    try {
      extractor.selectTrack(metadata.track)
      extractor.seekTo(beginUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val format = metadata.format
      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      codec.configure(format, null, null, 0)
      codec.start()
      started = true
      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var encoding = AudioFormat.ENCODING_PCM_16BIT
      var decodedFrames = 0L
      var inputBytes = 0L
      var inputDone = false
      var stopInput = false
      var outputDone = false
      var coveredEnd = false
      val deadline = System.nanoTime() + 8_000_000_000L
      val scanner = PcmBoundaryScanner(thresholdDb)
      val info = MediaCodec.BufferInfo()
      while (!outputDone) {
        ensureCurrent(current)
        if (System.nanoTime() > deadline || inputBytes > 24L * 1024 * 1024
          || decodedFrames > ((endUs - beginUs) / 1_000_000.0 + 2) * rate) {
          throw IllegalStateException("Bounded edge scan exhausted")
        }
        if (!inputDone) {
          val index = codec.dequeueInputBuffer(10_000)
          if (index >= 0) {
            val input = codec.getInputBuffer(index) ?: throw IllegalStateException("No input buffer")
            input.clear()
            val size = if (stopInput) -1 else extractor.readSampleData(input, 0)
            if (size < 0) {
              codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              val time = extractor.sampleTime
              inputBytes += size
              codec.queueInputBuffer(index, 0, size, time, 0)
              extractor.advance()
              // Let the decoder drain the packet crossing the desired end.
              if (time > endUs + 250_000) stopInput = true
            }
          }
        }
        when (val index = codec.dequeueOutputBuffer(info, 10_000)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val output = codec.outputFormat
            rate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            encoding = if (output.containsKey(MediaFormat.KEY_PCM_ENCODING)) output.getInteger(MediaFormat.KEY_PCM_ENCODING)
              else AudioFormat.ENCODING_PCM_16BIT
          }
          MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
          else -> if (index >= 0) {
            try {
              if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                val output = codec.getOutputBuffer(index) ?: throw IllegalStateException("No output buffer")
                output.position(info.offset)
                output.limit(info.offset + info.size)
                decodedFrames += scanner.feed(output.slice(), encoding, rate, channels, info.presentationTimeUs, beginUs, endUs)
                if (stopAtFirstSound && scanner.firstAudibleUs != null) outputDone = true
                if (scanner.lastSeenUs >= endUs - 20_000) { coveredEnd = true; outputDone = true }
              }
              if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                coveredEnd = scanner.lastSeenUs >= endUs - 100_000
                outputDone = true
              }
            } finally { codec.releaseOutputBuffer(index, false) }
          }
        }
      }
      scanner.flush()
      // Tail seek must actually cover the requested region. A codec silently
      // ignoring its seek cannot turn an unrelated early buffer into a trim.
      val coveredStart = scanner.firstSeenUs?.let { it <= beginUs + 100_000 } == true
      return Window(scanner.firstAudibleUs, scanner.lastAudibleEndUs, coveredEnd && coveredStart, coveredStart)
    } finally {
      if (started) runCatching { codec?.stop() }
      runCatching { codec?.release() }
      extractor.release()
    }
  }

  private fun decodeAlacWindow(descriptor: AssetFileDescriptor, metadata: Metadata, beginUs: Long, endUs: Long,
                               thresholdDb: Double, stopAtFirstSound: Boolean, current: () -> Boolean): Window {
    val extractor = extractor(descriptor)
    try {
      extractor.selectTrack(metadata.track)
      extractor.seekTo(beginUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val format = metadata.format
      val config = format.getByteBuffer("csd-0")?.duplicate() ?: throw IllegalArgumentException("No ALAC configuration")
      val cookie = ByteArray(config.remaining())
      config.get(cookie)
      AlacPcmInspector(format.getInteger(MediaFormat.KEY_SAMPLE_RATE), format.getInteger(MediaFormat.KEY_CHANNEL_COUNT), cookie).use { decoder ->
        val packet = alacPacket
        val scanner = PcmBoundaryScanner(thresholdDb)
        val deadline = System.nanoTime() + 8_000_000_000L
        var bytes = 0L
        var frames = 0L
        var coveredEnd = false
        while (true) {
          ensureCurrent(current)
          if (System.nanoTime() > deadline || bytes > 24L * 1024 * 1024
            || frames > ((endUs - beginUs) / 1_000_000.0 + 2) * max(1, format.getInteger(MediaFormat.KEY_SAMPLE_RATE))) {
            throw IllegalStateException("Bounded ALAC edge scan exhausted")
          }
          packet.clear()
          val length = extractor.readSampleData(packet, 0)
          if (length < 0) { coveredEnd = scanner.lastSeenUs >= endUs - 100_000; break }
          val time = extractor.sampleTime
          packet.position(0)
          packet.limit(length)
          bytes += length
          val pcm = decoder.decode(packet, time) ?: throw IllegalStateException("Missing ALAC PCM")
          frames += scanner.feed(pcm, decoder.encoding(), decoder.sampleRate(), decoder.channelCount(), time, beginUs, endUs)
          if (stopAtFirstSound && scanner.firstAudibleUs != null) break
          if (scanner.lastSeenUs >= endUs - 20_000) { coveredEnd = true; break }
          if (!extractor.advance()) { coveredEnd = scanner.lastSeenUs >= endUs - 100_000; break }
        }
        scanner.flush()
        val coveredStart = scanner.firstSeenUs?.let { it <= beginUs + 100_000 } == true
        return Window(scanner.firstAudibleUs, scanner.lastAudibleEndUs, coveredEnd && coveredStart, coveredStart)
      }
    } finally { extractor.release() }
  }

  private fun ensureCurrent(current: () -> Boolean) {
    if (!current()) throw CancellationException("Superseded edge analysis")
  }

  private fun readCache(context: Context) {
    if (cacheLoaded) return
    cacheLoaded = true
    val file = File(context.filesDir, "silence-boundaries-v1.json")
    if (file.isFile && file.length() <= 512 * 1024) cache = runCatching { JSONObject(file.readText()) }.getOrElse { JSONObject() }
  }

  private fun persistCache(context: Context) {
    runCatching {
      val file = File(context.filesDir, "silence-boundaries-v1.json")
      val temporary = File(context.filesDir, "silence-boundaries-v1.tmp")
      temporary.writeText(cache.toString())
      if (!temporary.renameTo(file)) temporary.delete()
    }
  }

  private fun resultMap(saved: JSONObject, cached: Boolean): Map<String, Any> = mapOf(
    "fingerprint" to saved.getString("fingerprint"), "durationSec" to saved.getDouble("durationSec"),
    "startSec" to saved.getDouble("startSec"), "endSec" to saved.getDouble("endSec"),
    "complete" to true, "cached" to cached,
  )

  private fun digest(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
    .joinToString("") { "%02x".format(it.toInt() and 255) }
}
