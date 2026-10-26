package expo.modules.amllbackground

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AmllBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ResonusAmllBackground")
    OnCreate { ArtworkBackgroundViews.setForeground(true) }
    OnActivityEntersForeground { ArtworkBackgroundViews.setForeground(true) }
    OnActivityEntersBackground { ArtworkBackgroundViews.setForeground(false) }
    OnDestroy { ArtworkBackgroundViews.setForeground(false) }
    View(AmllBackgroundView::class) {
      Prop("localUri") { view: AmllBackgroundView, uri: String? -> view.setArtwork(uri) }
      Prop("active") { view: AmllBackgroundView, active: Boolean -> view.setActive(active) }
    }
  }
}
