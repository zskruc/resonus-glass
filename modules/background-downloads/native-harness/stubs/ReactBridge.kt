package com.facebook.react.bridge
import android.content.Context
class ReactContext : Context() { var active = true; fun hasActiveReactInstance() = active }
class WritableMap { val values = mutableMapOf<String, String>(); fun putString(key: String, value: String) { values[key] = value } }
object Arguments { fun createMap() = WritableMap() }
