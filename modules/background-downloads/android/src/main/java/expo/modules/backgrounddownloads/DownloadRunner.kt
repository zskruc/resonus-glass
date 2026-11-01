package expo.modules.backgrounddownloads

internal interface DownloadRunner {
  val kind: String
  fun promote(jobs: List<BackgroundDownloads.Job>, session: String)
  fun scheduleRefresh()
  fun hasWakeLock(): Boolean
  fun finish()
}
