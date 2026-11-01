package expo.modules.backgrounddownloads

import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

private var checks = 0
private fun expect(value: Boolean, reason: String) { checks++; check(value) { reason } }
private fun progress() = DownloadProgress().apply { completed = 2; total = 10; failed = 1; locale = "en" }.clean()
private fun session(context: ReactContext) = context.starts.last().getStringExtra(BackgroundDownloadService.EXTRA_SESSION)!!
private fun token(owner: String) = BackgroundDownloads.snapshot().first { it.owner == owner }.token
private fun live() = BackgroundDownloads.status(null)
private fun start(context: ReactContext, client: String, owner: String, run: String, done: (Map<String, Any?>) -> Unit = {}) =
  BackgroundDownloads.start(context, client, owner, run, progress(), done)

fun main() {
  val context = ReactContext(); val events = mutableListOf<Map<String, Any>>()
  BackgroundDownloads.register("client") { events.add(it) }
  var music: Map<String, Any?>? = null
  start(context, "client", "music", "music-1") { music = it }
  expect(music == null && live()["starting"] == true, "start must await real service promotion")
  val service = BackgroundDownloadService(); val firstSession = session(context)
  BackgroundDownloads.serviceStarted(service, firstSession, 1)
  expect(music?.get("ok") == true && live()["headlessActive"] == true, "promotion establishes own Headless timing lease before success")
  var ended = false; BackgroundDownloads.waitForSession(firstSession) { ended = true }
  val musicToken = token("music"); var cache: Map<String, Any?>? = null
  start(context, "client", "media-cache", "cache-1") { cache = it }
  expect(cache?.get("ok") == true && context.starts.size == 1, "music and artwork share one native FGS")
  BackgroundDownloads.stop("client", musicToken)
  expect(live()["running"] == true && live()["headlessActive"] == true && service.lock && !ended,
    "finishing music must not suspend the independent artwork job")
  expect(!BackgroundDownloads.update("client", musicToken, progress()), "released progress cannot revive a lease")
  BackgroundDownloads.stop("client", token("media-cache"))
  expect(live()["running"] == false && !service.lock && ended, "last completion releases private wake lock and timing task")
  var lateDone = false; BackgroundDownloads.waitForSession(firstSession) { lateDone = true }
  expect(lateDone && !HeadlessJsTaskContext.getInstance(context).hasActiveTasks(), "late JS task dispatch cannot leak an ended-session Promise")

  var replaced: Map<String, Any?>? = null
  start(context, "client", "music", "old-run") { replaced = it }; val oldToken = token("music")
  var replacement: Map<String, Any?>? = null
  start(context, "client", "music", "new-run") { replacement = it }; val currentToken = token("music")
  expect(replaced?.get("reason") == "replaced" && replacement == null, "replacement retires pending start while keeping new one pending")
  val secondService = BackgroundDownloadService(); BackgroundDownloads.serviceStarted(secondService, session(context), 2)
  expect(replacement?.get("ok") == true, "current start resolves only after promotion")
  expect(!BackgroundDownloads.stop("client", oldToken) && !BackgroundDownloads.update("client", oldToken, progress()),
    "old run stop/update cannot cancel or overwrite its replacement")
  var duplicate: Map<String, Any?>? = null; start(context, "client", "music", "new-run") { duplicate = it }
  expect(duplicate?.get("token") == currentToken, "same run acquisition is idempotent")
  BackgroundDownloads.stop("client", currentToken)
  var retired: Map<String, Any?>? = null; start(context, "client", "music", "old-run") { retired = it }
  expect(retired?.get("reason") == "retired-job", "late stale start cannot resurrect a retired run")

  var cancelled: Map<String, Any?>? = null
  start(context, "client", "music", "cancel-before-promote") { cancelled = it }; val cancelledSession = session(context)
  BackgroundDownloads.stop("client", token("music"))
  expect(cancelled?.get("ok") == false && live()["starting"] == false, "cancellation settles a not-yet-promoted start")
  start(context, "client", "music", "after-cancel"); val newerSession = session(context)
  val staleService = BackgroundDownloadService(); BackgroundDownloads.serviceStarted(staleService, cancelledSession, 3)
  expect(staleService.promotions == 1 && staleService.finishes == 1, "cancelled FGS command still immediately promotes then stops within Android deadline")
  val newService = BackgroundDownloadService(); BackgroundDownloads.serviceStarted(newService, newerSession, 4)
  BackgroundDownloads.serviceDestroyed(staleService, cancelledSession)
  BackgroundDownloads.action(newService, cancelledSession, "cancel")
  expect(live()["running"] == true && newService.lock, "late old service destruction and old notification action cannot stop a newer session")
  start(context, "client", "media-cache", "parallel-timeout")
  BackgroundDownloads.action(newService, newerSession, "timeout")
  expect(live()["running"] == false && !newService.lock && !HeadlessJsTaskContext.getInstance(context).hasActiveTasks(),
    "OS timeout stops both owners and all protection synchronously")
  expect(events.last()["reason"] == "timeout" && (events.last()["leases"] as List<*>).size == 2,
    "timeout event identifies both exact tokens for JS pause/abort")
  expect(BackgroundDownloads.drain("client").isNotEmpty() && BackgroundDownloads.drain("client").isEmpty(),
    "missed interruptions are drainable without an unbounded event backlog")

  val failingContext = ReactContext().apply { startFailure = IllegalStateException("background FGS forbidden") }
  var failed: Map<String, Any?>? = null; start(failingContext, "client", "music", "start-rejected") { failed = it }
  expect(failed?.get("reason") == "start-failed" && live()["starting"] == false, "OS start rejection clears pending protection cleanly")
  start(context, "client", "music", "promotion-rejected") { failed = it }
  val failingService = BackgroundDownloadService().apply { failPromotion = true }
  BackgroundDownloads.serviceStarted(failingService, session(context), 5)
  expect(failed?.get("ok") == false && !failingService.lock && live()["running"] == false,
    "partially failed promotion releases its service/wake ownership")

  start(context, "client", "music", "headless-interrupted"); val headlessService = BackgroundDownloadService()
  BackgroundDownloads.serviceStarted(headlessService, session(context), 6)
  HeadlessJsTaskContext.getInstance(context).finishAll()
  expect(events.last()["reason"] == "runtime-stopped" && !headlessService.lock && live()["running"] == false,
    "unexpected Headless task loss cannot leave an apparently protected stalled worker")

  val other = ReactContext(); BackgroundDownloads.register("other") {}
  start(context, "client", "music", "module-a"); val shared = BackgroundDownloadService()
  BackgroundDownloads.serviceStarted(shared, session(context), 7)
  start(other, "other", "media-cache", "module-b")
  BackgroundDownloads.destroyClient("client")
  expect(live()["running"] == true && shared.lock && BackgroundDownloads.snapshot().single().owner == "media-cache",
    "destroying an old module cannot stop the other live owner/client")
  BackgroundDownloads.destroyClient("other")
  expect(live()["running"] == false && !shared.lock && !HeadlessJsTaskContext.getInstance(other).hasActiveTasks(),
    "last module destruction releases all resources")

  BackgroundDownloads.register("uidt-client") {}
  var waiting: Map<String, Any?>? = null
  start(context, "uidt-client", "music", "queued-network") { waiting = it }
  val cancellations = context.cancellations
  expect(!BackgroundDownloads.stopPending("uidt-client", "music", "different-run"), "pending cancellation must prove the exact generation")
  expect(BackgroundDownloads.stopPending("uidt-client", "music", "queued-network") && waiting?.get("ok") == false,
    "pause/cancel can settle an accepted job before network/promotion without knowing its token")
  expect(context.cancellations == cancellations + 1, "pending cancellation unschedules its platform job immediately")
  start(context, "uidt-client", "music", "uidt-running")
  val uidt = BackgroundDownloadService("uidt"); val uidtSession = session(context)
  BackgroundDownloads.serviceStarted(uidt, uidtSession, 8)
  expect(live()["runnerType"] == "uidt" && live()["headlessActive"] == true && live()["wakeLockHeld"] == false,
    "JobScheduler's active UIDT runner does not require a redundant FGS/private wake lock")
  expect(!BackgroundDownloads.stopPending("uidt-client", "music", "queued-network"), "a cancelled old start cannot stop its promoted replacement")
  expect(BackgroundDownloads.stopPending("uidt-client", "music", "uidt-running") && live()["running"] == false,
    "acquisition cancellation racing promotion still stops only its own live generation")
  start(context, "uidt-client", "media-cache", "uidt-system-stop")
  val stopped = BackgroundDownloadService("uidt"); val stoppedSession = session(context)
  BackgroundDownloads.serviceStarted(stopped, stoppedSession, 9)
  var stoppedWaiter = false; BackgroundDownloads.waitForSession(stoppedSession) { stoppedWaiter = true }
  BackgroundDownloads.serviceStopped(stopped, stoppedSession, "service-destroyed")
  expect(live()["running"] == false && stoppedWaiter && !HeadlessJsTaskContext.getInstance(context).hasActiveTasks(),
    "system-stopped UIDT releases JS timing, settles its session and never retries the old worker")
  BackgroundDownloads.destroyClient("uidt-client")
  BackgroundDownloads.register("network-client") {}
  var networkFailure: Map<String, Any?>? = null
  start(context, "network-client", "media-cache", "network-match") { networkFailure = it }
  val networkSession = session(context)
  BackgroundDownloads.rejectSession("obsolete-session", "network-mismatch")
  expect(BackgroundDownloads.acceptsSession(networkSession), "stale network callbacks cannot reject a newer accepted job")
  BackgroundDownloads.rejectSession(networkSession, "network-mismatch")
  expect(networkFailure?.get("reason") == "network-mismatch" && live()["starting"] == false,
    "assigned/default mismatch settles the pending acquisition and unschedules its job")
  expect(!BackgroundDownloads.acceptsSession(networkSession), "redelivery of a rejected job must not cold-start the JS worker")
  BackgroundDownloads.destroyClient("network-client")
  val sharedTaskContext = HeadlessJsTaskContext.getInstance(context)
  val unrelatedTask = sharedTaskContext.startTask(HeadlessJsTaskConfig("other-app-feature", Arguments.createMap(), 0, true))
  BackgroundDownloads.register("scoped-task-client") {}
  start(context, "scoped-task-client", "music", "own-task")
  val scoped = BackgroundDownloadService(); BackgroundDownloads.serviceStarted(scoped, session(context), 10)
  BackgroundDownloads.stopPending("scoped-task-client", "music", "own-task")
  expect(sharedTaskContext.isTaskRunning(unrelatedTask) && live()["headlessActive"] == false,
    "releasing download protection finishes only its own Headless task, never another app feature")
  sharedTaskContext.finishTask(unrelatedTask); BackgroundDownloads.destroyClient("scoped-task-client")
  println("BackgroundDownloads production-Kotlin coordinator harness passed: $checks assertions")
}
