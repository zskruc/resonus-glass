package expo.modules.liquidglass

/** Reusable pixel-space clip state; the UI HostFunction supplies dp distances. */
internal class PlayerSurfaceClipBounds {
  var hasFrame = false; private set
  var left = 0f; private set
  var top = 0f; private set
  var right = 0f; private set
  var bottom = 0f; private set
  var radius = 0f; private set
  var opacity = 0f; private set

  fun update(density: Float, leftDp: Double, topDp: Double, widthDp: Double,
    heightDp: Double, radiusDp: Double, alpha: Double): Int {
    if (!density.isFinite() || density <= 0f || !leftDp.isFinite() || !topDp.isFinite() ||
      !widthDp.isFinite() || !heightDp.isFinite() || !radiusDp.isFinite() || !alpha.isFinite() ||
      widthDp < 0.0 || heightDp < 0.0 || radiusDp < 0.0) return INVALID
    val nextLeft = (leftDp * density).toFloat()
    val nextTop = (topDp * density).toFloat()
    val nextRight = ((leftDp + widthDp) * density).toFloat()
    val nextBottom = ((topDp + heightDp) * density).toFloat()
    val width = (widthDp * density).toFloat()
    val height = (heightDp * density).toFloat()
    val rawRadius = (radiusDp * density).toFloat()
    if (!nextLeft.isFinite() || !nextTop.isFinite() || !nextRight.isFinite() ||
      !nextBottom.isFinite() || !width.isFinite() || !height.isFinite() || !rawRadius.isFinite()) return INVALID
    val nextRadius = rawRadius.coerceIn(0f, minOf(width, height) / 2f)
    val nextOpacity = alpha.coerceIn(0.0, 1.0).toFloat()
    var changes = 0
    if (!hasFrame || left != nextLeft || top != nextTop || right != nextRight ||
      bottom != nextBottom || radius != nextRadius) changes = changes or CLIP
    if (!hasFrame || opacity != nextOpacity) changes = changes or ALPHA
    left = nextLeft; top = nextTop; right = nextRight; bottom = nextBottom
    radius = nextRadius; opacity = nextOpacity; hasFrame = true
    return changes
  }

  fun clear() {
    hasFrame = false
    left = 0f; top = 0f; right = 0f; bottom = 0f; radius = 0f; opacity = 0f
  }

  /** Match the painted rounded outline for admission of a new native gesture. */
  fun contains(x: Float, y: Float): Boolean {
    if (!hasFrame || opacity <= 0f || !x.isFinite() || !y.isFinite() ||
      x < left || x >= right || y < top || y >= bottom) return false
    if (radius <= 0f) return true
    val nearestX = x.coerceIn(left + radius, right - radius)
    val nearestY = y.coerceIn(top + radius, bottom - radius)
    val dx = x - nearestX
    val dy = y - nearestY
    return dx * dx + dy * dy <= radius * radius
  }

  companion object {
    const val INVALID = -1
    const val CLIP = 1
    const val ALPHA = 2
  }
}
