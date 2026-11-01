package expo.modules.backgrounddownloads

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.lang.ref.WeakReference
import java.util.UUID

/** All calls run on Android's main queue; tokens, not start/stop timing, own each job. */
internal object BackgroundDownloads {
  const val TASK_KEY = "ResonusBackgroundDownloadsSession"
  internal data class Job(val client: String, val owner: String, val runId: String,
    val token: String, var progress: Progress, val react: WeakReference<ReactContext>) {
    fun reference(): Map<String, Any> = mapOf("owner" to owner, "runId" to runId, "token" to token)
    fun toMap(): Map<String, Any> = reference() + mapOf("progress" to progress.toMap())
  }
  private data class Keepalive(val session: String, val context: HeadlessJsTaskContext,
    val taskId: Int, val listener: HeadlessJsTaskEventListener)
  private val jobs = linkedMapOf<String, Job>()
  private val clients = mutableMapOf<String, (Map<String, Any>) -> Unit>()
  private val interruptions = mutableMapOf<String, ArrayDeque<Map<String, Any>>>()
  private val pending = mutableMapOf<String, MutableList<(Map<String, Any?>) -> Unit>>()
  private val retired = linkedSetOf<String>()
  private val sessionWaiters = mutableMapOf<String, MutableList<() -> Unit>>()
  private var service: DownloadRunner? = null
  private var cancelLaunch: (() -> Unit)? = null
  private var session: String? = null
  private var keepalive: Keepalive? = null
  private var starting = false
  private var networkStatus: Map<String, Any?> = emptyMap()

  fun register(client: String, listener: (Map<String, Any>) -> Unit) { clients[client] = listener }
  fun snapshot(): List<Job> = jobs.values.toList()
  fun acceptsSession(expected: String) = session == expected && jobs.isNotEmpty()
  fun recordNetworkStatus(status: Map<String, Any?>) { networkStatus = status }
  fun rejectSession(expected: String, reason: String) { if (acceptsSession(expected)) interrupt(reason) }

  fun start(context: ReactContext, client: String, owner: String, runId: String,
    progress: Progress, reply: (Map<String, Any?>) -> Unit) {
    if (owner !in setOf("music", "media-cache") || runId.isBlank() || runId.length > 160) {
      reply(mapOf("ok" to false, "reason" to "invalid-job")); return
    }
    val previous = jobs[owner]
    if (previous?.client == client && previous.runId == runId) {
      previous.progress = progress
      if (service != null) {
        try { ensureKeepalive(context); reply(success(previous)) }
        catch (_: Exception) { interrupt("runtime-unavailable"); reply(mapOf("ok" to false, "reason" to "runtime-unavailable")) }
      } else pending.getOrPut(previous.token) { mutableListOf() }.add(reply)
      service?.scheduleRefresh()
      return
    }
    if (retiredKey(client, owner, runId) in retired) {
      reply(mapOf("ok" to false, "reason" to "retired-job")); return
    }
    if (previous != null) retire(previous, "replaced")
    val job = Job(client, owner, runId, UUID.randomUUID().toString(), progress, WeakReference(context))
    jobs[owner] = job
    pending[job.token] = mutableListOf(reply)
    if (service != null) {
      try { ensureKeepalive(context); service?.scheduleRefresh(); resolveStarts() }
      catch (_: Exception) { interrupt("runtime-unavailable") }
      return
    }
    if (starting) return
    starting = true
    val nextSession = UUID.randomUUID().toString()
    session = nextSession
    try { cancelLaunch = DownloadLauncher.launch(context.applicationContext, nextSession, snapshot()) }
    catch (_: Exception) { interrupt("start-failed") }
  }

  /** Called only after Android delivers the requested service start. */
  fun serviceStarted(instance: DownloadRunner, requestedSession: String, startId: Int) {
    if (requestedSession != session || jobs.isEmpty()) {
      // A cancelled start still owes Android an immediate FGS promotion. An
      // obsolete command must never stop a newer already-promoted instance.
      if (service !== instance) {
        try { instance.promote(emptyList(), requestedSession) } finally { instance.finish() }
      }
      return
    }
    try {
      instance.promote(snapshot(), requestedSession)
      service = instance
      starting = false
      val context = jobs.values.firstNotNullOfOrNull { it.react.get()?.takeIf(ReactContext::hasActiveReactInstance) }
        ?: throw IllegalStateException("Runtime unavailable")
      ensureKeepalive(context)
      resolveStarts()
    } catch (_: Exception) {
      interrupt("start-failed")
      instance.finish()
    }
  }

  fun update(client: String, token: String, progress: Progress): Boolean {
    val job = jobs.values.find { it.client == client && it.token == token } ?: return false
    job.progress = progress
    service?.scheduleRefresh()
    return true
  }

  fun stop(client: String, token: String): Boolean {
    val job = jobs.values.find { it.client == client && it.token == token } ?: return false
    jobs.remove(job.owner)
    retire(job, "released")
    if (jobs.isEmpty()) endSession() else service?.scheduleRefresh()
    return true
  }

  fun action(instance: DownloadRunner, expectedSession: String, reason: String) {
    if (service === instance && session == expectedSession) interrupt(reason)
  }

