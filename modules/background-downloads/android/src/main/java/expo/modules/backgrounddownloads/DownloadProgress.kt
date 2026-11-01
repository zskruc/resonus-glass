package expo.modules.backgrounddownloads

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class DownloadProgress : Record {
  /** Processed units, including failed units; failed is a subset, not additional progress. */
  @Field var completed: Int = 0
  @Field var total: Int = 0
  @Field var failed: Int = 0
  @Field var bytesDone: Double = 0.0
  @Field var bytesTotal: Double = 0.0
  @Field var locale: String = "zh"

  internal fun clean() = Progress(completed.coerceAtLeast(0), total.coerceAtLeast(0), failed.coerceAtLeast(0),
    bytesDone.takeIf { it.isFinite() && it > 0 } ?: 0.0,
    bytesTotal.takeIf { it.isFinite() && it > 0 } ?: 0.0, if (locale == "en") "en" else "zh")
}

internal data class Progress(val completed: Int, val total: Int, val failed: Int,
  val bytesDone: Double, val bytesTotal: Double, val locale: String) {
  fun toMap(): Map<String, Any> = mapOf("completed" to completed, "total" to total,
    "failed" to failed, "bytesDone" to bytesDone, "bytesTotal" to bytesTotal, "locale" to locale)
}
