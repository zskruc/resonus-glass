package expo.modules.liquidglass

import android.os.SystemClock
import android.util.Log
import java.util.concurrent.atomic.AtomicInteger

/** Explicit opt-in, bounded geometry diagnostics. Never accepts page or media data. */
internal object PlayerTransitionTrace {
  private const val TAG = "ResonusPlayerTrace"
  private const val LIMIT = 120
  private val remaining = AtomicInteger(0)
  @Volatile var enabled = false; private set
  @Volatile var session = 0; private set

  @Synchronized fun configure(value: Boolean) {
    if (value == enabled) return
    if (!value) { enabled = false; return }
    remaining.set(LIMIT)
    session++
    enabled = true
  }

  private fun claim(): Boolean {
    if (!enabled) return false
    while (true) {
      val count = remaining.get()
      if (count <= 0) return false
      if (remaining.compareAndSet(count, count - 1)) return enabled
    }
  }

  fun backdropClear(epoch: Long, time: Long, emptySince: Long, oldHasFrame: Boolean,
    captureAllowed: Boolean, modal: Boolean) {
    if (!claim()) return
    Log.i(TAG, "backdropClear t=$time epoch=$epoch emptySince=$emptySince " +
      "oldHasFrame=$oldHasFrame allowed=$captureAllowed modal=$modal")
  }

  fun backdropPublish(epoch: Long, time: Long, emptySince: Long, modal: Boolean) {
    if (!claim()) return
    Log.i(TAG, "backdropFirstPublish t=$time epoch=$epoch gapMs=${time - emptySince} modal=$modal")
  }

  fun bridge(event: String, epoch: Long, generation: Long, serial: Long, reason: String = "none") {
    if (!claim()) return
    Log.i(TAG, "bridge.$event t=${SystemClock.uptimeMillis()} epoch=$epoch generation=$generation " +
      "serial=$serial reason=$reason")
  }

  fun bridgeCandidate(epoch: Long, generation: Long, serial: Long, mask: Int, sourceKind: Int) {
    if (!claim()) return
    val blocked = RecordedBackdropEligibility.REQUIRED and mask.inv()
    Log.i(TAG, "bridge.candidate t=${SystemClock.uptimeMillis()} epoch=$epoch generation=$generation " +
      "serial=$serial sourceKind=$sourceKind flags=$mask blockedBits=$blocked")
  }

  /** Called only at attachment or a zero/nonzero alpha boundary, never every frame. */
  fun clip(event: String, host: Int, previousAlpha: Float, alpha: Float, bounds: PlayerSurfaceClipBounds) {
    if (!claim()) return
    Log.i(TAG, "clip.$event t=${SystemClock.uptimeMillis()} host=$host from=$previousAlpha alpha=$alpha " +
      "hasFrame=${bounds.hasFrame} leftPx=${bounds.left} topPx=${bounds.top} " +
      "widthPx=${bounds.right - bounds.left} heightPx=${bounds.bottom - bounds.top} radiusPx=${bounds.radius}")
  }
}
