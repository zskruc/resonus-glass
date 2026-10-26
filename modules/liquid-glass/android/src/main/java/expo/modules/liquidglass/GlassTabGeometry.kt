/*
 * Ported from Zennmn/AM-plus-plus (GPL-3.0), commit 36dd119950b001883d3e31e17586f545d404a7c1.
 * Source: https://github.com/Zennmn/AM-plus-plus/tree/36dd119950b001883d3e31e17586f545d404a7c1
 * Package/host integration adapted for Resonus; see THIRD_PARTY_NOTICES.md and LICENSE.
 */
package expo.modules.liquidglass

/** A fixed leading action is outside the selectable/dragging tab region. Coordinates are pixels. */
data class GlassTabGeometry(val panelWidth: Float, val inset: Float, val leadingWidth: Float, val count: Int) {
    val tabWidth: Float get() = if (count > 0) ((panelWidth - 2 * inset - leadingWidth) / count).coerceAtLeast(0f) else 0f
    fun logicalX(x: Float, ltr: Boolean): Float = (if (ltr) x else panelWidth - x) - inset - leadingWidth
    fun indexAt(x: Float, ltr: Boolean): Int? {
        val logical = logicalX(x, ltr)
        return if (tabWidth <= 0f || logical < 0f || logical >= tabWidth * count) null
        else (logical / tabWidth).toInt().coerceIn(0, count - 1)
    }
    fun thumbOffset(index: Float, ltr: Boolean): Float =
        if (ltr) leadingWidth + index * tabWidth else panelWidth - 2 * inset - leadingWidth - (index + 1) * tabWidth
    fun draggedIndex(current: Float, deltaX: Float, ltr: Boolean): Float {
        if (!tabWidth.isFinite() || tabWidth <= 0f || !current.isFinite() || !deltaX.isFinite()) return current
        return (current + deltaX / tabWidth * if (ltr) 1f else -1f).coerceIn(0f, (count - 1).toFloat())
    }
}
