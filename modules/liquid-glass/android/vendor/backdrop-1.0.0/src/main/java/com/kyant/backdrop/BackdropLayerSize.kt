/*
 * Record capacity/geometry separation adapted from Zennmn/AM-plus-plus
 * 36dd119950b001883d3e31e17586f545d404a7c1 (GPL-3.0 additions).
 * Original Backdrop 1.0.0 remains Apache-2.0; see UPSTREAM.md and LICENSE.
 */
package com.kyant.backdrop

import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.toSize
import kotlin.math.ceil

/** Keep 1.0.0's exact truncation: changing the padding rounding changes sampling. */
internal fun backdropLogicalRecordSize(size: Size, padding: Float): IntSize = IntSize(
    size.width.toInt() + padding.toInt() * 2,
    size.height.toInt() + padding.toInt() * 2
)

/** Physical capacity only; the effect scope and callback retain their logical size. */
internal fun backdropRecordSize(size: Size, padding: Float, minimum: IntSize): IntSize {
    val logical = backdropLogicalRecordSize(size, padding)
    return IntSize(maxOf(logical.width, minimum.width), maxOf(logical.height, minimum.height))
}

/** The original shadow extent, including its asymmetric offset and ceil rounding. */
internal fun backdropShadowSize(size: Size, radius: Float, offsetX: Float, offsetY: Float): IntSize = IntSize(
    ceil(size.width + radius * 4f + offsetX).toInt(),
    ceil(size.height + radius * 4f + offsetY).toInt()
)

/** Capacity is a content envelope; the unchanged shadow needs its normal outer margins too. */
internal fun backdropShadowRecordSize(size: Size, radius: Float, offsetX: Float, offsetY: Float,
    minimum: IntSize): IntSize {
    val logical = backdropShadowSize(size, radius, offsetX, offsetY)
    if (minimum == IntSize.Zero) return logical
    val reserved = backdropShadowSize(minimum.toSize(), radius, offsetX, offsetY)
    return IntSize(maxOf(logical.width, reserved.width), maxOf(logical.height, reserved.height))
}

/** Highlight keeps its original one-pixel guard on each edge. */
internal fun backdropHighlightSize(size: Size): IntSize = IntSize(
    ceil(size.width).toInt() + 2,
    ceil(size.height).toInt() + 2
)

internal fun backdropHighlightRecordSize(size: Size, minimum: IntSize): IntSize {
    val logical = backdropHighlightSize(size)
    if (minimum == IntSize.Zero) return logical
    return IntSize(maxOf(logical.width, minimum.width + 2), maxOf(logical.height, minimum.height + 2))
}

/** A retained physical layer must never become the coordinate system of its drawing commands. */
internal inline fun DrawScope.withBackdropLogicalSize(logical: IntSize, block: DrawScope.() -> Unit) {
    val backingSize = drawContext.size
    drawContext.size = logical.toSize()
    try {
        block()
    } finally {
        drawContext.size = backingSize
    }
}
