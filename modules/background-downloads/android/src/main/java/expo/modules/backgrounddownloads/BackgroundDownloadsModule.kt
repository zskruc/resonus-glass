package expo.modules.backgrounddownloads

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class BackgroundDownloadsModule : Module() {
  private val clientId = UUID.randomUUID().toString()
  private val main = Handler(Looper.getMainLooper())
  private val delays = mutableMapOf<Runnable, Promise>()
  @Volatile private var destroyed = false

  override fun definition() = ModuleDefinition {
    Name("ResonusBackgroundDownloads")
    Events("onInterrupted")
    OnCreate {
      main.post { BackgroundDownloads.register(clientId) { event -> if (!destroyed) sendEvent("onInterrupted", event) } }
    }
    OnDestroy {
      destroyed = true
      main.post {
        BackgroundDownloads.destroyClient(clientId)
        delays.forEach { (callback, promise) -> main.removeCallbacks(callback); promise.resolve(null) }
        delays.clear()
      }
    }
    AsyncFunction("startJob") { owner: String, runId: String, progress: DownloadProgress, promise: Promise ->
      val context = appContext.reactContext as? ReactContext
      if (destroyed || context == null || !context.hasActiveReactInstance()) {
        promise.resolve(mapOf("ok" to false, "reason" to "runtime-unavailable"))
      } else {
        BackgroundDownloads.start(context, clientId, owner, runId, progress.clean()) { promise.resolve(it) }
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("updateJob") { token: String, progress: DownloadProgress ->
      BackgroundDownloads.update(clientId, token, progress.clean())
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopJob") { token: String -> BackgroundDownloads.stop(clientId, token) }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopPendingJob") { owner: String, runId: String ->
      BackgroundDownloads.stopPending(clientId, owner, runId)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("getStatus") {
      val context = appContext.reactContext?.applicationContext
      BackgroundDownloads.status(context)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("drainInterruptions") { BackgroundDownloads.drain(clientId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("waitForSession") { sessionId: String, promise: Promise ->
      BackgroundDownloads.waitForSession(sessionId) { promise.resolve(null) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("wait") { delayMs: Double, promise: Promise ->
      if (destroyed) promise.resolve(null) else {
        val duration = if (delayMs.isFinite()) delayMs.toLong().coerceIn(0, 300_000) else 0
        lateinit var callback: Runnable
        callback = Runnable { delays.remove(callback); promise.resolve(null) }
        delays[callback] = promise
        main.postDelayed(callback, duration)
      }
    }.runOnQueue(Queues.MAIN)
  }
}
