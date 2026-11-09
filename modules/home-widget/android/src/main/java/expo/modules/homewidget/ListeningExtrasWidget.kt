package expo.modules.homewidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/** Bounded metadata only. Playback URLs and account credentials stay in the app. */
open class ListeningExtrasWidget : AppWidgetProvider() {
  protected open val kind = "podcast"
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) { render(context, manager, ids, kind) }
  companion object {
    private val providers = listOf("podcast" to PodcastContinueWidget::class.java, "stats" to ListeningStatsWidget::class.java, "lyrics" to CurrentLyricsWidget::class.java)
    private const val PREFS = "resonus_widget_extras"
    @Volatile private var schemeCache: Pair<String, String?>? = null
    private fun registeredScheme(context: Context): String? {
      val packageName = context.packageName
      schemeCache?.takeIf { it.first == packageName }?.let { return it.second }
      // Probe an implicit intent: an explicit MainActivity resolves even when
      // the URI's scheme is absent from this installed flavour's manifest.
      val scheme = listOf("resonus-glass", "resonus").firstOrNull { candidate ->
        val probe = Intent(Intent.ACTION_VIEW, Uri.Builder().scheme(candidate).authority("widget-listening").build())
          .addCategory(Intent.CATEGORY_DEFAULT).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(packageName)
        context.packageManager.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName == packageName
      }
      schemeCache = packageName to scheme
      return scheme
    }
    fun installed(context: Context): List<String> {
      val manager = AppWidgetManager.getInstance(context)
      return providers.filter { manager.getAppWidgetIds(ComponentName(context, it.second)).isNotEmpty() }.map { it.first }
    }
    fun pin(context: Context, kind: String): Boolean {
      if (android.os.Build.VERSION.SDK_INT < 26) return false
      val provider = providers.firstOrNull { it.first == kind }?.second ?: return false
      val manager = AppWidgetManager.getInstance(context)
      return manager.isRequestPinAppWidgetSupported && manager.requestPinAppWidget(ComponentName(context, provider), null, null)
    }
    fun update(context: Context, text: String) {
      require(text.length <= 16000) { "Widget snapshot is too large" }
      val data = JSONObject(text)
      require(data.optString("profile").matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid widget owner" }
      val safe = JSONObject().put("profile", data.getString("profile"))
      for ((kind, _) in providers) {
        val input = data.optJSONObject(kind) ?: continue
        val section = JSONObject().put("title", input.optString("title").take(180))
        val rows = org.json.JSONArray()
        val incoming = input.optJSONArray("rows")
        for (index in 0 until minOf(incoming?.length() ?: 0, 3)) {
          val row = incoming?.optJSONObject(index) ?: continue
          rows.put(JSONObject().put("id", row.optString("id").take(2048)).put("text", row.optString("text").take(400)))
        }
        safe.put(kind, section.put("rows", rows))
      }
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("snapshot", safe.toString()).apply()
      val manager = AppWidgetManager.getInstance(context)
      for ((kind, provider) in providers) render(context, manager, manager.getAppWidgetIds(ComponentName(context, provider)), kind)
    }
    private fun render(context: Context, manager: AppWidgetManager, ids: IntArray, kind: String) {
      if (ids.isEmpty()) return
      val data = runCatching { JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("snapshot", "{}") ?: "{}") }.getOrDefault(JSONObject())
      val section = data.optJSONObject(kind)
      val rows = section?.optJSONArray("rows")
      val views = RemoteViews(context.packageName, R.layout.hw_widget_extras)
      val name = when (kind) { "stats" -> R.string.widget_stats_name; "lyrics" -> R.string.widget_lyrics_name; else -> R.string.widget_podcast_name }
      views.setTextViewText(R.id.hw_extra_title, section?.optString("title")?.takeIf { it.isNotBlank() } ?: context.getString(name))
      val profile = data.optString("profile")
      views.setOnClickPendingIntent(R.id.hw_extra_root, open(context, kind, profile, ""))
      val targets = intArrayOf(R.id.hw_extra_one, R.id.hw_extra_two, R.id.hw_extra_three)
      for ((index, target) in targets.withIndex()) {
        val row = rows?.optJSONObject(index)
        val text = row?.optString("text")?.take(400)
        views.setTextViewText(target, text?.takeIf { it.isNotBlank() } ?: if (index == 0) context.getString(R.string.widget_idle) else "")
        views.setViewVisibility(target, if (index == 0 || !text.isNullOrBlank()) View.VISIBLE else View.GONE)
        views.setOnClickPendingIntent(target, open(context, kind, profile, row?.optString("id") ?: ""))
      }
      manager.updateAppWidget(ids, views)
    }
    private fun open(context: Context, kind: String, profile: String, id: String): PendingIntent {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
      val uri = registeredScheme(context)?.let { scheme -> Uri.Builder().scheme(scheme).authority("widget-listening").appendQueryParameter("kind", kind)
        .appendQueryParameter("profile", profile).appendQueryParameter("id", id).build() }
      if (uri != null) { launch.action = Intent.ACTION_VIEW; launch.data = uri; launch.addCategory(Intent.CATEGORY_BROWSABLE) }
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(context, (uri?.toString() ?: "$kind:$profile:$id").hashCode(), launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
  }
}
class PodcastContinueWidget : ListeningExtrasWidget() { override val kind = "podcast" }
class ListeningStatsWidget : ListeningExtrasWidget() { override val kind = "stats" }
class CurrentLyricsWidget : ListeningExtrasWidget() { override val kind = "lyrics" }
