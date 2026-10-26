package expo.modules.amllbackground

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.LruCache
import java.io.File
import java.io.InputStream
import java.util.concurrent.Future
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Shares tiny processed textures only. Network policy remains with Expo Image. */
internal object ArtworkTextures {
  private val cache = LruCache<String, Bitmap>(8)
  private val worker = ThreadPoolExecutor(1, 1, 15L, TimeUnit.SECONDS,
    LinkedBlockingQueue(), { task -> Thread(task, "resonus-artwork-field").apply { isDaemon = true } })
    .apply { allowCoreThreadTimeOut(true) }

  fun get(uri: String): Bitmap? = synchronized(cache) { cache.get(uri) }

  fun cancel(task: Future<*>?) {
    task?.cancel(true)
    worker.purge()
  }

  fun load(context: Context, uri: String, stillWanted: () -> Boolean, result: (Bitmap?) -> Unit): Future<*> =
    worker.submit {
      if (!stillWanted()) return@submit
      val cached = get(uri)
      if (cached != null) {
        if (stillWanted()) result(cached)
        return@submit
      }
      val texture = try {
        decodeLocal(context, uri)?.let { decoded ->
          try {
            val pixels = IntArray(ArtworkFieldMath.TEXTURE_SIZE * ArtworkFieldMath.TEXTURE_SIZE)
            decoded.getPixels(pixels, 0, ArtworkFieldMath.TEXTURE_SIZE, 0, 0,
              ArtworkFieldMath.TEXTURE_SIZE, ArtworkFieldMath.TEXTURE_SIZE)
            for (index in pixels.indices) pixels[index] = ArtworkFieldMath.shapeColor(pixels[index])
            ArtworkFieldMath.soften(pixels, ArtworkFieldMath.TEXTURE_SIZE, ArtworkFieldMath.TEXTURE_SIZE)
            Bitmap.createBitmap(pixels, ArtworkFieldMath.TEXTURE_SIZE, ArtworkFieldMath.TEXTURE_SIZE,
              Bitmap.Config.ARGB_8888)
          } finally { decoded.recycle() }
        }
      } catch (_: Exception) { null }
      if (texture != null) synchronized(cache) { cache.put(uri, texture) }
      if (stillWanted()) result(texture)
    }

  private fun decodeLocal(context: Context, source: String): Bitmap? {
    val uri = if (source.startsWith("/")) Uri.fromFile(File(source)) else Uri.parse(source)
    if (uri.scheme != "file" && uri.scheme != "content") return null
    val file = if (uri.scheme == "file") uri.path?.let(::File) else null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val imageSource = if (file != null) ImageDecoder.createSource(file)
        else ImageDecoder.createSource(context.contentResolver, uri)
      return ImageDecoder.decodeBitmap(imageSource) { decoder, _, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        decoder.setTargetSize(ArtworkFieldMath.TEXTURE_SIZE, ArtworkFieldMath.TEXTURE_SIZE)
      }
    }
    fun open(): InputStream? = if (file != null) file.inputStream()
      else context.contentResolver.openInputStream(uri)
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true; inSampleSize = 1 }
    open()?.use { BitmapFactory.decodeStream(it, null, options) }
    if (options.outWidth <= 0 || options.outHeight <= 0) return null
    options.inJustDecodeBounds = false
    options.inPreferredConfig = Bitmap.Config.ARGB_8888
    while (maxOf(options.outWidth, options.outHeight) / (options.inSampleSize * 2) >= 64) {
      options.inSampleSize *= 2
    }
    val decoded = open()?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    val scaled = Bitmap.createScaledBitmap(decoded, ArtworkFieldMath.TEXTURE_SIZE,
      ArtworkFieldMath.TEXTURE_SIZE, true)
    if (scaled !== decoded) decoded.recycle()
    return scaled
  }
}
