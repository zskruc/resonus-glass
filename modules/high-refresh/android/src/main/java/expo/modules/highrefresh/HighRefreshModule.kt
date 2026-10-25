package expo.modules.highrefresh

import android.view.Window
import com.facebook.react.bridge.ReactContext
import com.facebook.react.interfaces.ExtraWindowEventListener
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HighRefreshModule : Module() {
  private var registeredContext: ReactContext? = null
  private val extraWindowListener = object : ExtraWindowEventListener {
    override fun onExtraWindowCreate(window: Window) = HighRefresh.onExtraWindowCreate(window)
    override fun onExtraWindowDestroy(window: Window) = HighRefresh.onExtraWindowDestroy(window)
  }

  override fun definition() = ModuleDefinition {
    Name("ResonusHighRefresh")
    OnCreate {
      // Expo 57 exposes this as android.content.Context, even though the
      // hosting instance is a ReactApplicationContext.
      registeredContext = appContext.reactContext as? ReactContext
      registeredContext?.addExtraWindowEventListener(extraWindowListener)
    }
    OnDestroy {
      registeredContext?.removeExtraWindowEventListener(extraWindowListener)
      registeredContext = null
    }
    AsyncFunction("getDiagnostics") { HighRefresh.diagnostics() }.runOnQueue(Queues.MAIN)
  }
}
