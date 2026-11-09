package expo.modules.localhttp

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.net.Inet4Address

/** MediaStore reserves unique display names and publishes only complete uploads. */
class AndroidTransferStorage(private val ctx: Context) : TransferStorage {
  override fun create(name: String, mime: String, size: Long): TransferSink {
    require(TransferServer.safeName(name) != null && TransferServer.audioMime(name) != null)
    val root = Environment.getExternalStorageDirectory()
    require(root.usableSpace > size + 32L * 1024 * 1024) { "Not enough free storage" }
    if (Build.VERSION.SDK_INT >= 29) {
      val values = ContentValues().apply {
        put(MediaStore.Audio.Media.DISPLAY_NAME, name)
        put(MediaStore.Audio.Media.MIME_TYPE, mime)
        put(MediaStore.Audio.Media.RELATIVE_PATH, "Music/Resonus Glass/Transfer")
        put(MediaStore.Audio.Media.IS_PENDING, 1)
      }
      val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      val uri = ctx.contentResolver.insert(collection, values) ?: throw IllegalStateException("Cannot create audio file")
      val stream = try { ctx.contentResolver.openOutputStream(uri, "w") ?: throw IllegalStateException("Cannot write audio file") }
        catch (e: Exception) { ctx.contentResolver.delete(uri, null, null); throw e }
      return object : TransferSink {
        override val output = stream
        private var committed = false
        override fun commit(): String {
          stream.close()
          val completed = ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }
          if (ctx.contentResolver.update(uri, completed, null, null) != 1) throw IllegalStateException("Cannot publish audio file")
          committed = true; return uri.toString()
        }
        override fun abort() { try { stream.close() } finally { if (!committed) ctx.contentResolver.delete(uri, null, null) } }
      }
    }
    // Older devices need no public-storage permission to receive into the app's
    // music directory. The route reports the destination without changing source.
    val parent = ctx.getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: throw IllegalStateException("External music storage is unavailable")
    val directory = File(parent, "Transfer").apply { mkdirs() }
    val extension = name.substringAfterLast('.'); val stem = name.substringBeforeLast('.')
    var file = File(directory, name); var index = 1
    while (!file.createNewFile()) file = File(directory, "$stem (${index++}).$extension")
    val reserved = file; val stream = try { FileOutputStream(reserved) } catch (e: Exception) { reserved.delete(); throw e }
    return object : TransferSink {
      override val output = stream
      private var committed = false
      override fun commit(): String { stream.close(); committed = true; MediaScannerConnection.scanFile(ctx, arrayOf(reserved.path), arrayOf(mime), null); return Uri.fromFile(reserved).toString() }
      override fun abort() { try { stream.close() } finally { if (!committed) reserved.delete() } }
    }
  }
  override fun open(uri: String): TransferRead {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "content" || parsed.scheme == "file")
    val pfd = ctx.contentResolver.openFileDescriptor(parsed, "r") ?: throw IllegalArgumentException("File unavailable")
    val size = pfd.statSize
    if (size < 0 || size > TransferServer.MAX_FILE_BYTES) { pfd.close(); throw IllegalArgumentException("Unsupported file length") }
    return TransferRead(ParcelFileDescriptor.AutoCloseInputStream(pfd), size)
  }
  companion object {
    /** Read link addresses of the Wi-Fi transport, excluding VPN/tun interfaces. */
    fun wifiAddress(ctx: Context): String? {
      val connectivity = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
      @Suppress("DEPRECATION") val networks = connectivity.allNetworks
      for (network in networks) {
        val capabilities = connectivity.getNetworkCapabilities(network) ?: continue
        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue
        val link = connectivity.getLinkProperties(network) ?: continue
        val address = link.linkAddresses.firstOrNull { it.address is Inet4Address && it.address.isSiteLocalAddress }
        if (address != null) return address.address.hostAddress
      }
      return null
    }
  }
}
