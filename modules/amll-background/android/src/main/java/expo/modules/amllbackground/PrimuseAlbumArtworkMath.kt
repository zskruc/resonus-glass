package expo.modules.amllbackground

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Primuse's ArtworkAccentPixelPolicy + ThemeService.makeColorResult primary.
 * Adapted from chenqi92/primuse (MIT, copyright 2026 Welape); see licenses/PRIMUSE-MIT.txt.
 * Sampling/decoding remains a platform boundary; bucket selection and shaping follow its rules.
 */
internal object PrimuseAlbumArtworkMath {
  const val TEXTURE_SIDE = 256
  const val SAMPLE_SIDE = 40
  private const val BUCKET_COUNT = 24
  private data class Pixel(val hue: Double, val saturation: Double, val brightness: Double)
  private data class Bucket(val hue: Double, val saturation: Double, val brightness: Double, val score: Double)
  data class TextureGeometry(val side: Int, val padding: Int, val scale: Double)

  fun normalizedBlurRatio(value: Double): Double? =
    if (value.isFinite() && value in 0.0..0.25) (value * 10000).roundToInt() / 10000.0 else null

  fun textureGeometry(coreSide: Int, sigma: Double): TextureGeometry {
    require(coreSide in 1..TEXTURE_SIDE && sigma.isFinite() && sigma in 0.0..coreSide * 0.25)
    val padding = ceil(sigma * 3).toInt() + 2
    val side = coreSide + padding * 2
    return TextureGeometry(side, padding, side.toDouble() / coreSide)
  }

  /** Transparent canvas outside the core preserves blur's visible halo before the page fade ends. */
  fun paddedTexture(pixels: IntArray, coreSide: Int, sigma: Double): IntArray {
    require(pixels.size == coreSide * coreSide)
    val geometry = textureGeometry(coreSide, sigma)
    val padded = IntArray(geometry.side * geometry.side)
    for (y in 0 until coreSide) {
      pixels.copyInto(padded, (y + geometry.padding) * geometry.side + geometry.padding,
        y * coreSide, (y + 1) * coreSide)
    }
    return texture(padded, geometry.side, geometry.side, sigma)
  }

  /** Input is the full, oriented photograph resized to40×40, not a lower-edge crop. */
  fun primary(pixels: IntArray): Int? {
    if (pixels.isEmpty()) return null
    val vivid = Array(BUCKET_COUNT) { ArrayList<Pixel>() }
    val pastel = Array(BUCKET_COUNT) { ArrayList<Pixel>() }
    for (argb in pixels) {
      // Primuse samples an opaque CGContext: transparency contributes black,
      // rather than introducing the hidden RGB of an invisible PNG pixel.
      val alpha = (argb ushr 24) / 255.0
      val pixel = hsv(((argb ushr 16) and 255) / 255.0 * alpha,
        ((argb ushr 8) and 255) / 255.0 * alpha, (argb and 255) / 255.0 * alpha)
      if (pixel.brightness <= 0.10) continue
      val index = floor(pixel.hue * BUCKET_COUNT + 0.5).toInt() % BUCKET_COUNT
      if (pixel.saturation >= 0.24) vivid[index].add(pixel)
      else if (pixel.saturation >= 0.07 && pixel.brightness >= 0.60) pastel[index].add(pixel)
    }
    fun summarize(groups: Array<ArrayList<Pixel>>, accepts: (List<Pixel>) -> Boolean): List<Bucket> =
      groups.mapNotNull { group ->
        if (group.isEmpty() || !accepts(group)) return@mapNotNull null
        var x = 0.0; var y = 0.0; var s = 0.0; var b = 0.0; var total = 0.0
        for (pixel in group) {
          val weight = pixel.saturation * pixel.saturation * (0.55 + 0.45 * pixel.brightness)
          val angle = pixel.hue * PI * 2
          x += cos(angle) * weight; y += sin(angle) * weight
          s += pixel.saturation * weight; b += pixel.brightness * weight; total += weight
        }
        if (total <= 0) return@mapNotNull null
        var hue = atan2(y, x) / (PI * 2)
        if (hue < 0) hue += 1
        Bucket(hue, s / total, b / total, total)
      }
    val regular = summarize(vivid) { it.size >= max(8, pixels.size / 200) }
    val candidates = if (regular.isNotEmpty()) regular else {
      val marks = summarize(vivid) { group ->
        group.size >= 4 && group.sumOf { it.saturation } / group.size >= 0.45 &&
          group.sumOf { it.brightness } / group.size >= 0.40
      }
      if (marks.isNotEmpty()) marks else summarize(pastel) { it.size >= pixels.size * 0.20 }
    }
    val dominant = candidates.maxByOrNull { it.score } ?: return null
    return rgb(dominant.hue, (dominant.saturation * 1.08).coerceIn(0.35, 0.92),
      dominant.brightness.coerceIn(0.50, 0.85))
  }

