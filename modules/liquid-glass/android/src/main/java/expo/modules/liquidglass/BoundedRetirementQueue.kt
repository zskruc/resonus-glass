package expo.modules.liquidglass

import java.util.ArrayDeque

/** Native releases run outside this short lock, never while blocking a publisher. */
internal class BoundedRetirementQueue<T : Any>(val capacity: Int) {
  private val pending = ArrayDeque<T>()
  private val lock = Any()

  init { require(capacity > 0) }

  val size: Int get() = synchronized(lock) { pending.size }

  /** False transfers no ownership; the caller must release its overflow item. */
  fun offer(resource: T): Boolean = synchronized(lock) {
    if (pending.any { it === resource }) return@synchronized true
    if (pending.size >= capacity) return@synchronized false
    pending.addLast(resource)
    true
  }

  fun poll(): T? = synchronized(lock) { pending.pollFirst() }
}
