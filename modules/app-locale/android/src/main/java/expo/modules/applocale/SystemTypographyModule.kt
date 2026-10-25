package expo.modules.applocale

import android.content.ComponentCallbacks
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Reads the system's text weight without changing any device or app setting. */
class SystemTypographyModule : Module() {
  private var registeredContext: Context? = null
  private var lastAdjustment: Int? = null
  private var active = false
  private val adjustmentLock = Any()

  private val configurationCallbacks = object : ComponentCallbacks {
    override fun onConfigurationChanged(newConfig: Configuration) {
      refresh(newConfig)
    }

    override fun onLowMemory() = Unit
  }

  override fun definition() = ModuleDefinition {
    Name("SystemTypography")
    Events("onFontWeightAdjustmentChanged")

    OnCreate {
      val adjustment = readAdjustment(currentConfiguration())
      synchronized(adjustmentLock) {
        active = true
        lastAdjustment = adjustment
      }
      logStartupAdjustment(adjustment)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val context = appContext.reactContext?.applicationContext
        if (context != null) {
          context.registerComponentCallbacks(configurationCallbacks)
          registeredContext = context
        }
      }
    }

    OnDestroy {
      synchronized(adjustmentLock) {
        active = false
      }
      registeredContext?.unregisterComponentCallbacks(configurationCallbacks)
      registeredContext = null
    }

    OnActivityEntersForeground {
      refresh(currentConfiguration())
    }

    Function("getFontWeightAdjustment") {
      readAdjustment(currentConfiguration())
    }
  }

  private fun applicationConfiguration(): Configuration? =
    (registeredContext ?: appContext.reactContext?.applicationContext)?.resources?.configuration

  private fun currentConfiguration(): Configuration =
    // The activity deliberately sets this field to 0 so TextView cannot add it
    // again after RN measures our explicit weight. Read the original preference
    // from the application, not that activity's createConfigurationContext.
    applicationConfiguration() ?: Resources.getSystem().configuration

  /** One startup line, with only numeric appearance settings. */
  private fun logStartupAdjustment(adjustment: Int) {
    val application = readAdjustment(applicationConfiguration())
    val activity = readAdjustment(appContext.currentActivity?.resources?.configuration)
    val system = readAdjustment(Resources.getSystem().configuration)
    Log.i("ResonusTypography", "adjustment=$adjustment applicationAdjustment=$application activityAdjustment=$activity systemAdjustment=$system")
  }

  private fun readAdjustment(configuration: Configuration?): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || configuration == null) return 0
    val value = configuration.fontWeightAdjustment
    return if (value == Configuration.FONT_WEIGHT_ADJUSTMENT_UNDEFINED) 0 else value.coerceIn(-1000, 1000)
  }

  private fun refresh(configuration: Configuration?) {
    val adjustment = readAdjustment(configuration)
    synchronized(adjustmentLock) {
      if (!active || lastAdjustment == adjustment) return
      lastAdjustment = adjustment
      sendEvent("onFontWeightAdjustmentChanged", mapOf("adjustment" to adjustment))
    }
  }
}
