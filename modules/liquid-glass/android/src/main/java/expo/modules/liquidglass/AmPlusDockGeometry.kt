/*
 * Geometry adapted from Kifranei/AM-plus-plus (GPL-3.0), commit
 * 97fa2e4efc9ec7476daca383221f55b5d10f847c:
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
    if (value.isFinite()) value.coerceIn(-OvershootLimit, 1f + OvershootLimit) else 0f

  private fun semanticProgress(value: Float): Float = rawProgress(value).coerceIn(0f, 1f)

  /** The two side controls share the row's travel, not their individual widths. */
  fun sideWidth(expandedWidth: Float, compactWidth: Float, rowWidth: Float,
    progress: Float, gap: Float): Float {
    val raw = rawProgress(progress)
    val semantic = semanticProgress(raw)
    val resting = expandedWidth + (compactWidth - expandedWidth) * semantic
    val excess = raw - semantic
    val rebound = (compactWidth - rowWidth) * excess * if (excess > 0f) 0.35f else 1f
    return (resting + if (rebound > 0f) min(rebound, gap.coerceAtLeast(0f)) else rebound).coerceAtLeast(0f)
  }

  fun height(expandedHeight: Float, compactHeight: Float, progress: Float): Float =
    (expandedHeight + (compactHeight - expandedHeight) * rawProgress(progress)).coerceAtLeast(0f)

  fun miniWidth(expandedWidth: Float, compactWidth: Float, progress: Float): Float =
    (expandedWidth + (compactWidth - expandedWidth) * rawProgress(progress)).coerceAtLeast(0f)

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
      ((expandedHeight - compactHeight) / 2f).coerceAtLeast(0f) * semanticProgress(progress)

  fun edgeLens(height: Float, width: Float, maxEdge: Float): Float =
    min(maxEdge.coerceAtLeast(0f), min(height, width).coerceAtLeast(0f) * 0.375f)
}
