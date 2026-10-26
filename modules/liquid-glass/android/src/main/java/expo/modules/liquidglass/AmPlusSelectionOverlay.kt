/*
 * Zennmn AM++ source ordering adaptation (GPL-3.0), commit
 * 36dd119950b001883d3e31e17586f545d404a7c1: the selected droplet is after the
 * visible row. RN owns that row here, so its optical layer uses ViewOverlay.
 */
package expo.modules.liquidglass

import android.graphics.Canvas as AndroidCanvas
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.draw
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection

/** Draw-only overlay: no React hierarchy mutation, gesture node or accessibility target. */
internal class AmPlusSelectionOverlay(private val owner: LiquidGlassView) : ViewTreeObserver.OnPreDrawListener {
  private var layer: GraphicsLayer? = null
  private var density: Density = Density(1f)
  private var direction = LayoutDirection.Ltr
  private var size = Size.Zero
  private var parent: ViewGroup? = null
  private var observer: ViewTreeObserver? = null
  private var attachmentGeneration = 0
  private var attachmentPosted = false
  private val matrix = FloatArray(9)
  private val previousMatrix = FloatArray(9) { Float.NaN }
  private var previousOpacity = Float.NaN
  private var previousOffsetX = Int.MIN_VALUE
  private var previousOffsetY = Int.MIN_VALUE
  private val drawScope = CanvasDrawScope()
  private val view = object : View(owner.context) {
    init {
      importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
      isClickable = false
      isFocusable = false
      setWillNotDraw(false)
    }

    override fun onDraw(canvas: AndroidCanvas) {
      // Like the material view, this consumer must not enter the page's own
      // source capture. ViewOverlay is outside that view's dispatchDraw gate.
      if (WindowBackdrops.isCapturing || !canvas.isHardwareAccelerated) return
      val selected = layer ?: return
      if (!visible()) return
      val checkpoint = canvas.save()
      try {
        canvas.concat(owner.matrix)
        canvas.translate(owner.opticalMaterialOffsetX.toFloat(), owner.opticalMaterialOffsetY.toFloat())
        drawScope.draw(density, direction, Canvas(canvas), size) { drawLayer(selected) }
      } finally { canvas.restoreToCount(checkpoint) }
    }
  }

  private fun visible() = layer != null && owner.materialPreset == "amPlus" && owner.glassEnabled &&
    owner.isAttachedToWindow && owner.isShown && owner.windowVisibility == View.VISIBLE && owner.tabSelectionOpacity > .001f

  /** Called after normal attachment/layout, never by mutating an RN child list. */
  fun attach() {
    if (!owner.isAttachedToWindow || owner.materialPreset != "amPlus" || owner.tabsCount <= 0) return
    val nextParent = owner.parent as? ViewGroup ?: return
    if (nextParent !== parent) {
      parent?.overlay?.remove(view)
      parent = nextParent
      nextParent.overlay.add(view)
    }
    if (observer == null) observer = owner.viewTreeObserver.also { it.addOnPreDrawListener(this) }
    onPreDraw()
  }

  override fun onPreDraw(): Boolean {
    val visibility = if (visible()) View.VISIBLE else View.INVISIBLE
    if (view.visibility != visibility) view.visibility = visibility
    if (view.alpha != owner.alpha) view.alpha = owner.alpha
    layout()
    owner.matrix.getValues(matrix)
    var changed = previousOpacity != owner.tabSelectionOpacity || previousOffsetX != owner.opticalMaterialOffsetX ||
      previousOffsetY != owner.opticalMaterialOffsetY
    for (index in matrix.indices) if (matrix[index] != previousMatrix[index]) changed = true
    if (changed) {
      matrix.copyInto(previousMatrix)
      previousOpacity = owner.tabSelectionOpacity
      previousOffsetX = owner.opticalMaterialOffsetX
      previousOffsetY = owner.opticalMaterialOffsetY
      view.invalidate()
    }
    return true
  }

  fun update(selected: GraphicsLayer, sourceDensity: Density, sourceDirection: LayoutDirection, sourceSize: Size) {
    layer = selected
    density = sourceDensity
    direction = sourceDirection
    size = sourceSize
    if (parent == null && !attachmentPosted) {
      // First interaction after a live style change may occur during draw.
      // Keep overlay hierarchy changes outside that traversal.
      attachmentPosted = true
      val ticket = attachmentGeneration
      owner.post {
        if (ticket == attachmentGeneration) {
          attachmentPosted = false
          attach()
          view.invalidate()
        }
      }
    }
    layout()
    view.invalidate()
  }

  fun layout() {
    if (view.left != owner.left || view.top != owner.top || view.right != owner.right || view.bottom != owner.bottom)
      view.layout(owner.left, owner.top, owner.right, owner.bottom)
  }

  fun clear(selected: GraphicsLayer? = null) {
    if (selected != null && layer !== selected) return
    layer = null
    view.visibility = View.INVISIBLE
    view.invalidate()
  }

  fun detach() {
    clear()
    attachmentGeneration++
    attachmentPosted = false
    observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
    observer = null
    parent?.overlay?.remove(view)
    parent = null
  }
}
