/*
 * Zennmn AM++ source ordering adaptation (GPL-3.0), commit
 * 36dd119950b001883d3e31e17586f545d404a7c1: the selected droplet is after the
 * visible row. RN owns that row here, so its optical layer uses ViewOverlay.
 */
package expo.modules.liquidglass

import android.graphics.Canvas as AndroidCanvas
import android.graphics.Matrix
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
  private var recordOutset = 0
  private var parent: ViewGroup? = null
  private var observer: ViewTreeObserver? = null
  private var attachmentGeneration = 0
  private var attachmentPosted = false
  private var captureSuppressed = false
  private val matrix = FloatArray(9)
  private val ownerGlobalMatrix = Matrix()
  private val hostGlobalMatrix = Matrix()
  private val hostInverseMatrix = Matrix()
  private val ownerToHostMatrix = Matrix()
  private val mappedBounds = TabsOverlayBounds()
  private val previousMatrix = FloatArray(9) { Float.NaN }
  private var previousOpacity = Float.NaN
  private var previousOffsetX = Int.MIN_VALUE
  private var previousOffsetY = Int.MIN_VALUE
  private var view: View? = null

  private fun createView(): View {
    val drawScope = CanvasDrawScope()
    return object : View(owner.context) {
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
          if (!updateTransform()) return
          canvas.translate(-left.toFloat(), -top.toFloat())
          canvas.concat(ownerToHostMatrix)
          canvas.translate(owner.opticalMaterialOffsetX.toFloat() - recordOutset,
            owner.opticalMaterialOffsetY.toFloat() - recordOutset)
          drawScope.draw(density, direction, Canvas(canvas), size) { drawLayer(selected) }
        } finally { canvas.restoreToCount(checkpoint) }
      }
    }
  }

  private fun eligible() = owner.materialPreset == "amPlus" && owner.glassEnabled &&
    !captureSuppressed && owner.isAttachedToWindow && owner.isShown && owner.windowVisibility == View.VISIBLE &&
    owner.hasWindowFocus() && owner.hasVisibleOpticalAncestors() && owner.tabSelectionOpacity > .001f &&
    AmPlusSelectionMotion.isInteracting(owner.tabPressProgress, owner.tabScaleX, owner.tabScaleY,
      owner.tabVelocity, owner.tabPanelOffset)

  private fun visible() = layer != null && eligible()

  /** Called after normal attachment/layout, never by mutating an RN child list. */
  fun attach() {
    // There is no source lens at rest. Do not retain an overlay/listener for
    // the entire lifetime of this global bar, including hidden player routes.
    if (layer == null || !eligible() || owner.tabsCount <= 0) return
    val nextParent = findOverlayHost() ?: return
    val overlayView = view ?: createView().also { view = it }
    if (nextParent !== parent) {
      parent?.overlay?.remove(overlayView)
      parent = nextParent
      nextParent.overlay.add(overlayView)
    }
    if (observer == null) observer = owner.viewTreeObserver.also { it.addOnPreDrawListener(this) }
    onPreDraw()
  }

  override fun onPreDraw(): Boolean {
    if (WindowBackdrops.isCapturing) return true
    if (layer != null && !visible()) {
      clear()
      return true
    }
    val view = view ?: return true
    val visibility = if (visible()) View.VISIBLE else View.INVISIBLE
    if (view.visibility != visibility) view.visibility = visibility
    val alpha = relativeAlpha()
    if (view.alpha != alpha) view.alpha = alpha
    layout()
    ownerToHostMatrix.getValues(matrix)
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

  fun update(selected: GraphicsLayer, sourceDensity: Density, sourceDirection: LayoutDirection, sourceSize: Size,
    outset: Int) {
    if (WindowBackdrops.isCapturing || !owner.isAttachedToWindow) return
    // A stale Compose draw can outlive focus/visibility or the gesture by one
    // traversal. It must not recreate the overlay that preDraw just released.
    if (!eligible()) {
      clear()
      return
    }
    layer = selected
    density = sourceDensity
    direction = sourceDirection
    size = sourceSize
    recordOutset = outset
    if (parent == null && !attachmentPosted) {
      // First interaction after a live style change may occur during draw.
      // Keep overlay hierarchy changes outside that traversal.
      attachmentPosted = true
      val ticket = attachmentGeneration
      owner.post {
        if (ticket == attachmentGeneration) {
          attachmentPosted = false
          attach()
          view?.invalidate()
        }
      }
    }
    layout()
    view?.invalidate()
  }

  fun layout() {
    val view = view ?: return
    if (!updateTransform()) return
    ownerToHostMatrix.getValues(matrix)
    if (!TabsSelectionGeometry.mapRecordBounds(size.width, size.height, owner.opticalMaterialOffsetX.toFloat(),
        owner.opticalMaterialOffsetY.toFloat(), recordOutset, matrix, mappedBounds)) return
    val left = mappedBounds.left
    val top = mappedBounds.top
    val right = mappedBounds.right
    val bottom = mappedBounds.bottom
    if (view.left != left || view.top != top || view.right != right || view.bottom != bottom)
      view.layout(left, top, right, bottom)
  }

  fun recordOutset(): Int = owner.selectionRecordOutset()

  private fun findOverlayHost(): ViewGroup? {
    var ancestor = owner.parent as? ViewGroup
    while (ancestor != null) {
      if (ancestor.getTag(com.facebook.react.R.id.view_tag_native_id) == TabsSelectionGeometry.OverlayHostNativeId)
        return ancestor
      ancestor = ancestor.parent as? ViewGroup
    }
    // Embedded/non-global hosts retain their existing local ordering.
    return owner.parent as? ViewGroup
  }

  private fun updateTransform(): Boolean {
    val host = parent ?: return false
    ownerGlobalMatrix.reset()
    hostGlobalMatrix.reset()
    owner.transformMatrixToGlobal(ownerGlobalMatrix)
    host.transformMatrixToGlobal(hostGlobalMatrix)
    if (!hostGlobalMatrix.invert(hostInverseMatrix)) return false
    ownerToHostMatrix.setConcat(hostInverseMatrix, ownerGlobalMatrix)
    return true
  }

  /** The higher host must still respect opacity on every skipped bar ancestor. */
  private fun relativeAlpha(): Float {
    var alpha = 1f
    var ancestor: View? = owner
    while (ancestor != null && ancestor !== parent) {
      alpha *= ancestor.alpha
      ancestor = ancestor.parent as? View
    }
    return alpha
  }

  fun clear(selected: GraphicsLayer? = null) {
    if (selected != null && layer !== selected) return
    if (layer == null && parent == null && !attachmentPosted) return
    layer = null
    val oldView = view
    view = null
    oldView?.visibility = View.INVISIBLE
    attachmentGeneration++
    attachmentPosted = false
    observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
    observer = null
    // Also release the View itself: its cached Android display list can retain
    // the selected GraphicsLayer even after removal from ViewGroupOverlay.
    if (oldView != null) parent?.overlay?.remove(oldView)
    parent = null
  }

  /**
   * onDraw's isCapturing guard cannot invalidate an already cached RenderNode.
   * Hide the actual overlay before recording the root, then restore it before
   * the real window draws. Its selected layer can never become its own source.
   */
  fun suppressForCapture() {
    captureSuppressed = true
    val view = view ?: return
    if (view.visibility != View.INVISIBLE) view.visibility = View.INVISIBLE
  }

  fun restoreAfterCapture() {
    captureSuppressed = false
    if (visible()) view?.visibility = View.VISIBLE
  }

  fun detach() = clear()
}
