package expo.modules.backgrounddownloads

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.io.FileDescriptor
import java.io.PrintWriter

/** Protects user-started JS workers. It does not restart them after process death or force-stop. */
internal class BackgroundDownloadService : Service(), DownloadRunner {
  override val kind = "foreground-service"
  private val notifications by lazy { DownloadNotifications(this) }
  private val main = Handler(Looper.getMainLooper())
  private var activeSession: String? = null
  private var latestStartId = 0
  private var wakeLock: PowerManager.WakeLock? = null
  private var refreshPending = false
  private val refresh = Runnable {
    refreshPending = false
    val session = activeSession ?: return@Runnable
    val jobs = BackgroundDownloads.snapshot()
    if (jobs.isNotEmpty()) {
      try {
        holdWakeLock()
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(DownloadNotifications.NOTIFICATION_ID, notifications.build(jobs, session))
      } catch (_: Exception) { BackgroundDownloads.action(this, session, "start-failed") }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun dump(fd: FileDescriptor, writer: PrintWriter, args: Array<out String>?) {
    DownloadDiagnostics.dump(this, writer)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    latestStartId = startId
    val session = intent?.getStringExtra(EXTRA_SESSION)
    if (session == null) { finish(startId); return START_NOT_STICKY }
    BackgroundDownloads.serviceStarted(this, session, startId)
    return START_NOT_STICKY
  }

  override fun promote(jobs: List<BackgroundDownloads.Job>, session: String) {
    activeSession = session
    val notification = notifications.build(jobs, session)
    if (Build.VERSION.SDK_INT >= 29) startForeground(DownloadNotifications.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(DownloadNotifications.NOTIFICATION_ID, notification)
    if (jobs.isNotEmpty()) holdWakeLock()
  }

  override fun scheduleRefresh() {
    if (refreshPending) return
    refreshPending = true
    main.postDelayed(refresh, 750)
  }

  override fun hasWakeLock() = wakeLock?.isHeld == true

  private fun holdWakeLock() {
    val lock = wakeLock ?: (getSystemService(POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Resonus:BackgroundDownloads").also {
        it.setReferenceCounted(false); wakeLock = it
      }
    // A safety ceiling backs up the normal token-scoped release paths. Later
    // progress can reacquire an expired lock; paused/completed jobs never do.
    if (!lock.isHeld) lock.acquire(6 * 60 * 60 * 1000L)
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  override fun finish() { finish(latestStartId) }

  internal fun finish(startId: Int) {
    main.removeCallbacks(refresh)
    refreshPending = false
    releaseWakeLock()
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE)
    else @Suppress("DEPRECATION") stopForeground(true)
    stopSelfResult(startId)
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    activeSession?.let { BackgroundDownloads.action(this, it, "timeout") }
    finish(startId)
  }

  override fun onTimeout(startId: Int) {
    activeSession?.let { BackgroundDownloads.action(this, it, "timeout") }
    finish(startId)
  }

  override fun onDestroy() {
    main.removeCallbacks(refresh)
    releaseWakeLock()
    BackgroundDownloads.serviceDestroyed(this, activeSession)
    activeSession = null
    super.onDestroy()
  }

  companion object {
    const val EXTRA_SESSION = "resonus.background.session"
  }
}
