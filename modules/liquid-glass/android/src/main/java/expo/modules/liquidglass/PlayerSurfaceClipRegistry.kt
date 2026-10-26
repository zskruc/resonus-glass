package expo.modules.liquidglass

import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** A fresh token per attachment, even when the same native view is reattached. */
internal class PlayerSurfaceClipRegistry<T : Any> {
  private val nextToken = AtomicInteger(0)
  private val hosts = ConcurrentHashMap<Int, WeakReference<T>>()

  fun attach(host: T): Int {
    // Detach normally removes the entry. Prune a collected host defensively
    // during attachment only; never scan this map in the frame update path.
    hosts.entries.removeIf { it.value.get() == null }
    return nextToken.incrementAndGet().also { hosts[it] = WeakReference(host) }
  }
  fun detach(token: Int) { hosts.remove(token) }
  fun get(token: Int): T? {
    val reference = hosts[token] ?: return null
    val host = reference.get()
    if (host == null) hosts.remove(token, reference)
    return host
  }
  internal val size: Int get() = hosts.size
}
