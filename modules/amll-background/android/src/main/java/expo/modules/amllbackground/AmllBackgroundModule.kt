package expo.modules.amllbackground

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AmllBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ResonusAmllBackground")
    OnCreate { ArtworkBackgroundViews.setForeground(true) }
    OnActivityEntersForeground { ArtworkBackgroundViews.setForeground(true) }
    OnActivityEntersBackground { ArtworkBackgroundViews.setForeground(false) }
    OnDestroy { ArtworkBackgroundViews.setForeground(false) }
    AsyncFunction("prepareArtistArtwork") Coroutine { localUri: String, heroAspectRatio: Double, extensionRatio: Double ->
      val context = appContext.reactContext?.applicationContext ?: return@Coroutine null
      withContext(Dispatchers.Default) {
        ArtistArtworkField.prepare(context, localUri, heroAspectRatio, extensionRatio)
      }
    }
    View(AmllBackgroundView::class) {
      Prop("localUri") { view: AmllBackgroundView, uri: String? -> view.setArtwork(uri) }
      Prop("active") { view: AmllBackgroundView, active: Boolean -> view.setActive(active) }
    }
  }
}