  fun notificationAction(expectedSession: String, reason: String) {
    if (session == expectedSession) interrupt(reason)
  }

  fun serviceStopped(instance: DownloadRunner, expectedSession: String?, reason: String) {
    if (service === instance && session == expectedSession) interrupt(reason, finishService = false)
  }

  fun serviceDestroyed(instance: DownloadRunner, expectedSession: String?) {
    if (service === instance && session == expectedSession) interrupt("service-destroyed", finishService = false)
  }

  fun destroyClient(client: String) {
    val removed = jobs.values.filter { it.client == client }
    for (job in removed) { jobs.remove(job.owner); retire(job, "module-destroyed") }
    clients.remove(client); interruptions.remove(client)
    if (jobs.isEmpty()) endSession() else service?.scheduleRefresh()
  }

  fun stopPending(client: String, owner: String, runId: String): Boolean {
    val job = jobs[owner]?.takeIf { it.client == client && it.runId == runId } ?: return false
    return stop(client, job.token)
  }

  fun drain(client: String): List<Map<String, Any>> = interruptions.remove(client)?.toList() ?: emptyList()

  fun waitForSession(expected: String, done: () -> Unit) {
    if (expected == session && keepalive?.session == expected && ownHeadlessActive()) {
      sessionWaiters.getOrPut(expected) { mutableListOf() }.add(done)
    } else done()
  }

  fun status(context: Context?): Map<String, Any?> = mapOf("supported" to true,
    "running" to (service != null && jobs.isNotEmpty()), "starting" to starting,
    "sessionId" to session, "runnerType" to service?.kind, "headlessActive" to ownHeadlessActive(),
    "wakeLockHeld" to (service?.hasWakeLock() == true), "jobs" to jobs.values.map(Job::toMap), "network" to networkStatus,
    "notificationPermissionGranted" to (Build.VERSION.SDK_INT < 33 || context?.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED))

  private fun ensureKeepalive(context: ReactContext) {
    val taskContext = HeadlessJsTaskContext.getInstance(context)
    if (keepalive?.context === taskContext && ownHeadlessActive()) return
    stopKeepalive()
    val currentSession = session ?: throw IllegalStateException("Missing session")
    val listener = object : HeadlessJsTaskEventListener {
      override fun onHeadlessJsTaskStart(taskId: Int) = Unit
      override fun onHeadlessJsTaskFinish(taskId: Int) {
        val current = keepalive
        if (current?.session == currentSession && current.taskId == taskId) interrupt("runtime-stopped")
      }
    }
    taskContext.addTaskEventListener(listener)
    try {
      val data = Arguments.createMap().apply { putString("sessionId", currentSession) }
      val taskId = taskContext.startTask(HeadlessJsTaskConfig(TASK_KEY, data, 0, true))
      keepalive = Keepalive(currentSession, taskContext, taskId, listener)
    } catch (failure: Exception) {
      taskContext.removeTaskEventListener(listener)
      throw failure
    }
  }

  private fun ownHeadlessActive(): Boolean = keepalive?.let { it.context.isTaskRunning(it.taskId) } == true
  private fun success(job: Job): Map<String, Any?> = mapOf("ok" to true, "token" to job.token,
    "sessionId" to session, "runnerType" to service?.kind, "headlessActive" to ownHeadlessActive())

  private fun resolveStarts() {
    for (job in jobs.values) pending.remove(job.token)?.forEach { it(success(job)) }
  }

  private fun retiredKey(client: String, owner: String, runId: String) = "$client|$owner|$runId"
  private fun retire(job: Job, reason: String) {
    retired.add(retiredKey(job.client, job.owner, job.runId))
    while (retired.size > 64) retired.remove(retired.first())
    pending.remove(job.token)?.forEach { it(mapOf("ok" to false, "reason" to reason)) }
  }

  private fun interrupt(reason: String, finishService: Boolean = true) {
    val affected = jobs.values.toList()
    jobs.clear()
    affected.forEach { retire(it, reason) }
    // Deliver the loss before releasing the JS timing lease, so consumers can
    // abort requests/persist pauses without waiting for a background JS timer.
    affected.groupBy(Job::client).forEach { (client, owned) ->
      val event = mapOf<String, Any>("id" to UUID.randomUUID().toString(), "reason" to reason,
        "leases" to owned.map(Job::reference))
      interruptions.getOrPut(client) { ArrayDeque() }.apply { addLast(event); while (size > 16) removeFirst() }
      clients[client]?.invoke(event)
    }
    endSession(finishService)
  }

  private fun stopKeepalive() {
    val previous = keepalive
    keepalive = null
    if (previous != null) {
      previous.context.removeTaskEventListener(previous.listener)
      previous.context.finishTask(previous.taskId)
      sessionWaiters.remove(previous.session)?.forEach { it() }
    }
  }

  private fun endSession(finishService: Boolean = true) {
    val previous = service
    service = null
    starting = false
    session = null
    stopKeepalive()
    if (finishService) previous?.finish()
    val cancel = cancelLaunch
    cancelLaunch = null
    if (cancel != null) runCatching(cancel)
  }
}
