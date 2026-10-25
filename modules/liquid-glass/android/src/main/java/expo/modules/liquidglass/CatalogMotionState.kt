package expo.modules.liquidglass

/** Tokens invalidate drag-frame writes queued before release or a replacement interaction. */
internal class CatalogMotionGeneration {
  var current: Int = 0
    private set
  fun advance(): Int { current++; return current }
  fun accepts(token: Int): Boolean = token == current
}

/** Every visible animation term must be at its endpoint before taking the white-thumb path. */
internal fun isCatalogThumbResting(press: Float, scaleX: Float, scaleY: Float,
  velocity: Float, value: Float, target: Float): Boolean =
  press == 0f && scaleX == 1f && scaleY == 1f && velocity == 0f && value.isFinite() && value == target
