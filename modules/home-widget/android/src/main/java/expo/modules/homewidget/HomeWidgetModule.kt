package expo.modules.homewidget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class NowPlayingRecord : Record {
  @Field val title: String = ""
  @Field val artist: String = ""
  @Field val artworkUrl: String? = null
  @Field val playing: Boolean = false
  @Field val active: Boolean = false
}

class ShortcutRecord : Record {
  @Field val id: String = ""
  @Field val label: String = ""
  @Field val icon: String = ""
  @Field val url: String = ""
}

/**
 * The app outside itself: the home screen widget and the Quick Settings tile
 * (fed with what is playing), and the shortcuts on the launcher icon.
 */
class HomeWidgetModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("HomeWidget")
    Function("getInstalledExtras") { ListeningExtrasWidget.installed(context) }
    Function("pinExtraWidget") { kind: String -> ListeningExtrasWidget.pin(context, kind) }
    Function("updateExtras") { value: String -> ListeningExtrasWidget.update(context, value) }

    Function("update") { state: NowPlayingRecord ->
      NowPlaying.update(
        context,
        NowPlaying.State(
          title = state.title,
          artist = state.artist,
          artworkUrl = state.artworkUrl,
          playing = state.playing,
          active = state.active,
        ),
      )
    }

    /** Replaces the dynamic shortcuts; labels come translated from JS. */
    Function("setShortcuts") { items: List<ShortcutRecord> ->
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?.component ?: return@Function false
      val shortcuts = items.take(ShortcutManagerCompat.getMaxShortcutCountPerActivity(context))
        .mapIndexed { rank, item ->
          ShortcutInfoCompat.Builder(context, item.id)
            .setShortLabel(item.label)
            .setLongLabel(item.label)
            .setRank(rank)
            .setIcon(IconCompat.createWithResource(context, iconFor(item.icon)))
            .setIntent(
              Intent(Intent.ACTION_VIEW, Uri.parse(item.url)).setComponent(launch),
            )
            .build()
        }
      runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts) }.getOrDefault(false)
    }
  }

  private fun iconFor(name: String): Int = when (name) {
    "shuffle" -> R.drawable.hw_shortcut_shuffle
    "search" -> R.drawable.hw_shortcut_search
    else -> R.drawable.hw_shortcut_play
  }
}