  /** Bake blur first, then saturation1.25 and RGB×0.5, in the source modifier order. */
  fun texture(pixels: IntArray, width: Int, height: Int, sigma: Double): IntArray {
    require(width > 0 && height > 0 && pixels.size == width * height)
    require(sigma.isFinite() && sigma >= 0 && sigma <= max(width, height) * 0.25)
    val premultiplied = IntArray(pixels.size) { index ->
      val color = pixels[index]; val a = color ushr 24
      fun c(shift: Int) = ((((color ushr shift) and 255) * a + 127) / 255)
      (a shl 24) or (c(16) shl 16) or (c(8) shl 8) or c(0)
    }
    // Existing independent, clamped separable Gaussian helper; no artist
    // geometry, crop, palette, prepared fields or animation behavior is reused.
    val blurred = ArtistArtworkMath.gaussianApproximation(premultiplied, width, height, sigma)
    return IntArray(pixels.size) { index ->
      val color = blurred[index]; val a = color ushr 24
      if (a == 0) return@IntArray 0
      fun straight(shift: Int) = min(255.0, ((color ushr shift) and 255) * 255.0 / a)
      val r = straight(16); val g = straight(8); val b = straight(0)
      val luma = r * 0.2126 + g * 0.7152 + b * 0.0722
      fun shaped(channel: Double) = ((luma + 1.25 * (channel - luma)) * 0.5).roundToInt().coerceIn(0, 255)
      (a shl 24) or (shaped(r) shl 16) or (shaped(g) shl 8) or shaped(b)
    }
  }

  private fun hsv(r: Double, g: Double, b: Double): Pixel {
    val hi = max(r, max(g, b)); val lo = min(r, min(g, b)); val difference = hi - lo
    if (difference == 0.0) return Pixel(0.0, 0.0, hi)
    var hue = when (hi) { r -> (g - b) / difference; g -> 2 + (b - r) / difference; else -> 4 + (r - g) / difference } / 6
    if (hue < 0) hue += 1
    return Pixel(hue, difference / hi, hi)
  }

  private fun rgb(hue: Double, s: Double, v: Double): Int {
    val h = (hue - floor(hue)) * 6
    val fraction = h - floor(h)
    val p = v * (1 - s); val q = v * (1 - s * fraction); val t = v * (1 - s * (1 - fraction))
    val channels = when (floor(h).toInt() % 6) {
      0 -> doubleArrayOf(v, t, p); 1 -> doubleArrayOf(q, v, p); 2 -> doubleArrayOf(p, v, t)
      3 -> doubleArrayOf(p, q, v); 4 -> doubleArrayOf(t, p, v); else -> doubleArrayOf(v, p, q)
    }
    return 0xff000000.toInt() or ((channels[0] * 255).roundToInt() shl 16) or
      ((channels[1] * 255).roundToInt() shl 8) or (channels[2] * 255).roundToInt()
  }
}
