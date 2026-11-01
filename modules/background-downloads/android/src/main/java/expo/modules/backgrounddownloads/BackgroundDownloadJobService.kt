package expo.modules.backgrounddownloads

import android.app.NotificationManager
import android.app.job.JobParameters
import android.app.job.JobService
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import java.io.FileDescriptor
import java.io.PrintWriter

/** Android14+ user-initiated network job. JobScheduler owns its CPU/network execution lifetime. */
internal class BackgroundDownloadJobService : JobService(), DownloadRunner {
  override val kind = "uidt"
  private var parameters: JobParameters? = null
  private var activeSession: String? = null
  private val notifications by lazy { DownloadNotifications(this) }
  private val main = Handler(Looper.getMainLooper())
  private var refreshPending = false
  override fun dump(fd: FileDescriptor, writer: PrintWriter, args: Array<out String>?) {
    DownloadDiagnostics.dump(this, writer) {
      val assigned = parameters?.network
      val active = (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).activeNetwork
      mapOf("assignedNetwork" to assigned?.networkHandle, "defaultNetwork" to active?.networkHandle,
        "assignedIsDefault" to (assigned != null && assigned == active))
    }
  }
  private val refresh = Runnable {
    refreshPending = false
    val current = parameters ?: return@Runnable
    val session = activeSession ?: return@Runnable
    val jobs = BackgroundDownloads.snapshot()
    if (jobs.isNotEmpty()) try {
      (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(
        DownloadNotifications.NOTIFICATION_ID, notifications.build(jobs, session))
      val bytes = jobs.sumOf { (it.progress.bytesTotal - it.progress.bytesDone).coerceAtLeast(0.0) }
      if (bytes.isFinite() && bytes > 0) updateEstimatedNetworkBytes(current, bytes.toLong(), 0)
    } catch (_: Exception) { BackgroundDownloads.action(this, session, "service-destroyed") }
  }

  override fun onStartJob(params: JobParameters): Boolean {
    val session = params.extras.getString(BackgroundDownloadService.EXTRA_SESSION) ?: return false
    // A cancelled/redelivered job must not replace a newer active parameter
    // handle, nor create a new JS runtime to resurrect a retired user action.
    if (!BackgroundDownloads.acceptsSession(session)) return false
    networkRejection(params)?.let { BackgroundDownloads.rejectSession(session, it); return false }
    parameters = params
    BackgroundDownloads.serviceStarted(this, session, 0)
    return parameters === params
  }

  override fun promote(jobs: List<BackgroundDownloads.Job>, session: String) {
    val current = parameters ?: throw IllegalStateException("Missing active job")
    activeSession = session
    setNotification(current, DownloadNotifications.NOTIFICATION_ID, notifications.build(jobs, session), JOB_END_NOTIFICATION_POLICY_REMOVE)
  }

  override fun scheduleRefresh() {
    if (refreshPending) return
    refreshPending = true
    main.postDelayed(refresh, 750)
  }

  /** UIDT is protected by JobScheduler's job wake lock; no second private lock is acquired. */
  override fun hasWakeLock() = false

  override fun finish() {
    val current = parameters
    parameters = null
    activeSession = null
    main.removeCallbacks(refresh); refreshPending = false
    if (current != null) jobFinished(current, false)
  }

  override fun onStopJob(params: JobParameters): Boolean {
    val stoppedSession = params.extras.getString(BackgroundDownloadService.EXTRA_SESSION)
    if (activeSession == stoppedSession) {
      parameters = null
      activeSession = null
      main.removeCallbacks(refresh); refreshPending = false
    }
    val reason = if (params.stopReason == JobParameters.STOP_REASON_TIMEOUT) "timeout" else "service-destroyed"
    BackgroundDownloads.serviceStopped(this, stoppedSession, reason)
    // JS checkpoints remain paused for an explicit resume; never cold-start a
    // fresh runtime from a redelivered system job with no proven live owner.
    return false
  }

  override fun onNetworkChanged(params: JobParameters) {
    val session = params.extras.getString(BackgroundDownloadService.EXTRA_SESSION) ?: return
    if (activeSession != session || !BackgroundDownloads.acceptsSession(session)) return
    networkRejection(params)?.let { BackgroundDownloads.action(this, session, it); return }
    parameters = params
  }

  private fun networkRejection(params: JobParameters): String? {
    val manager = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
    val assigned = params.network
    val active = manager.activeNetwork
    val online = assigned != null && manager.getNetworkCapabilities(assigned)
      ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    BackgroundDownloads.recordNetworkStatus(mapOf("assignedNetwork" to assigned?.networkHandle,
      "defaultNetwork" to active?.networkHandle, "assignedIsDefault" to (assigned != null && assigned == active)))
    // JS/Expo sockets use the process default network. Never bind the entire
    // music player process to another network, or claim UIDT protection for
    // transfers outside the network granted to this job.
    return if (!online || active == null) "network-unavailable" else if (assigned != active) "network-mismatch" else null
  }

  override fun onDestroy() {
    main.removeCallbacks(refresh)
    BackgroundDownloads.serviceDestroyed(this, activeSession)
    parameters = null; activeSession = null
    super.onDestroy()
  }
}
