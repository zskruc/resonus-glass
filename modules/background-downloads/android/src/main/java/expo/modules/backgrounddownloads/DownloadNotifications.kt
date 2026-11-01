package expo.modules.backgrounddownloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import java.util.Locale

/** Shared aggregate notification; neither action launches a second platform runner. */
internal class DownloadNotifications(context: Context) : ContextWrapper(context) {
  private fun resourcesFor(locale: String): Context {
    val configuration = Configuration(resources.configuration)
    configuration.setLocale(if (locale == "en") Locale.ENGLISH else Locale.SIMPLIFIED_CHINESE)
    return createConfigurationContext(configuration)
  }

  fun build(jobs: List<BackgroundDownloads.Job>, session: String): Notification {
    val strings = resourcesFor(jobs.lastOrNull()?.progress?.locale ?: "zh")
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID,
        strings.getString(R.string.resonus_download_channel), NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
    }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    val lines = jobs.map { job ->
      val format = if (job.owner == "music") R.string.resonus_download_music else R.string.resonus_download_cache
      strings.getString(format, job.progress.completed, job.progress.total)
    }
    val failures = jobs.sumOf { it.progress.failed.toLong() }
    val text = (lines + if (failures > 0) listOf(strings.getString(R.string.resonus_download_failed, failures)) else emptyList()).joinToString(" · ")
      .ifEmpty { strings.getString(R.string.resonus_download_preparing) }
    val total = jobs.sumOf { it.progress.total.toLong() }
    val processed = jobs.sumOf { it.progress.completed.toLong().coerceAtMost(it.progress.total.toLong()) }
    val determinate = total > 0 && jobs.all { it.progress.total > 0 }
    builder.setSmallIcon(R.drawable.resonus_download_notification)
      .setContentTitle(strings.getString(R.string.resonus_download_title))
      .setSubText(applicationInfo.loadLabel(packageManager))
      .setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
      .setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
      .setCategory(Notification.CATEGORY_PROGRESS).setVisibility(Notification.VISIBILITY_PRIVATE)
      .setProgress(1000, if (determinate) (processed * 1000 / total).toInt().coerceIn(0, 1000) else 0, !determinate)
      .addAction(Notification.Action.Builder(android.R.drawable.ic_media_pause,
        strings.getString(R.string.resonus_download_pause), actionIntent(ACTION_PAUSE, session, 1)).build())
      .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,
        strings.getString(R.string.resonus_download_cancel), actionIntent(ACTION_CANCEL, session, 2)).build())
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    return builder.build()
  }

  private fun actionIntent(action: String, session: String, code: Int): PendingIntent {
    val intent = Intent(this, DownloadNotificationReceiver::class.java).setAction(action)
      .setData(Uri.parse("resonus-background://session/$session/$code")).putExtra(EXTRA_SESSION, session)
    return PendingIntent.getBroadcast(this, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  companion object {
    const val NOTIFICATION_ID = 2056
    const val EXTRA_SESSION = "resonus.background.session"
    const val ACTION_PAUSE = "resonus.background.PAUSE"
    const val ACTION_CANCEL = "resonus.background.CANCEL"
    private const val CHANNEL_ID = "resonus-background-downloads"
  }
}
