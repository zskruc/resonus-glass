package expo.modules.backgrounddownloads

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DownloadNotificationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val session = intent.getStringExtra(DownloadNotifications.EXTRA_SESSION) ?: return
    val reason = when (intent.action) {
      DownloadNotifications.ACTION_PAUSE -> "pause"
      DownloadNotifications.ACTION_CANCEL -> "cancel"
      else -> return
    }
    BackgroundDownloads.notificationAction(session, reason)
  }
}
