package expo.modules.kotlin

import kotlinx.coroutines.CoroutineScope

/** Only the Expo event boundary is replaced; the production ticker is compiled. */
class AppContext(val mainQueue: CoroutineScope)
