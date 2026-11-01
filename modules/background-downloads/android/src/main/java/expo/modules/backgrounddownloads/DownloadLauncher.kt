package expo.modules.backgrounddownloads

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.PersistableBundle

/** Exactly one platform runner; new Android never stacks a UIDT job with a dataSync FGS. */
internal object DownloadLauncher {
  private const val JOB_ID = 2056
  fun launch(context: Context, session: String, jobs: List<BackgroundDownloads.Job>): () -> Unit {
    if (Build.VERSION.SDK_INT >= 34) {
      val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
      val extras = PersistableBundle().apply { putString(BackgroundDownloadService.EXTRA_SESSION, session) }
      val network = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build()
      val builder = JobInfo.Builder(JOB_ID, ComponentName(context, BackgroundDownloadJobService::class.java))
        .setUserInitiated(true).setRequiredNetwork(network).setExtras(extras)
      val estimated = jobs.sumOf { (it.progress.bytesTotal - it.progress.bytesDone).coerceAtLeast(0.0) }
        .takeIf { it.isFinite() && it > 0 }?.toLong()
      if (estimated != null) builder.setEstimatedNetworkBytes(estimated, 0)
      check(scheduler.schedule(builder.build()) == JobScheduler.RESULT_SUCCESS) { "UIDT scheduling rejected" }
      return { scheduler.cancel(JOB_ID) }
    }
    val intent = Intent(context, BackgroundDownloadService::class.java)
      .putExtra(BackgroundDownloadService.EXTRA_SESSION, session)
    if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    return { context.stopService(intent); Unit }
  }
}
