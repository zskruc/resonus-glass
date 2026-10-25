package expo.modules.liquidglass

import java.util.IdentityHashMap

/** Tracks visible material identities and geometry without per-frame state allocations. */
internal class BackdropGeometryChanges<T : Any> {
  interface Observer<T> {
    fun fingerprint(surface: T): Long
    fun changed(surface: T)
  }

  private class Observation(var fingerprint: Long, var frame: Long)
  private val observations = IdentityHashMap<T, Observation>()
  private var frame = 0L
  private var visibleCount = 0

  /** Run before capture scheduling: even a busy GPU must redraw moved materials now. */
  fun update(visible: List<T>, observer: Observer<T>): Boolean {
    val previousFrame = frame
    frame++
    var changed = visible.size != visibleCount
    visibleCount = visible.size
    for (index in visible.indices) {
      val surface = visible[index]
      val fingerprint = observer.fingerprint(surface)
      val previous = observations[surface]
      val surfaceChanged = previous == null || previous.frame != previousFrame ||
        previous.fingerprint != fingerprint
      if (previous == null) {
        observations[surface] = Observation(fingerprint, frame)
      } else {
        previous.fingerprint = fingerprint
        previous.frame = frame
      }
      if (surfaceChanged) {
        changed = true
        observer.changed(surface)
      }
    }
    return changed
  }

  fun forget(surface: T) {
    observations.remove(surface)
  }

  fun clear() {
    observations.clear()
    frame = 0L
    visibleCount = 0
  }
}
