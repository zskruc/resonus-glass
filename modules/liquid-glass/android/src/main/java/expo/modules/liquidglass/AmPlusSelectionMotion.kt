/*
 * Selection deformation adapted from Zennmn/AM-plus-plus (GPL-3.0), commit
 * 36dd119950b001883d3e31e17586f545d404a7c1, glass/.../LiquidBottomTabs.kt.
 * Its original Backdrop material is Apache-2.0; existing notices are retained.
 */
package expo.modules.liquidglass

import kotlin.math.abs

/** One formula for the visible lens and both inverse backdrop transforms. */
internal object AmPlusSelectionMotion {
  /** The source row/optical overlay only exist for the finite selection gesture. */
  fun isInteracting(press: Float, scaleX: Float, scaleY: Float, velocity: Float, offset: Float): Boolean =
    press > .001f || abs(scaleX - 1f) > .001f || abs(scaleY - 1f) > .001f ||
      abs(velocity) > .001f || abs(offset) > .001f

  private fun speed(velocity: Float, press: Float): Float =
    (if (velocity.isFinite()) velocity else 0f) / 10f *
      (if (press.isFinite()) press.coerceIn(0f, 1f) else 0f)

  fun scaleX(base: Float, velocity: Float, press: Float): Float =
    base / (1f - (speed(velocity, press) * 0.75f).coerceIn(-0.2f, 0.2f))

  fun scaleY(base: Float, velocity: Float, press: Float): Float =
    base * (1f - (speed(velocity, press) * 0.25f).coerceIn(-0.2f, 0.2f))
}
