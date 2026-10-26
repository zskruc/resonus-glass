/*
 * Native source-row adaptation of Zennmn/AM-plus-plus (GPL-3.0), commit
 * 36dd119950b001883d3e31e17586f545d404a7c1: LiquidBottomTabs' accent-colored
 * refractionContent row and ViewBackdrop's hardware RenderNode bridge.
 * Resonus records only sibling RN foreground, never a backdrop consumer.
 * Original Backdrop sources retain their Apache-2.0 notices.
 */
package expo.modules.liquidglass

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.RenderNode
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.TextView
import androidx.annotation.RequiresApi
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlin.math.roundToInt

/**
 * The selected lens needs its own row, including real RN glyphs and labels.
 * This small hardware recording is separate from the shared page capture and
 * exists only while the selected lens is interacting. It creates no Bitmap or
 * readback. A hidden compact row must never keep an idle redraw loop alive.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class AmPlusTabForeground(private val owner: LiquidGlassView) : ViewTreeObserver.OnPreDrawListener {
  private var node: RenderNode? = null
  private val tintPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private var accent = 0
  private var observer: ViewTreeObserver? = null
  private var ready = false
  private var recording = false
  private var failed = false
  private val epoch = AmPlusForegroundEpoch()
  private var sourceDirty = false
  private val matrixValues = FloatArray(9)
  var version by mutableIntStateOf(0)
    private set

  fun attach() {
    if (observer != null || failed) return
    observer = owner.viewTreeObserver.also { it.addOnPreDrawListener(this) }
  }

  fun detach() {
    observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
    observer = null
    node?.discardDisplayList()
    node = null
    ready = false
    epoch.invalidate()
  }

  private fun active() = owner.materialPreset == "amPlus" && owner.glassEnabled && owner.tabsCount > 0 &&
    owner.tabSelectionOpacity > .001f && owner.isAttachedToWindow && owner.isShown &&
    owner.windowVisibility == View.VISIBLE && owner.hasWindowFocus() && owner.hasVisibleOpticalAncestors() &&
    AmPlusSelectionMotion.isInteracting(owner.tabPressProgress, owner.tabScaleX, owner.tabScaleY,
      owner.tabVelocity, owner.tabPanelOffset)

  private fun containsConsumer(view: View): Boolean {
    if (view is LiquidGlassView) return true
    if (view is ViewGroup) for (index in 0 until view.childCount) {
      if (containsConsumer(view.getChildAt(index))) return true
    }
    return false
  }

  private fun fingerprint(view: View, previous: Long): Long {
    var hash = previous * 31 + System.identityHashCode(view)
    hash = hash * 31 + view.left
    hash = hash * 31 + view.top
    hash = hash * 31 + view.width
    hash = hash * 31 + view.height
    hash = hash * 31 + view.visibility
    hash = hash * 31 + view.alpha.toBits()
    // Android does not draw/clean alpha-zero descendants. Inspecting their
    // dirty flags can re-record forever, because our own recording invalidates
    // this traversal's owner again. The hidden row contributes only its bounds.
    if (view.visibility != View.VISIBLE || view.alpha <= .001f || view.width <= 0 || view.height <= 0) return hash
    view.matrix.getValues(matrixValues)
    for (value in matrixValues) hash = hash * 31 + value.toBits()
    if (view is TextView) {
      hash = hash * 31 + view.text.hashCode()
      hash = hash * 31 + view.textSize.toBits()
      hash = hash * 31 + view.currentTextColor
      hash = hash * 31 + (view.typeface?.hashCode() ?: 0)
    }
    if (view is ViewGroup && view.childCount > 0) {
      for (index in 0 until view.childCount) hash = fingerprint(view.getChildAt(index), hash)
    } else {
      // A dirty parent includes invalidations propagated from our own optical
      // layers. Only a visible drawing leaf is an actual content invalidation.
      sourceDirty = sourceDirty || view.isDirty
    }
    return hash
  }

  override fun onPreDraw(): Boolean {
    if (failed || recording || WindowBackdrops.isCapturing) return true
    if (!active() || owner.width <= 0 || owner.height <= 0) {
      epoch.needsRecord(false, 0, false)
      if (ready) {
        node?.discardDisplayList()
        node = null
        ready = false
      }
      return true
    }
    val parent = owner.parent as? ViewGroup ?: return true
    if (!owner.isHardwareAccelerated) return true
    sourceDirty = false
    var nextFingerprint = 17L
    for (index in 0 until parent.childCount) {
      val child = parent.getChildAt(index)
      if (child !== owner && !containsConsumer(child)) nextFingerprint = fingerprint(child, nextFingerprint)
    }
    if (!epoch.needsRecord(true, nextFingerprint, sourceDirty)) return true
    recording = true
    try {
      val node = node ?: RenderNode("Resonus AM++ refraction foreground").also { this.node = it }
      node.setPosition(0, 0, owner.width, owner.height)
      val canvas = node.beginRecording()
      try {
        // A sibling row includes the live RN font/ellipsis/icon layout. Drawing
        // only consumer-free siblings prevents recursive/self backdrop sampling.
        for (index in 0 until parent.childCount) {
          val child = parent.getChildAt(index)
          if (child === owner || child.visibility != View.VISIBLE || child.alpha <= 0f || containsConsumer(child)) continue
          val checkpoint = canvas.save()
          try {
            canvas.translate((child.left - owner.left).toFloat(), (child.top - owner.top).toFloat())
            canvas.concat(child.matrix)
            if (child.alpha < 1f) canvas.saveLayerAlpha(0f, 0f, child.width.toFloat(), child.height.toFloat(),
              (child.alpha * 255f).roundToInt().coerceIn(0, 255))
            child.draw(canvas)
          } finally { canvas.restoreToCount(checkpoint) }
        }
      } finally { node.endRecording() }
      ready = true
      version++
      owner.invalidateBackdropDrawing()
    } catch (error: Throwable) {
      // The page material remains usable if a vendor forbids hardware View recording.
      failed = true
      ready = false
      node?.discardDisplayList()
      node = null
      Log.w("ResonusTabForeground", "Refraction foreground disabled: ${error.javaClass.simpleName}")
    } finally { recording = false }
    return true
  }

  fun draw(canvas: Canvas, offsetX: Float, offsetY: Float, color: Int) {
    if (!ready || failed || WindowBackdrops.isCapturing || !canvas.isHardwareAccelerated) return
    val node = node ?: return
    if (accent != color) {
      accent = color
      tintPaint.colorFilter = PorterDuffColorFilter(color, PorterDuff.Mode.SRC_IN)
    }
    val checkpoint = canvas.save()
    try {
      canvas.translate(-offsetX, -offsetY)
      canvas.saveLayer(0f, 0f, node.width.toFloat(), node.height.toFloat(), tintPaint)
      canvas.drawRenderNode(node)
    } finally { canvas.restoreToCount(checkpoint) }
  }
}
