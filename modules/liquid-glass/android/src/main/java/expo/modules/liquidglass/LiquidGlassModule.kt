package expo.modules.liquidglass

import android.os.Build
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LiquidGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ResonusLiquidGlass")
    Constant("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.S }
    AsyncFunction("getDiagnostics") {
      WindowBackdrops.diagnostics() + TabsMotionHosts.diagnostics()
    }.runOnQueue(Queues.MAIN)
    // Scalar-only sync Expo Function is a JSI HostFunction. Installed Worklets
    // shares that raw function into its UI runtime, without a JS bridge or a
    // Fabric props/ShadowTree commit on each animation frame.
    Function("updateTabsMotion") { token: Int, position: Double, progress: Double,
      scaleX: Double, scaleY: Double, velocity: Double, panelOffset: Double, opacity: Double ->
      TabsMotionHosts.update(token, position, progress, scaleX, scaleY, velocity, panelOffset, opacity)
    }
    Function("updateDockProgress") { token: Int, progress: Double ->
      TabsMotionHosts.updateDock(token, progress)
    }
    Function("updateButtonMotion") { token: Int, progress: Double, x: Double, y: Double ->
      TabsMotionHosts.updateButton(token, progress, x, y)
    }

    View(LiquidGlassView::class) {
      Events("onMotionHostReady")
      Prop("materialPreset") { view: LiquidGlassView, value: String ->
        view.materialPreset = when (value) {
          "custom", "button", "tabs", "dialog", "amPlus", "mediaPopup", "mediaPopupBottom", "mediaMenu" -> value
          else -> "button"
        }
      }
      Prop("radius") { view: LiquidGlassView, value: Double -> view.radius = value.toFloat().coerceIn(0f, 200f) }
      Prop("radiusTopLeft") { view: LiquidGlassView, value: Double? -> view.radiusTopLeft = value?.toFloat()?.coerceIn(0f, 200f) }
      Prop("radiusTopRight") { view: LiquidGlassView, value: Double? -> view.radiusTopRight = value?.toFloat()?.coerceIn(0f, 200f) }
      Prop("radiusBottomLeft") { view: LiquidGlassView, value: Double? -> view.radiusBottomLeft = value?.toFloat()?.coerceIn(0f, 200f) }
      Prop("radiusBottomRight") { view: LiquidGlassView, value: Double? -> view.radiusBottomRight = value?.toFloat()?.coerceIn(0f, 200f) }
      Prop("blur") { view: LiquidGlassView, value: Double -> view.updateBlurRadius(value.toFloat().coerceIn(0f, 40f)) }
      Prop("progressiveBlur") { view: LiquidGlassView, value: Boolean -> view.setProgressiveBlurEnabled(value) }
      Prop("preferUnblurredBackdrop") { view: LiquidGlassView, value: Boolean -> view.setPreferUnblurredBackdrop(value) }
      Prop("isolateModalForeground") { view: LiquidGlassView, value: Boolean -> view.setIsolateModalForeground(value) }
      Prop("refraction") { view: LiquidGlassView, value: Double -> view.updateRefraction(value.toFloat().coerceIn(0f, 48f)) }
      Prop("refractionHeight") { view: LiquidGlassView, value: Double? -> view.updateRefractionHeight(value?.toFloat()?.coerceIn(0f, 48f)) }
      Prop("highlightWidth") { view: LiquidGlassView, value: Double -> view.highlightWidth = value.toFloat().coerceIn(0f, 8f) }
      Prop("highlightOpacity") { view: LiquidGlassView, value: Double? -> view.highlightOpacity = value?.toFloat()?.coerceIn(0f, 1f) }
      Prop("depthEffect") { view: LiquidGlassView, value: Boolean -> view.depthEffect = value }
      Prop("chromaticAberration") { view: LiquidGlassView, value: Boolean -> view.chromaticAberration = value }
      Prop("tintColor") { view: LiquidGlassView, value: Int -> view.updateTintColor(value) }
      Prop("tintOpacity") { view: LiquidGlassView, value: Double -> view.updateTintOpacity(value.toFloat().coerceIn(0f, 1f)) }
      Prop("dark") { view: LiquidGlassView, value: Boolean -> view.dark = value }
      Prop("staticBackdropColor") { view: LiquidGlassView, value: Int? -> view.updateStaticBackdropColor(value) }
      Prop("dockRole") { view: LiquidGlassView, value: String? ->
        view.dockRole = when (value) { "navigation", "search" -> value; else -> "mini" }
      }
      Prop("dockRowWidth") { view: LiquidGlassView, value: Double? ->
        view.dockRowWidth = value?.toFloat()?.takeIf { it.isFinite() }?.coerceIn(0f, 2000f) ?: 0f
      }
      Prop("dockCompactWidth") { view: LiquidGlassView, value: Double? -> view.setDockCompactWidth(value?.toFloat() ?: 0f) }
      Prop("dockExpandedHeight") { view: LiquidGlassView, value: Double? -> view.dockExpandedHeight = value?.toFloat()?.takeIf { it.isFinite() }?.coerceIn(0f, 2000f) ?: 0f }
      Prop("dockCompactHeight") { view: LiquidGlassView, value: Double? -> view.dockCompactHeight = value?.toFloat()?.takeIf { it.isFinite() }?.coerceIn(0f, 2000f) ?: 0f }
      Prop("dockCompactOffsetX") { view: LiquidGlassView, value: Double? -> view.dockCompactOffsetX = value?.toFloat()?.takeIf { it.isFinite() }?.coerceIn(-2000f, 2000f) ?: 0f }
      Prop("tabsCount") { view: LiquidGlassView, value: Int -> view.tabsCount = value.coerceIn(0, 5) }
      Prop("tabHorizontalInset") { view: LiquidGlassView, value: Double -> view.tabHorizontalInset = value.toFloat().coerceIn(0f, 32f) }
      Prop("tabVerticalInset") { view: LiquidGlassView, value: Double -> view.tabVerticalInset = value.toFloat().coerceIn(0f, 16f) }
      Prop("tabPosition") { view: LiquidGlassView, value: Double -> view.tabPosition = value.toFloat().coerceIn(0f, 4f) }
      Prop("tabPressProgress") { view: LiquidGlassView, value: Double -> view.tabPressProgress = value.toFloat().coerceIn(0f, 1f) }
      Prop("tabScaleX") { view: LiquidGlassView, value: Double -> view.tabScaleX = value.toFloat().coerceIn(0.5f, 1.8f) }
      Prop("tabScaleY") { view: LiquidGlassView, value: Double -> view.tabScaleY = value.toFloat().coerceIn(0.5f, 1.8f) }
      Prop("tabVelocity") { view: LiquidGlassView, value: Double -> view.tabVelocity = value.toFloat().coerceIn(-10f, 10f) }
      Prop("tabPanelOffset") { view: LiquidGlassView, value: Double -> view.tabPanelOffset = value.toFloat().coerceIn(-4f, 4f) }
      Prop("tabSelectionOpacity") { view: LiquidGlassView, value: Double -> view.tabSelectionOpacity = value.toFloat().coerceIn(0f, 1f) }
      Prop("enabled") { view: LiquidGlassView, value: Boolean -> view.setGlassEnabled(value) }
    }
    View(LiquidGlassToggleView::class) {
      Name("LiquidGlassToggle")
      Events("onValueChange")
      Prop("value") { view: LiquidGlassToggleView, value: Boolean -> view.value = value }
      Prop("disabled") { view: LiquidGlassToggleView, value: Boolean -> view.controlDisabled = value }
      Prop("dark") { view: LiquidGlassToggleView, value: Boolean -> view.dark = value }
    }

    View(LiquidGlassSliderView::class) {
      Name("LiquidGlassSlider")
      Events("onValueChange", "onSlidingStart", "onSlidingComplete", "onSlidingCancel")
      Prop("value") { view: LiquidGlassSliderView, value: Double ->
        view.value = value.toFloat().takeIf { it.isFinite() } ?: view.minimumValue
      }
      Prop("minimumValue") { view: LiquidGlassSliderView, value: Double ->
        view.minimumValue = value.toFloat().takeIf { it.isFinite() } ?: 0f
      }
      Prop("maximumValue") { view: LiquidGlassSliderView, value: Double ->
        view.maximumValue = value.toFloat().takeIf { it.isFinite() } ?: 1f
      }
      Prop("step") { view: LiquidGlassSliderView, value: Double ->
        view.step = value.toFloat().takeIf { it.isFinite() && it >= 0f } ?: 0f
      }
      OnViewDidUpdateProps { view: LiquidGlassSliderView -> view.normalizeControlledValue() }
      Prop("disabled") { view: LiquidGlassSliderView, value: Boolean -> view.controlDisabled = value }
      Prop("dark") { view: LiquidGlassSliderView, value: Boolean -> view.dark = value }
    }

  }
}
