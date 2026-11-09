package expo.modules.localhttp

import org.json.JSONArray
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo bridge to `FileServer`: the phone serving its own music to a renderer on
 * the network, so what is on the phone can be cast like what is on a server.
 *
 * It is only ever up while casting. The JS API lives in `src/lib/localHttp.ts`,
 * and what keeps the process alive while the screen is off is the foreground
 * service the cast already runs (`modules/cast-media`), not anything here.
 */
class LocalHttpModule : Module() {
  private var server: FileServer? = null
  private val transferLock = Any()
  private var transferForeground = true
  private var transfer: TransferServer? = null

  override fun definition() = ModuleDefinition {
    Name("LocalHttp")

    OnDestroy {
      server?.stop()
      server = null
      synchronized(transferLock) { transferForeground = false; transfer?.stop(); transfer = null }
    }

    // Wi-Fi transfer is opt-in foreground work. Casting keeps its own lifetime.
    OnActivityEntersForeground { synchronized(transferLock) { transferForeground = true } }
    OnActivityEntersBackground { synchronized(transferLock) { transferForeground = false; transfer?.stop(); transfer = null } }

    AsyncFunction("startTransfer") { promise: Promise ->
      try {
        val ctx = appContext.reactContext?.applicationContext ?: throw IllegalStateException("Application unavailable")
        val address = AndroidTransferStorage.wifiAddress(ctx) ?: throw IllegalStateException("Connect to a Wi-Fi network first")
        synchronized(transferLock) {
          check(transferForeground) { "Keep the app in the foreground" }
          val running = transfer ?: TransferServer(AndroidTransferStorage(ctx)).also { it.start(address) }
          transfer = running
          promise.resolve(running.statusJson())
        }
      } catch (e: Exception) { promise.reject("ERR_WIFI_TRANSFER", e.message ?: "Cannot start Wi-Fi transfer", e) }
    }
    AsyncFunction("transferStatus") {
      val ctx = appContext.reactContext?.applicationContext
      synchronized(transferLock) {
      if (transfer != null && (ctx == null || !transfer!!.matchesAddress(AndroidTransferStorage.wifiAddress(ctx)))) { transfer?.stop(); transfer = null }
      transfer?.statusJson() ?: "{\"running\":false,\"url\":null,\"files\":[],\"transfers\":[],\"uploads\":[],\"maxFileBytes\":536870912}" }
    }
    AsyncFunction("setTransferEntries") { json: String ->
      val target = synchronized(transferLock) { transfer ?: throw IllegalStateException("Start Wi-Fi transfer first") }
      val rows = JSONArray(json)
      require(rows.length() <= 200) { "Select at most 200 files" }
      val files = ArrayList<TransferFile>()
      for (i in 0 until rows.length()) {
        val row = rows.getJSONObject(i)
        val uri = row.getString("uri")
        val ctx = appContext.reactContext?.applicationContext ?: throw IllegalStateException("Application unavailable")
        val bytes = AndroidTransferStorage(ctx).open(uri).use { it.size }
        files.add(TransferFile(row.getString("key"), uri, row.getString("name"), row.optString("mime", "application/octet-stream"), bytes))
      }
      synchronized(transferLock) { check(transferForeground && transfer === target) { "Transfer session ended" }; target.setEntries(files) }
    }
    AsyncFunction("stopTransfer") { synchronized(transferLock) { transfer?.stop(); transfer = null } }
    Function("copyTransferAddress") {
      val ctx = appContext.reactContext
      val address = synchronized(transferLock) { transfer?.origin() }
      val clipboard = ctx?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
      if (address != null && clipboard != null) { clipboard.setPrimaryClip(ClipData.newPlainText("Resonus Glass Wi-Fi transfer", address)); true } else false
    }

    /**
     * Starts the server if it is not up and answers where it can be reached,
     * or null when this phone has no address on the network to be reached at.
     */
    AsyncFunction("start") { promise: Promise ->
      try {
        val ctx =
          appContext.reactContext?.applicationContext
            ?: return@AsyncFunction promise.resolve(null)
        val running = server ?: FileServer(ctx).also { it.start() }
        server = running
        promise.resolve(running.origin())
      } catch (e: Exception) {
        promise.reject("ERR_LOCAL_HTTP", e.message ?: "could not start the server", e)
      }
    }

    /** Publishes what may be asked for: `[{ key, uri, mime }]`. */
    Function("setEntries") { json: String ->
      server?.setEntries(json)
    }

    AsyncFunction("stop") { promise: Promise ->
      server?.stop()
      server = null
      promise.resolve(null)
    }
  }
}
