/*
 * Optical geometry follows Kyant0/AndroidLiquidGlass kmp 65ab177e (Apache-2.0)
 * and Zennmn/AM-plus-plus 36dd1199 (GPL-3.0 additions). Original Resonus host,
 * record-capacity and source-ROI adaptation; see ANDROID_LIQUID_GLASS_LICENSE
 * and THIRD_PARTY_NOTICES.md. No animation or material values are changed.
 */
package expo.modules.liquidglass

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.sqrt

/** Live optical extent, independent of the unchanged RN layout and touch rectangle. */
internal data class TabsSelectionBounds(val left: Float, val top: Float, val right: Float, val bottom: Float)
internal class TabsOverlayBounds {
  var left = 0
  var top = 0
  var right = 0
  var bottom = 0
}

internal object TabsSelectionGeometry {
  const val OverlayHostNativeId = "resonus-dock-selection-host"

  /** Source scale springs: X damping ratio .6, Y .7; include their analytic step overshoot. */
  private fun springPeak(target: Float, damping: Float): Float = target + (target - 1f) *
    exp((-PI * damping / sqrt(1f - damping * damping)).toFloat())

  fun maximumScaleX(amPlus: Boolean, count: Int): Float = springPeak(
    if (count <= 1) 1f else if (count == 2) 1.1f else if (amPlus) 1.5f else 78f / 56f, .6f) / .8f

  fun maximumScaleY(amPlus: Boolean): Float = springPeak(if (amPlus) 1.45f else 78f / 56f, .7f) * 1.2f

  /** Static interaction envelope: never resize the capture for each tiny spring/velocity sample. */
  fun interactionBounds(width: Float, height: Float, insetX: Float, insetY: Float, count: Int,
    amPlus: Boolean, panelTravel: Float): TabsSelectionBounds {
    val first = bounds(width, height, insetX, insetY, count, 0f, -panelTravel,
      maximumScaleX(amPlus, count), maximumScaleY(amPlus))
    val last = bounds(width, height, insetX, insetY, count, (count - 1).coerceAtLeast(0).toFloat(), panelTravel,
      maximumScaleX(amPlus, count), maximumScaleY(amPlus))
    return TabsSelectionBounds(first.left, first.top, last.right, last.bottom)
  }

  /** Reserve the unchanged default shadow margins after the same source deformation. */
  fun recordOutset(radius: Float, tabWidth: Float, tabHeight: Float, count: Int, amPlus: Boolean,
    panelTravel: Float): Int {
    val x = maximumScaleX(amPlus, count)
    val y = maximumScaleY(amPlus)
    return ceil(max(tabWidth * (x - 1f) * .5f + radius * 2f * x + panelTravel,
      tabHeight * (y - 1f) * .5f + (radius * 2f + radius / 6f) * y)).toInt()
  }

  /** Bound the padded record in its actual ancestor's coordinates, including RN transforms. */
  fun mapRecordBounds(width: Float, height: Float, offsetX: Float, offsetY: Float, outset: Int,
    matrix: FloatArray, result: TabsOverlayBounds): Boolean {
    var l = Float.POSITIVE_INFINITY
    var t = Float.POSITIVE_INFINITY
    var r = Float.NEGATIVE_INFINITY
    var b = Float.NEGATIVE_INFINITY
    for (corner in 0..3) {
      val x = offsetX + if (corner and 1 == 0) -outset.toFloat() else width + outset
      val y = offsetY + if (corner and 2 == 0) -outset.toFloat() else height + outset
      val w = matrix[6] * x + matrix[7] * y + matrix[8]
      if (w == 0f || !w.isFinite()) return false
      val px = (matrix[0] * x + matrix[1] * y + matrix[2]) / w
      val py = (matrix[3] * x + matrix[4] * y + matrix[5]) / w
      if (!px.isFinite() || !py.isFinite()) return false
      l = minOf(l, px); t = minOf(t, py); r = maxOf(r, px); b = maxOf(b, py)
    }
    result.left = floor(l).toInt(); result.top = floor(t).toInt()
    result.right = ceil(r).toInt(); result.bottom = ceil(b).toInt()
    return true
  }

  fun scaleX(amPlus: Boolean, base: Float, velocity: Float, press: Float): Float =
    if (amPlus) AmPlusSelectionMotion.scaleX(base, velocity, press)
    else base / (1f - (velocity / 10f * .75f).coerceIn(-.2f, .2f))

  fun scaleY(amPlus: Boolean, base: Float, velocity: Float, press: Float): Float =
    if (amPlus) AmPlusSelectionMotion.scaleY(base, velocity, press)
    else base * (1f - (velocity / 10f * .25f).coerceIn(-.2f, .2f))

  fun bounds(width: Float, height: Float, insetX: Float, insetY: Float, count: Int,
    position: Float, panelOffset: Float, scaleX: Float, scaleY: Float): TabsSelectionBounds {
    val tabs = count.coerceAtLeast(1)
    val tabWidth = max(0f, width - insetX * 2f) / tabs
    val tabHeight = max(0f, height - insetY * 2f)
    val centerX = insetX + (position.coerceIn(0f, (tabs - 1).toFloat()) + .5f) * tabWidth + panelOffset
    val centerY = insetY + tabHeight * .5f
    val halfWidth = tabWidth * abs(scaleX) * .5f
    val halfHeight = tabHeight * abs(scaleY) * .5f
    return TabsSelectionBounds(centerX - halfWidth, centerY - halfHeight, centerX + halfWidth, centerY + halfHeight)
  }
}
