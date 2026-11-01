package expo.modules.backgrounddownloads

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.PrintWriter
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Manual dumpsys only. Never enumerate the main-thread registry from Binder. */
internal object DownloadDiagnostics {
  private val main = Handler(Looper.getMainLooper())
  fun dump(context: Context, writer: PrintWriter, extra: () -> Map<String, Any?> = { emptyMap() }) {
    fun snapshot(): String {
      val status = BackgroundDownloads.status(context.applicationContext).toMutableMap()
      status["jobs"] = BackgroundDownloads.snapshot().map { job -> mapOf("owner" to job.owner,
        "token" to job.token, "progress" to job.progress.toMap()) }
      status.putAll(extra())
      return JSONObject(status).toString(2)
    }
    if (Looper.myLooper() === Looper.getMainLooper()) { writer.println(snapshot()); return }
    val result = AtomicReference<String>()
    val ready = CountDownLatch(1)
    val request = Runnable { try { result.set(snapshot()) } finally { ready.countDown() } }
    main.post(request)
    val captured = try { ready.await(500, TimeUnit.MILLISECONDS) }
      catch (_: InterruptedException) { Thread.currentThread().interrupt(); false }
    if (captured) writer.println(result.get()) else {
      main.removeCallbacks(request)
      writer.println("Background download diagnostics unavailable: main queue busy.")
    }
  }
}
