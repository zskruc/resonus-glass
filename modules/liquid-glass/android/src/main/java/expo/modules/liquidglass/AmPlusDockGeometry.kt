/*
 * Geometry ported from Zennmn/AM-plus-plus (GPL-3.0), commit
 * 36dd119950b001883d3e31e17586f545d404a7c1:
 * glass/.../GlassBarCollapse.kt and GlassBarCollapseLayout.kt.
 * Resonus adapts it to fixed React Native hosts and physical coordinates.
 * See THIRD_PARTY_NOTICES.md and LICENSE in the repository root.
 */
package expo.modules.liquidglass

import kotlin.math.min

/** Pixel-only geometry; no Android/Compose state and no per-frame RN layout. */
internal object AmPlusDockGeometry {
  const val OvershootLimit = 0.09f

  fun rawProgress(value: Float): Float =
    GlassBarCollapsePolicy.sprungFraction(value)

  private fun semanticProgress(value: Float): Float = rawProgress(value).coerceIn(0f, 1f)

  /** The two side controls share the row's travel, not their individual widths. */
  fun sideWidth(expandedWidth: Float, compactWidth: Float, rowWidth: Float,
    progress: Float, gap: Float, navigation: Boolean = expandedWidth == rowWidth): Float {
    return if (navigation) GlassBarCollapsePolicy.capsuleWidth(expandedWidth, compactWidth, progress,
      AmPlusPhoneDefaults.COLLAPSE_REBOUND, AmPlusPhoneDefaults.EXPAND_REBOUND, gap)
    else GlassBarCollapsePolicy.searchWidth(expandedWidth, compactWidth, rowWidth, progress,
      AmPlusPhoneDefaults.COLLAPSE_REBOUND, AmPlusPhoneDefaults.EXPAND_REBOUND, gap)
  }

  fun height(expandedHeight: Float, compactHeight: Float, progress: Float): Float =
    GlassBarCollapsePolicy.capsuleHeight(expandedHeight, compactHeight, progress)

  fun miniWidth(expandedWidth: Float, compactWidth: Float, progress: Float): Float =
    GlassBarCollapsePolicy.lerp(expandedWidth, compactWidth, rawProgress(progress)).coerceAtLeast(0f)

  fun left(role: String, hostWidth: Float, materialWidth: Float,
    compactOffset: Float, progress: Float): Float = when (role) {
    "search" -> hostWidth - materialWidth // right edge stays anchored through the rebound
    "navigation" -> 0f
    else -> compactOffset * rawProgress(progress)
  }

  /** Same centred-height plus clamped drop as the reference's controls.top. */
  fun top(role: String, hostHeight: Float, expandedHeight: Float, compactHeight: Float,
    materialHeight: Float, progress: Float): Float = if (role == "mini") hostHeight - materialHeight
    else hostHeight - expandedHeight + (expandedHeight - materialHeight) / 2f +
      GlassBarCollapsePolicy.collapseDrop(expandedHeight, compactHeight, progress)

  fun edgeLens(height: Float, width: Float, maxEdge: Float): Float =
    min(maxEdge.coerceAtLeast(0f), min(height, width).coerceAtLeast(0f) * 0.375f)
}
