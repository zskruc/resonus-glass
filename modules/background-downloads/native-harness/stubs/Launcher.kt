package expo.modules.backgrounddownloads
import android.content.Context
import android.content.Intent
internal object DownloadLauncher {
  fun launch(context: Context, session: String, jobs: List<BackgroundDownloads.Job>): () -> Unit {
    val intent = Intent(context, BackgroundDownloadService::class.java).putExtra(BackgroundDownloadService.EXTRA_SESSION, session)
    context.startForegroundService(intent)
    return { context.stopService(intent); Unit }
  }
}
