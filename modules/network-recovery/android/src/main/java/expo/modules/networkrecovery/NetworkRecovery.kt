package expo.modules.networkrecovery

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientProvider

/** Installed before any React Native or Expo fetch client is created. */
object NetworkRecovery {
  private var installed = false

  @JvmStatic
  @Synchronized
  fun install(context: Context) {
    if (installed) return
    val appContext = context.applicationContext
    val dns = ResonusDns(appContext)
    // The context overload differs only by its disk cache. Own it once;
    // fresh default builders retain separate ReactCookieJarContainers,
    // dispatchers and connection pools for each original native client.
    val cache = OkHttpClientProvider.createClientBuilder(appContext).build().cache
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder().cache(cache).dns(dns).build()
    }
    installed = true
  }
}
