// Adapted from wavio (github.com/Joel-Mercier/wavio, MIT) for Resonus.
package expo.modules.carauto

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.media3.common.MediaMetadata
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/**
 * Cover art for Android Auto. The AA host draws the covers in its *own*
 * process: it can fetch an http(s) artworkUri by itself, but it cannot read our
 * file:// covers, which are private to the app. For those the bitmap is decoded
 * and scaled down in our process and the JPEG bytes are sent with
 * setArtworkData, which travels over the binder so the host can draw it without
 * touching the filesystem. Remote URLs go as setArtworkUri, but never as
 * themselves: a server's cover URL carries the account's credentials, so the
 * host gets an opaque content uri that [CarArtProvider] serves (see
 * [contentUri]).
 *
 * The bytes are kept small (320px at most, JPEG q80, so ~20-40KB) and cached by
 * path, so the album and queue items that share a cover are only decoded once.
 * `apply` returns how many bytes it embedded (0 for a uri, or for nothing at
 * all) so the caller can keep a binder transaction within bounds. See the guard
 * in JsProxyPlayer.
 */
internal object CarArtwork {
  private const val MAX_DIM = 320
  private const val QUALITY = 80

  /**
   * For a cover in a browse list, where it is drawn as a tile and never fills
   * the screen. A page of them travels in one binder transaction, so what
   * matters there is how little each one weighs: at this size they come out
   * around a tenth of a full one.
   */
  const val THUMB_DIM = 192

  /** What JS writes for the tree's own icons, e.g. `res://ic_car_albums`. */
  private const val RES_SCHEME = "res://"

  private val cache = object : LruCache<String, ByteArray>(8 * 1024 * 1024) {
    override fun sizeOf(key: String, value: ByteArray): Int = value.size
  }

  /** Resolved here rather than written into the tree from JS: the package name
   *  carries the build's applicationId suffix, which JS has no way to know. */
  @Volatile private var drawableBase: String? = null
  @Volatile private var artAuthority: String? = null

  /** Recent superseded addresses, for a host finishing an older request. The
   *  currently browsable tree and queue window are retained independently:
   *  a large library must never evict an address we have just published. */
  private val remote = LruCache<String, String>(2000)
  @Volatile private var browseRemote: Map<String, String> = emptyMap()
  @Volatile private var queueRemote: Map<String, String> = emptyMap()

  fun init(context: Context) {
    drawableBase = "android.resource://${context.packageName}/drawable/"
    artAuthority = "${context.packageName}.carart"
  }

  /** The content uri the host is given for a remote cover, or null when the
   *  provider is not set up yet. */
  private fun contentUri(url: String): Uri? {
    val authority = artAuthority ?: return null
    val id = remoteId(url) ?: return null
    remote.put(id, url)
    return Uri.parse("content://$authority/$id")
  }

  /** Lifetimes follow the actual source snapshots, rather than the order the
   *  host happens to request covers. These immutable indexes are only as large
   *  as the existing browse tree and the bounded queue window. Replacing one
   *  releases its old references without evicting the other. */
  fun retainBrowseArtwork(urls: Sequence<String>) {
    browseRemote = indexRemote(urls)
  }

  fun retainQueueArtwork(urls: Sequence<String>) {
    queueRemote = indexRemote(urls)
  }

  private fun indexRemote(urls: Sequence<String>): Map<String, String> =
    buildMap {
      for (url in urls.distinct()) remoteId(url)?.let { put(it, url) }
    }

  private fun remoteId(url: String): String? {
    val scheme = Uri.parse(url).scheme
    if (!scheme.equals("http", ignoreCase = true) &&
        !scheme.equals("https", ignoreCase = true)) return null
    return MessageDigest.getInstance("SHA-256")
      .digest(url.toByteArray(Charsets.UTF_8))
      .take(16)
      .joinToString("") { "%02x".format(it) }
  }

  /** The address behind an id handed out by [contentUri]. */
  fun realUrl(id: String): String? = queueRemote[id] ?: browseRemote[id] ?: remote.get(id)

  /**
   * Puts the cover on [builder]. With [embed] false a local file is never
   * decoded and its uri is used as it is, which is how the caller limits how
   * much artwork it embeds in one transaction. Returns the bytes embedded.
   */
  fun apply(
    builder: MediaMetadata.Builder,
    artworkUrl: String?,
    embed: Boolean = true,
    maxDim: Int = MAX_DIM,
  ): Int {
    if (artworkUrl == null) return 0
    // A category icon of ours: a resource uri the host resolves against this
    // package, so it arrives as a drawable it can tint, and not as a bitmap.
    if (artworkUrl.startsWith(RES_SCHEME)) {
      val base = drawableBase ?: return 0
      builder.setArtworkUri(Uri.parse(base + artworkUrl.removePrefix(RES_SCHEME)))
      return 0
    }
    val bytes = if (embed) localArtworkData(artworkUrl, maxDim) else null
    if (bytes != null) {
      builder.setArtworkData(bytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
      return bytes.size
    }
    val scheme = Uri.parse(artworkUrl).scheme
    if (scheme.equals("http", ignoreCase = true) || scheme.equals("https", ignoreCase = true)) {
      contentUri(artworkUrl)?.let { builder.setArtworkUri(it) }
      return 0
    }
    builder.setArtworkUri(Uri.parse(artworkUrl))
    return 0
  }

  private fun localArtworkData(uri: String, maxDim: Int): ByteArray? {
    if (!uri.startsWith("file://")) return null
    val path = Uri.parse(uri).path ?: return null
    // Keyed by size too: the same cover is asked for as a tile and as the big
    // one on Now Playing, and one would otherwise be served at the other's size.
    val key = "$path@$maxDim"
    cache.get(key)?.let { return it }
    return runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      val opts = BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxDim)
      }
      val bmp = BitmapFactory.decodeFile(path, opts) ?: return null
      val out = ByteArrayOutputStream()
      bmp.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
      bmp.recycle()
      out.toByteArray().also { cache.put(key, it) }
    }.getOrNull()
  }

  // The largest power-of-two subsampling that keeps both sides >= maxDim.
  private fun sampleSize(width: Int, height: Int, maxDim: Int): Int {
    var sample = 1
    var w = width
    var h = height
    while (w / 2 >= maxDim && h / 2 >= maxDim) {
      w /= 2
      h /= 2
      sample *= 2
    }
    return sample
  }
}
