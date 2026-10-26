/*
 * Backing-capacity policy ported from Zennmn/AM-plus-plus (GPL-3.0), commit
 * 36dd119950b001883d3e31e17586f545d404a7c1: LiquidBottomTabs.kt,
 * GlassNavigation.kt and PhoneGlassSession.kt. No optical parameters change.
 */
package expo.modules.liquidglass

import androidx.compose.ui.unit.IntSize
import kotlin.math.ceil
import kotlin.math.roundToInt

/** Endpoints release the expanded capacity, including after a mode/route change. */
internal fun reserveAmPlusMaterial(amPlus: Boolean, hasDock: Boolean, progress: Float): Boolean =
  amPlus && hasDock && progress.isFinite() && progress != 0f && progress != 1f

/** Expanded bounds, plus the source's maximum gap/rebound room for side controls. */
internal fun amPlusSurfaceCapacity(role: String, expanded: IntSize, compactWidth: Float,
  gap: Float): IntSize {
  if (expanded == IntSize.Zero) return IntSize.Zero
  val width = when (role) {
    "mini" -> expanded.width
    "search" -> (maxOf(expanded.width.toFloat(), compactWidth) + gap).roundToInt()
    else -> (expanded.width + gap).roundToInt()
  }
  return IntSize(width.coerceAtLeast(0), expanded.height.coerceAtLeast(0))
}

/** Reserve pre-lens blur padding: lens() can shrink it as the real outline changes. */
internal fun amPlusPaddedCapacity(content: IntSize, blurPx: Float): IntSize {
  if (content == IntSize.Zero) return IntSize.Zero
  val outset = ceil(blurPx.coerceAtLeast(0f)).toInt() * 2
  return IntSize(content.width + outset, content.height + outset)
}

internal fun amPlusRefractionCapacity(panel: IntSize, verticalInset: Float): IntSize =
  if (panel == IntSize.Zero) IntSize.Zero else IntSize(panel.width,
    (panel.height - verticalInset * 2f).roundToInt().coerceAtLeast(0))

/** Selector keeps the expanded tab's real width, not the reserved panel's gap. */
internal fun amPlusSelectionCapacity(expanded: IntSize, horizontalInset: Float,
  verticalInset: Float, tabsCount: Int): IntSize = if (expanded == IntSize.Zero) IntSize.Zero else IntSize(
  ((expanded.width - horizontalInset * 2f) / tabsCount.coerceAtLeast(1)).roundToInt().coerceAtLeast(1),
  (expanded.height - verticalInset * 2f).roundToInt().coerceAtLeast(0)
)
