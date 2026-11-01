package android.content
open class Context {
  open val applicationContext: Context get() = this
  val starts = mutableListOf<Intent>()
  var cancellations = 0
  var startFailure: Exception? = null
  fun startForegroundService(intent: Intent) { startFailure?.let { throw it }; starts.add(intent) }
  fun startService(intent: Intent) = startForegroundService(intent)
  fun stopService(intent: Intent): Boolean { cancellations++; return true }
  fun checkSelfPermission(permission: String) = 0
}
class Intent(context: Context, type: Class<*>) {
  private val extras = mutableMapOf<String, String>()
  fun putExtra(key: String, value: String): Intent { extras[key] = value; return this }
  fun getStringExtra(key: String) = extras[key]
}
