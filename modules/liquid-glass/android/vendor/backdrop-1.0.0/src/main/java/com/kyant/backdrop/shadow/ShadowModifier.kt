/*
 * Backdrop 1.0.0, Copyright 2025 Kyant, Apache-2.0; see vendor LICENSE.
 * Modified by Resonus: extend the AM++ backing-capacity separation to shadows.
 * Original radius, offset, paint, outline, mask and default allocation are unchanged.
 * These host-capacity additions are distributed under GPLv3; see UPSTREAM.md.
 */
package com.kyant.backdrop.shadow

import android.graphics.BlurMaskFilter
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.CompositingStrategy
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.node.requireGraphicsContext
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntSize
import com.kyant.backdrop.ShapeProvider
import com.kyant.backdrop.backdropShadowSize
import com.kyant.backdrop.backdropShadowRecordSize
import com.kyant.backdrop.withBackdropLogicalSize

internal class ShadowElement(
    val shapeProvider: ShapeProvider,
    val shadow: () -> Shadow?,
    val minLayerSize: IntSize = IntSize.Zero
) : ModifierNodeElement<ShadowNode>() {

    override fun create(): ShadowNode {
        return ShadowNode(shapeProvider, shadow, minLayerSize)
    }

    override fun update(node: ShadowNode) {
        node.shapeProvider = shapeProvider
        node.shadow = shadow
        node.minLayerSize = minLayerSize
        node.invalidateDraw()
    }

    override fun InspectorInfo.inspectableProperties() {
        name = "shadow"
        properties["shapeProvider"] = shapeProvider
        properties["shadow"] = shadow
        properties["minLayerSize"] = minLayerSize
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ShadowElement) return false

        if (shapeProvider != other.shapeProvider) return false
        if (shadow != other.shadow) return false
        if (minLayerSize != other.minLayerSize) return false

        return true
    }

    override fun hashCode(): Int {
        var result = shapeProvider.hashCode()
        result = 31 * result + shadow.hashCode()
        result = 31 * result + minLayerSize.hashCode()
        return result
    }
}

internal class ShadowNode(
    var shapeProvider: ShapeProvider,
    var shadow: () -> Shadow?,
    var minLayerSize: IntSize = IntSize.Zero
) : DrawModifierNode, Modifier.Node() {

    override val shouldAutoInvalidate: Boolean = false

    private var shadowLayer: GraphicsLayer? = null

    private val paint = Paint()

    override fun ContentDrawScope.draw() {
        val shadow = shadow() ?: return drawContent()

        val shadowLayer = shadowLayer
        if (shadowLayer != null) {
            val size = size
            val density: Density = this
            val layoutDirection = layoutDirection

            val radius = shadow.radius.toPx()
            val offsetX = shadow.offset.x.toPx()
            val offsetY = shadow.offset.y.toPx()
            val shadowSize = backdropShadowSize(size, radius, offsetX, offsetY)
            val recordSize = backdropShadowRecordSize(size, radius, offsetX, offsetY, minLayerSize)
            val outline = shapeProvider.shape.createOutline(size, layoutDirection, density)

            configurePaint(shadow)

            shadowLayer.alpha = shadow.alpha
            shadowLayer.blendMode = shadow.blendMode
            shadowLayer.record(recordSize) {
                if (minLayerSize != IntSize.Zero) {
                    withBackdropLogicalSize(shadowSize) {
                        // The extra physical capacity remains transparent. Keep the
                        // same asymmetric extent as the original exact-sized layer.
                        clipRect(0f, 0f, shadowSize.width.toFloat(), shadowSize.height.toFloat()) {
                            drawShadow(outline, radius, offsetX, offsetY)
                        }
                    }
                } else drawShadow(outline, radius, offsetX, offsetY)
            }

            translate(-radius * 2f, -radius * 2f) {
                drawLayer(shadowLayer)
            }
        }

        drawContent()
    }

    private fun DrawScope.drawShadow(outline: Outline, radius: Float, offsetX: Float, offsetY: Float) {
        translate(radius * 2f + offsetX, radius * 2f + offsetY) {
            val canvas = drawContext.canvas
            canvas.drawOutline(outline, paint)
            canvas.translate(-offsetX, -offsetY)
            canvas.drawOutline(outline, ShadowMaskPaint)
            canvas.translate(offsetX, offsetY)
        }
    }

    override fun onAttach() {
        val graphicsContext = requireGraphicsContext()
        shadowLayer =
            graphicsContext.createGraphicsLayer().apply {
                compositingStrategy = CompositingStrategy.Offscreen
            }
    }

    override fun onDetach() {
        val graphicsContext = requireGraphicsContext()
        shadowLayer?.let { layer ->
            graphicsContext.releaseGraphicsLayer(layer)
            shadowLayer = null
        }
    }

    private fun DrawScope.configurePaint(shadow: Shadow) {
        paint.color = shadow.color
        val blurRadius = shadow.radius.toPx()
        paint.asFrameworkPaint().maskFilter =
            if (blurRadius > 0f) {
                BlurMaskFilter(blurRadius, BlurMaskFilter.Blur.NORMAL)
            } else {
                null
            }
    }
}

private val ShadowMaskPaint = Paint().apply {
    blendMode = BlendMode.Clear
}
