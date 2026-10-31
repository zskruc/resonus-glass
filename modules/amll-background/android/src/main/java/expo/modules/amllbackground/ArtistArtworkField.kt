package expo.modules.amllbackground

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.roundToInt

/** One background preparation per source/crop; never captures a window or runs on a frame clock. */
internal object ArtistArtworkField {
  private const val VERSION = 4
  private const val MAX_DECODE_SIDE = 480
  private const val MAX_CACHE_ENTRIES = 32
  private const val MAX_CACHE_BYTES = 8L * 1024 * 1024
  private const val CACHE_DIRECTORY = "resonus-artist-artwork-v1"
  private val lock = Any()
  private val memory = object : LinkedHashMap<String, Result>(MAX_CACHE_ENTRIES, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Result>?): Boolean = size > MAX_CACHE_ENTRIES
  }

  private data class Source(val uri: Uri, val file: File?) {
    fun open(context: Context): InputStream? = file?.inputStream() ?: context.contentResolver.openInputStream(uri)
  }
  private data class Decoded(val bitmap: Bitmap, val sourceWidth: Int, val sourceHeight: Int)
  private data class Result(
    val textureUri: String, val width: Int, val height: Int,
    val lowerMean: String, val lowerEdgeMean: String, val lowerCenterMean: String, val average: String,
    val sourceBackground: String, val sourceFingerprint: String,
    val sourceWidth: Int, val sourceHeight: Int,
  ) {
    fun toMap(): Map<String, Any> = mapOf("textureUri" to textureUri, "width" to width, "height" to height,
      "lowerMean" to lowerMean, "lowerEdgeMean" to lowerEdgeMean, "lowerCenterMean" to lowerCenterMean,
      "average" to average, "sourceBackground" to sourceBackground, "sourceFingerprint" to sourceFingerprint,
      "sourceWidth" to sourceWidth, "sourceHeight" to sourceHeight)
    fun toJson(): JSONObject = JSONObject(toMap())
  }

  /** Runs on a CPU dispatcher, outside Expo's shared async queue; bounds concurrent allocations. */
  fun prepare(context: Context, localUri: String, aspect: Double, extension: Double): Map<String, Any>? = synchronized(lock) {
    val geometry = ArtistArtworkMath.geometry(aspect, extension) ?: return@synchronized null
    val uri = try { Uri.parse(localUri) } catch (_: Exception) { return@synchronized null }
    if (uri.scheme != "file" && uri.scheme != "content") return@synchronized null
    val source = Source(uri, if (uri.scheme == "file") uri.path?.let(::File) else null)
    if (uri.scheme == "file" && source.file?.isFile != true) return@synchronized null
    try {
      val directory = File(context.cacheDir, CACHE_DIRECTORY)
      if (!directory.isDirectory && !directory.mkdirs()) return@synchronized null
      val identity = sourceIdentity(context, source)
      val key = digest("$VERSION|$identity|${geometry.width}|${geometry.photoHeight}|${geometry.extensionHeight}")
      val image = File(directory, "$key.png")
      val metadata = File(directory, "$key.json")
      val cached = memory[key] ?: readResult(metadata)
      if (cached != null && image.isFile && image.length() > 0) {
        memory[key] = cached
        val now = System.currentTimeMillis(); image.setLastModified(now); metadata.setLastModified(now)
        return@synchronized cached.toMap()
      }

      val decoded = decode(context, source) ?: return@synchronized null
      val field = try {
        val pixels = IntArray(decoded.bitmap.width * decoded.bitmap.height)
        decoded.bitmap.getPixels(pixels, 0, decoded.bitmap.width, 0, 0, decoded.bitmap.width, decoded.bitmap.height)
        ArtistArtworkMath.prepare(pixels, decoded.bitmap.width, decoded.bitmap.height, geometry)
      } finally { decoded.bitmap.recycle() }
      val bitmap = Bitmap.createBitmap(field.pixels, geometry.width, geometry.height, Bitmap.Config.ARGB_8888)
      val imageTemporary = File(directory, "$key.png.tmp")
      try {
        imageTemporary.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
      } finally { bitmap.recycle() }
      if (!imageTemporary.renameTo(image)) { imageTemporary.delete(); return@synchronized null }
      fun hex(color: Int) = "#%06x".format(color and 0x00ffffff)
      val result = Result(Uri.fromFile(image).toString(), geometry.width, geometry.height,
        hex(field.colors.lowerMean), hex(field.colors.lowerEdgeMean), hex(field.colors.lowerCenterMean),
        hex(field.colors.average), hex(field.colors.sourceBackground), field.sourceFingerprint,
        decoded.sourceWidth, decoded.sourceHeight)
      val metadataTemporary = File(directory, "$key.json.tmp")
      metadataTemporary.writeText(result.toJson().toString())
      if (!metadataTemporary.renameTo(metadata)) { metadataTemporary.delete(); image.delete(); return@synchronized null }
      memory[key] = result
      prune(directory, image)
      result.toMap()
    } catch (_: Exception) { null }
  }

  private fun sourceIdentity(context: Context, source: Source): String {
    source.file?.let { return "${it.canonicalPath}|${it.length()}|${it.lastModified()}" }
    val size = try { context.contentResolver.openFileDescriptor(source.uri, "r")?.use { it.statSize } ?: -1L }
      catch (_: Exception) { -1L }
    val modified = try {
      context.contentResolver.query(source.uri, arrayOf("last_modified"), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getLong(0) else 0L
      } ?: 0L
    } catch (_: Exception) { 0L }
    return "${source.uri}|$size|$modified"
  }

  private fun decode(context: Context, source: Source): Decoded? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      var originalWidth = 0; var originalHeight = 0
      val input = source.file?.let { ImageDecoder.createSource(it) } ?: ImageDecoder.createSource(context.contentResolver, source.uri)
      val bitmap = ImageDecoder.decodeBitmap(input) { decoder, info, _ ->
        originalWidth = info.size.width; originalHeight = info.size.height
        val factor = minOf(1.0, MAX_DECODE_SIDE.toDouble() / max(originalWidth, originalHeight))
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
        decoder.setTargetSize((originalWidth * factor).roundToInt().coerceAtLeast(1),
          (originalHeight * factor).roundToInt().coerceAtLeast(1))
      }
      return Decoded(bitmap, originalWidth, originalHeight)
    }
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true; inSampleSize = 1 }
    source.open(context)?.use { BitmapFactory.decodeStream(it, null, options) }
    if (options.outWidth <= 0 || options.outHeight <= 0) return null
    val originalWidth = options.outWidth; val originalHeight = options.outHeight
    options.inJustDecodeBounds = false; options.inPreferredConfig = Bitmap.Config.ARGB_8888
    while (max(originalWidth, originalHeight) / options.inSampleSize > MAX_DECODE_SIDE) options.inSampleSize *= 2
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
    val rotates = orientation in ExifInterface.ORIENTATION_TRANSPOSE..ExifInterface.ORIENTATION_ROTATE_270
    if (matrix.isIdentity) return Decoded(bitmap, originalWidth, originalHeight)
    val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (oriented !== bitmap) bitmap.recycle()
    return Decoded(oriented, if (rotates) originalHeight else originalWidth, if (rotates) originalWidth else originalHeight)
  }

  private fun readResult(metadata: File): Result? = try {
    val json = JSONObject(metadata.readText())
    Result(json.getString("textureUri"), json.getInt("width"), json.getInt("height"),
      json.getString("lowerMean"), json.getString("lowerEdgeMean"), json.getString("lowerCenterMean"),
      json.getString("average"), json.getString("sourceBackground"), json.getString("sourceFingerprint").also {
        require(it.length == 1536 && it.all { character -> character in '0'..'9' || character in 'a'..'f' })
      }, json.getInt("sourceWidth"), json.getInt("sourceHeight"))
  } catch (_: Exception) { null }

  private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }

  private fun prune(directory: File, keep: File) {
    val images = directory.listFiles { file -> file.extension == "png" }?.sortedByDescending { it.lastModified() } ?: return
    var bytes = 0L; var count = 0
    for (file in images) {
      bytes += file.length(); count++
      if (file != keep && (count > MAX_CACHE_ENTRIES || bytes > MAX_CACHE_BYTES)) {
        file.delete()
        File(directory, "${file.nameWithoutExtension}.json").delete()
        memory.remove(file.nameWithoutExtension)
      }
    }
    directory.listFiles { file -> file.name.endsWith(".tmp") }?.forEach { it.delete() }
  }
}
