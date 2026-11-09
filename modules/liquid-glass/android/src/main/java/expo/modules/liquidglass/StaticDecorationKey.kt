package expo.modules.liquidglass

import kotlin.math.ceil

/** Every input to the static recipe; float bit patterns are deliberately not rounded. */
internal data class StaticDecorationStyle(
  val sourceArgb: Int, val preset: String, val tuningMask: Int, val dark: Boolean,
  val densityBits: Int, val fontScaleBits: Int, val rtl: Boolean, val api: Int,
  val topLeftBits: Int, val topRightBits: Int, val bottomLeftBits: Int, val bottomRightBits: Int,
  val blurBits: Int, val refractionBits: Int, val refractionHeightBits: Int,
  val highlightWidthBits: Int, val highlightOpacityBits: Int,
  val tintArgb: Int, val tintOpacityBits: Int, val depth: Boolean, val dispersion: Boolean
)

internal data class StaticDecorationKey(
  val width: Int, val height: Int, val style: StaticDecorationStyle, val recipeRevision: Int = 1
)

internal data class StaticRasterEnvelope(val left: Int, val top: Int, val width: Int, val height: Int)
internal data class StaticDecorationGeometry(val body: StaticRasterEnvelope, val highlight: StaticRasterEnvelope) {
  /** Reserve aligned rows/pages before starting capture, rather than only after allocation. */
  val reservationBytes: Long get() = listOf(body, highlight).sumOf {
    val row = ((it.width.toLong() * 4L + 255L) / 256L) * 256L
    row * ((it.height.toLong() + 3L) / 4L * 4L) + 4096L
  }
}

internal fun staticDecorationGeometry(key: StaticDecorationKey): StaticDecorationGeometry? {
  if (key.width !in 1..8192 || key.height !in 1..8192) return null
  val density = Float.fromBits(key.style.densityBits)
  if (!density.isFinite() || density <= 0f || density > 16f) return null
  val shadow = key.style.preset != "custom"
  // Shadow.Default keeps its original 24dp radius and (0,4dp) offset.
  // Integer capture margins enclose its original fractional translation too.
  val horizontal = if (shadow) ceil(48f * density).toInt().coerceAtLeast(1) else 1
  val top = horizontal
  val bottom = if (shadow) ceil(52f * density).toInt().coerceAtLeast(1) else 1
  return StaticDecorationGeometry(
    StaticRasterEnvelope(horizontal, top, key.width + horizontal * 2, key.height + top + bottom),
    // HighlightNode's original one-pixel guard and (-1,-1) translation.
    StaticRasterEnvelope(1, 1, key.width + 2, key.height + 2)
  )
}
