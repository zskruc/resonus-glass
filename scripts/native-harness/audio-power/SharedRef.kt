package expo.modules.kotlin.sharedobjects

import expo.modules.kotlin.AppContext

open class SharedRef<T>(val ref: T, val appContext: AppContext?) {
  val emitted = mutableListOf<Pair<String, Any?>>()
  fun emit(name: String, payload: Any? = null) { emitted.add(name to payload) }
  open fun sharedObjectDidRelease() {}
}
