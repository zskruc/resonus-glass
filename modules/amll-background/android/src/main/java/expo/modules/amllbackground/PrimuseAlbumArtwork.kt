package expo.modules.amllbackground

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.roundToInt

/** One bounded, static local atmosphere per cover/blur ratio; never runs during scrolling. */
internal object PrimuseAlbumArtwork {
  private const val VERSION = 2
  private const val MAX_DECODE_SIDE = 480
  private const val MAX_SOURCE_BYTES = 32L * 1024 * 1024
  private const val MAX_CACHE_ENTRIES = 32
  private const val MAX_CACHE_BYTES = 8L * 1024 * 1024
  private const val CACHE_DIRECTORY = "resonus-primuse-album-v1"
  private val lock = Any()
  private val memory = object : LinkedHashMap<String, Result>(MAX_CACHE_ENTRIES, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Result>?): Boolean = size > MAX_CACHE_ENTRIES
  }
  private data class Source(val uri: Uri, val file: File?) {
    fun open(context: Context): InputStream? = file?.inputStream() ?: context.contentResolver.openInputStream(uri)
  }
  private data class Result(val textureUri: String, val width: Int, val height: Int, val textureScale: Double, val primary: String) {
    fun toMap(): Map<String, Any> = mapOf("textureUri" to textureUri, "width" to width, "height" to height,
      "textureScale" to textureScale, "primary" to primary)
  }

  /** Serialized CPU work bounds bitmap allocations even when several routes request covers together. */
  fun prepare(context: Context, localUri: String, blurRatio: Double): Map<String, Any>? = synchronized(lock) {
    val ratio = PrimuseAlbumArtworkMath.normalizedBlurRatio(blurRatio) ?: return@synchronized null
    val uri = try { Uri.parse(localUri) } catch (_: Exception) { return@synchronized null }
    if (uri.scheme != "file" && uri.scheme != "content") return@synchronized null
    val source = Source(uri, if (uri.scheme == "file") uri.path?.let(::File) else null)
    if (uri.scheme == "file" && (source.file?.isFile != true || source.file.length() !in 1..MAX_SOURCE_BYTES)) return@synchronized null
    var temporaryImage: File? = null; var temporaryMetadata: File? = null; var writtenImage: File? = null
    try {
      val directory = File(context.cacheDir, CACHE_DIRECTORY)
      if (!directory.isDirectory && !directory.mkdirs()) return@synchronized null
      val identity = sourceIdentity(context, source) ?: return@synchronized null
      val key = digest("$VERSION|$identity|${PrimuseAlbumArtworkMath.TEXTURE_SIDE}|$ratio")
      val image = File(directory, "$key.png"); val metadata = File(directory, "$key.json")
      val geometry = PrimuseAlbumArtworkMath.textureGeometry(PrimuseAlbumArtworkMath.TEXTURE_SIDE,
        ratio * PrimuseAlbumArtworkMath.TEXTURE_SIDE)
      val cached = memory[key] ?: readResult(metadata, image, geometry)
      if (cached != null && validTexture(image, geometry.side)) {
        memory[key] = cached
        val now = System.currentTimeMillis(); image.setLastModified(now); metadata.setLastModified(now)
        return@synchronized cached.toMap()
      }
      memory.remove(key)
      image.delete(); metadata.delete()

      val decoded = decode(context, source) ?: return@synchronized null
      val size = PrimuseAlbumArtworkMath.TEXTURE_SIDE
      var square: Bitmap? = null; var sample: Bitmap? = null
      val primary: Int?
      val field: IntArray
      try {
        val working = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        square = working
        // Color extraction sees the entire image at40×40, exactly the region
        // sampled by Primuse. Display atmosphere uses a centered square crop.
        sample = Bitmap.createScaledBitmap(decoded, PrimuseAlbumArtworkMath.SAMPLE_SIDE, PrimuseAlbumArtworkMath.SAMPLE_SIDE, true)
        val colors = IntArray(PrimuseAlbumArtworkMath.SAMPLE_SIDE * PrimuseAlbumArtworkMath.SAMPLE_SIDE)
        sample.getPixels(colors, 0, PrimuseAlbumArtworkMath.SAMPLE_SIDE, 0, 0,
          PrimuseAlbumArtworkMath.SAMPLE_SIDE, PrimuseAlbumArtworkMath.SAMPLE_SIDE)
        primary = PrimuseAlbumArtworkMath.primary(colors)
        val cropSide = minOf(decoded.width, decoded.height)
        val left = (decoded.width - cropSide) / 2; val top = (decoded.height - cropSide) / 2
        Canvas(working).drawBitmap(decoded, Rect(left, top, left + cropSide, top + cropSide),
          RectF(0f, 0f, size.toFloat(), size.toFloat()), Paint(Paint.FILTER_BITMAP_FLAG))
        val pixels = IntArray(size * size)
        working.getPixels(pixels, 0, size, 0, 0, size, size)
        field = PrimuseAlbumArtworkMath.paddedTexture(pixels, size, ratio * size)
      } finally {
        if (sample != null && sample !== decoded) sample.recycle()
        square?.recycle(); decoded.recycle()
      }
      val bitmap = Bitmap.createBitmap(field, geometry.side, geometry.side, Bitmap.Config.ARGB_8888)
      temporaryImage = File(directory, "$key.png.tmp")
      try {
        temporaryImage.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
      } finally { bitmap.recycle() }
      if (!temporaryImage.renameTo(image)) return@synchronized null
      temporaryImage = null; writtenImage = image
      val color = "#%06x".format((primary ?: 0) and 0x00ffffff)
      val result = Result(Uri.fromFile(image).toString(), geometry.side, geometry.side, geometry.scale, color)
      temporaryMetadata = File(directory, "$key.json.tmp")
      temporaryMetadata.writeText(JSONObject(result.toMap()).toString())
      if (!temporaryMetadata.renameTo(metadata)) return@synchronized null
      temporaryMetadata = null; writtenImage = null
      memory[key] = result
      prune(directory, image)
      result.toMap()
    } catch (_: Exception) { null }
    catch (_: OutOfMemoryError) { null }
    finally {
      temporaryImage?.delete(); temporaryMetadata?.delete(); writtenImage?.delete()
    }
  }

  private fun sourceIdentity(context: Context, source: Source): String? {
    source.file?.let { return "${it.canonicalPath}|${it.length()}|${it.lastModified()}" }
    val size = try { context.contentResolver.openFileDescriptor(source.uri, "r")?.use { it.statSize } ?: -1L }
      catch (_: Exception) { -1L }
    if (size > MAX_SOURCE_BYTES || size == 0L) return null
    val modified = try {
      context.contentResolver.query(source.uri, arrayOf("last_modified"), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getLong(0) else 0L
      } ?: 0L
    } catch (_: Exception) { 0L }
    // Providers without a revision/size cannot safely reuse the previous URI's
    // pixels after an in-place change. A bounded local digest supplies identity.
    val fingerprint = if (size <= 0 || modified <= 0) {
      val digest = MessageDigest.getInstance("SHA-256")
      val buffer = ByteArray(16384); var count = 0L
      source.open(context)?.use { input ->
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          count += read
          if (count > MAX_SOURCE_BYTES) return null
          digest.update(buffer, 0, read)
        }
      } ?: return null
      if (count == 0L) return null
      digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    } else ""
    return "${source.uri}|$size|$modified|$fingerprint"
  }

  private fun decode(context: Context, source: Source): Bitmap? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val input = source.file?.let { ImageDecoder.createSource(it) } ?: ImageDecoder.createSource(context.contentResolver, source.uri)
      return ImageDecoder.decodeBitmap(input) { decoder, info, _ ->
        val width = info.size.width; val height = info.size.height
        require(width in 1..32768 && height in 1..32768)
        val factor = minOf(1.0, MAX_DECODE_SIDE.toDouble() / max(width, height))
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
        // ImageDecoder applies the source EXIF orientation before returning.
        decoder.setTargetSize((width * factor).roundToInt().coerceAtLeast(1), (height * factor).roundToInt().coerceAtLeast(1))
      }
    }
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true; inSampleSize = 1 }
    source.open(context)?.use { BitmapFactory.decodeStream(it, null, options) }
    if (options.outWidth !in 1..32768 || options.outHeight !in 1..32768) return null
    options.inJustDecodeBounds = false; options.inPreferredConfig = Bitmap.Config.ARGB_8888
    while (max(options.outWidth, options.outHeight) / options.inSampleSize > MAX_DECODE_SIDE) options.inSampleSize *= 2
    val bitmap = source.open(context)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    val orientation = try { source.open(context)?.use { ExifInterface(it).getAttributeInt(
      ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } ?: ExifInterface.ORIENTATION_NORMAL }
      catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(270f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
    }
    if (matrix.isIdentity) return bitmap
    return try { Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true).also {
      if (it !== bitmap) bitmap.recycle()
    } } catch (error: Exception) { bitmap.recycle(); throw error }
  }

  private fun readResult(metadata: File, image: File, geometry: PrimuseAlbumArtworkMath.TextureGeometry): Result? = try {
    if (!metadata.isFile || metadata.length() !in 1..2048) null else {
      val json = JSONObject(metadata.readText())
      val color = json.getString("primary")
      require(Regex("^#[0-9a-fA-F]{6}$").matches(color))
      require(json.getInt("width") == geometry.side && json.getInt("height") == geometry.side)
      require(json.getDouble("textureScale") == geometry.scale)
      val expected = Uri.fromFile(image).toString()
      require(json.getString("textureUri") == expected)
      Result(expected, geometry.side, geometry.side, geometry.scale, color)
    }
  } catch (_: Exception) { null }

  private fun validTexture(image: File, side: Int): Boolean {
    if (!image.isFile || image.length() !in 1..4 * 1024 * 1024) return false
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(image.path, options)
    return options.outWidth == side && options.outHeight == side
      && options.outMimeType == "image/png"
  }

  private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }

  private fun prune(directory: File, keep: File) {
    val images = directory.listFiles { file -> file.extension == "png" }?.sortedByDescending { it.lastModified() } ?: return
    var bytes = 0L; var count = 0
    for (file in images) {
      bytes += file.length(); count++
      if (file != keep && (count > MAX_CACHE_ENTRIES || bytes > MAX_CACHE_BYTES)) {
        file.delete(); File(directory, "${file.nameWithoutExtension}.json").delete(); memory.remove(file.nameWithoutExtension)
      }
    }
    directory.listFiles { file -> file.name.endsWith(".tmp") }?.forEach { it.delete() }
  }
}
