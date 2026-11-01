package expo.modules.backgrounddownloads
/** Fake Android boundary only. Production BackgroundDownloads/DownloadProgress are compiled unchanged. */
internal class BackgroundDownloadService(override val kind: String = "foreground-service") : DownloadRunner {
  var promotions = 0; var finishes = 0; var lock = false; var failPromotion = false
  override fun promote(jobs: List<BackgroundDownloads.Job>, session: String) {
    promotions++; lock = jobs.isNotEmpty() && kind == "foreground-service"; if (failPromotion) throw IllegalStateException("promotion rejected")
  }
  override fun finish() { finishes++; lock = false }
  override fun scheduleRefresh() = Unit
  override fun hasWakeLock() = lock
  companion object { const val EXTRA_SESSION = "session" }
}
