package expo.modules.amllbackground

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Pure, bounded pixel processing. No artwork grading or animated-player state. */
internal object ArtistArtworkMath {
  data class Geometry(val width: Int, val photoHeight: Int, val extensionHeight: Int) {
    val height: Int get() = photoHeight + extensionHeight
  }
  data class Colors(val lowerMean: Int, val lowerEdgeMean: Int, val lowerCenterMean: Int, val average: Int,
    val sourceBackground: Int)
  data class Field(val geometry: Geometry, val pixels: IntArray, val colors: Colors, val sourceFingerprint: String)

  fun geometry(aspect: Double, extension: Double): Geometry? {
    if (!aspect.isFinite() || aspect !in 0.25..4.0 ||
      !extension.isFinite() || extension !in 0.0..1.0) return null
    // The usual square hero plus its 96dp tail is 240x296. Extreme shapes
    // reduce the width instead of allowing a very tall allocation.
    val width = min(240, floor(480.0 * aspect / (1.0 + extension)).toInt()).coerceAtLeast(1)
    val photoHeight = (width / aspect).roundToInt().coerceAtLeast(1)
    return Geometry(width, photoHeight, (photoHeight * extension).roundToInt())
  }

  fun prepare(source: IntArray, sourceWidth: Int, sourceHeight: Int, geometry: Geometry): Field {
    require(sourceWidth > 0 && sourceHeight > 0 && source.size == sourceWidth * sourceHeight)
    val crop = coverCrop(source, sourceWidth, sourceHeight, geometry.width, geometry.photoHeight)
    val colors = colors(crop, geometry.width, geometry.photoHeight, sourceBackground(source, sourceWidth, sourceHeight))
    // RGB is premultiplied during all interpolation/blur. Output alpha is only
    // applied afterwards, so bright clothing never gains a dark blur fringe.
    val extended = extendBottom(crop, geometry.width, geometry.photoHeight, geometry.extensionHeight)
    val sigmaScale = geometry.width / 240.0
    val sigmas = doubleArrayOf(0.0, 1.5, 4.5, 10.0, 18.0).map { it * sigmaScale }
    val levels = sigmas.map { if (it == 0.0) extended else gaussianApproximation(extended,
      geometry.width, geometry.height, it) }
    val output = IntArray(extended.size)
    for (y in 0 until geometry.height) {
      val sigma = sigmaAt(y, geometry) * sigmaScale
      var level = 0
      while (level < sigmas.lastIndex - 1 && sigma > sigmas[level + 1]) level++
      val mix = if (sigmas[level + 1] == sigmas[level]) 0.0 else
        ((sigma - sigmas[level]) / (sigmas[level + 1] - sigmas[level])).coerceIn(0.0, 1.0)
      for (x in 0 until geometry.width) {
        val index = y * geometry.width + x
        val blended = mixColor(levels[level][index], levels[level + 1][index], mix)
        // The renderer owns the ONE scene-opacity mask. This image only owns
        // progressive blur and keeps the source alpha, including in the tail.
        output[index] = unpremultiplyWithFade(blended, 1.0)
      }
    }
    return Field(geometry, output, colors, sourceFingerprint(source, sourceWidth, sourceHeight))
  }

  /** Center-cover exactly once; the added tail never changes the photo crop. */
  fun coverCrop(source: IntArray, sourceWidth: Int, sourceHeight: Int, width: Int, height: Int): IntArray {
    val scale = max(width.toDouble() / sourceWidth, height.toDouble() / sourceHeight)
    val left = (sourceWidth - width / scale) / 2.0
    val top = (sourceHeight - height / scale) / 2.0
    val premultiplied = IntArray(source.size) { premultiply(source[it]) }
    return IntArray(width * height) { index ->
      val sx = (left + (index % width + 0.5) / scale - 0.5).coerceIn(0.0, sourceWidth - 1.0)
      val sy = (top + (index / width + 0.5) / scale - 0.5).coerceIn(0.0, sourceHeight - 1.0)
      val x0 = floor(sx).toInt(); val x1 = min(sourceWidth - 1, x0 + 1)
      val y0 = floor(sy).toInt(); val y1 = min(sourceHeight - 1, y0 + 1)
      val upper = mixColor(premultiplied[y0 * sourceWidth + x0], premultiplied[y0 * sourceWidth + x1], sx - x0)
      val lower = mixColor(premultiplied[y1 * sourceWidth + x0], premultiplied[y1 * sourceWidth + x1], sx - x0)
      mixColor(upper, lower, sy - y0)
    }
  }

  /** Edge CLAMP: never stretch an interior stripe across the extension. */
  fun extendBottom(crop: IntArray, width: Int, photoHeight: Int, extensionHeight: Int): IntArray =
    IntArray(width * (photoHeight + extensionHeight)) { index ->
      crop[min(index / width, photoHeight - 1) * width + index % width]
    }

  fun opacityAt(y: Int, geometry: Geometry): Double = opacityAt(y.toDouble(), geometry)

  /** Legacy profile helper. V3 fields do not bake this fade into their alpha. */
  fun opacityAt(y: Double, geometry: Geometry): Double = 1.0 - smoothRamp(y,
    geometry.photoHeight * 0.62, (geometry.height - 1).toDouble())

  fun sigmaAt(y: Int, geometry: Geometry): Double = sigmaAt(y.toDouble(), geometry)

  fun sigmaAt(y: Double, geometry: Geometry): Double {
    // Keep the headstock/hand legible like the reference. Quintic easing has
    // zero slope and curvature at both ends. An 8px cap matches the reference
    // instrument texture better while keeping the lower tail softly blurred.
    val progress = ((y - geometry.width * 0.62) / (geometry.width * 0.73)).coerceIn(0.0, 1.0)
    return 8.0 * progress * progress * progress * (progress * (progress * 6.0 - 15.0) + 10.0)
  }

  /**
   * A small source-identity signature, before center-cover or tail extension.
   * Row-major 16x16 region means, RGB hex (1536 chars), never the UI crop.
   * Each original pixel participates in one region for images >=16px. Tiny
   * inputs repeat their nearest source region rather than inventing black cells.
   * Alpha weighting ignores invisible RGB without compositing a page color.
   */
  fun sourceFingerprint(source: IntArray, width: Int, height: Int): String {
    require(width > 0 && height > 0 && source.size == width * height)
    val output = StringBuilder(16 * 16 * 6)
    val digits = "0123456789abcdef"
    fun append(channel: Int) {
      output.append(digits[channel ushr 4]); output.append(digits[channel and 15])
    }
    for (row in 0 until 16) for (column in 0 until 16) {
      val x0 = (column * width / 16).coerceAtMost(width - 1)
      val y0 = (row * height / 16).coerceAtMost(height - 1)
      val x1 = ((column + 1) * width / 16).coerceAtLeast(x0 + 1).coerceAtMost(width)
      val y1 = ((row + 1) * height / 16).coerceAtLeast(y0 + 1).coerceAtMost(height)
      var red = 0L; var green = 0L; var blue = 0L; var weight = 0L
      for (y in y0 until y1) for (x in x0 until x1) {
        val pixel = source[y * width + x]
        val alpha = (pixel ushr 24).toLong()
        red += ((pixel ushr 16) and 255) * alpha
        green += ((pixel ushr 8) and 255) * alpha
        blue += (pixel and 255) * alpha
        weight += alpha
      }
      fun average(sum: Long) = if (weight > 0) ((sum + weight / 2) / weight).toInt().coerceIn(0, 255) else 0
      append(average(red)); append(average(green)); append(average(blue))
    }
    return output.toString()
  }

  /** Three separable boxes approximate a 2D Gaussian in O(width*height). */
  fun gaussianApproximation(pixels: IntArray, width: Int, height: Int, sigma: Double): IntArray {
    if (sigma <= 0.0) return pixels.copyOf()
    val ideal = sqrt(4.0 * sigma * sigma + 1.0)
    var lower = floor(ideal).toInt().coerceAtLeast(1)
    if (lower % 2 == 0) lower--
    val upper = lower + 2
    val lowerCount = ((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) /
      (-4.0 * lower - 4.0)).roundToInt().coerceIn(0, 3)
    // Keep 16 bits per channel between passes. Rounding a tiny Gaussian
    // contribution to 8 bits on every pass otherwise makes blur directional.
    var current = LongArray(pixels.size) { index ->
      val color = pixels[index]
      (((color ushr 24) * 257L) shl 48) or ((((color ushr 16) and 255) * 257L) shl 32) or
        ((((color ushr 8) and 255) * 257L) shl 16) or ((color and 255) * 257L)
    }
    var next = LongArray(pixels.size)
    val horizontal = LongArray(pixels.size)
    for (pass in 0..2) {
      val radius = ((if (pass < lowerCount) lower else upper) - 1) / 2
      boxPass(current, horizontal, width, height, radius, horizontal = true)
      boxPass(horizontal, next, width, height, radius, horizontal = false)
      val previous = current; current = next; next = previous
    }
    return IntArray(pixels.size) { index ->
      val color = current[index]
      fun channel(shift: Int) = ((((color ushr shift) and 65535L) + 128L) / 257L).toInt()
      (channel(48) shl 24) or (channel(32) shl 16) or (channel(16) shl 8) or channel(0)
    }
  }

  private fun boxPass(source: LongArray, result: LongArray, width: Int, height: Int, radius: Int, horizontal: Boolean) {
    if (radius == 0) { source.copyInto(result); return }
    val lineLength = if (horizontal) width else height
    val lineCount = if (horizontal) height else width
    val window = radius * 2 + 1
    fun index(line: Int, position: Int): Int = if (horizontal) line * width + position else position * width + line
    for (line in 0 until lineCount) {
      var a = 0; var r = 0; var g = 0; var b = 0
      fun add(color: Long, direction: Int) {
        a += ((color ushr 48) and 65535L).toInt() * direction; r += ((color ushr 32) and 65535L).toInt() * direction
        g += ((color ushr 16) and 65535L).toInt() * direction; b += (color and 65535L).toInt() * direction
      }
      for (position in -radius..radius) add(source[index(line, position.coerceIn(0, lineLength - 1))], 1)
      for (position in 0 until lineLength) {
        result[index(line, position)] = (((a + window / 2) / window).toLong() shl 48) or
          (((r + window / 2) / window).toLong() shl 32) or (((g + window / 2) / window).toLong() shl 16) or
          ((b + window / 2) / window).toLong()
        add(source[index(line, (position - radius).coerceIn(0, lineLength - 1))], -1)
        add(source[index(line, (position + radius + 1).coerceIn(0, lineLength - 1))], 1)
      }
    }
  }

  /**
   * Sample the scene before center-cover removes its margins. Portrait faces
   * and clothing normally occupy the center/lower frame, so only the two upper
   * corner patches participate. A fixed grid and channel medians reject small
   * highlights, hair intrusions and transparent borders without image-sized
   * allocations or a semantic/artist-specific subject heuristic.
   */
  fun sourceBackground(source: IntArray, width: Int, height: Int): Int {
    require(width > 0 && height > 0 && source.size == width * height)
    val red = IntArray(256); val green = IntArray(256); val blue = IntArray(256)
    val patchWidth = ceil(width * 0.12).toInt().coerceIn(1, width)
    val patchHeight = ceil(height * 0.20).toInt().coerceIn(1, height)
    var count = 0
    for (side in 0..1) for (row in 0 until 16) for (column in 0 until 16) {
      val x = (if (side == 0) 0 else width - patchWidth) +
        ((column + 0.5) * patchWidth / 16.0).toInt().coerceAtMost(patchWidth - 1)
      val y = ((row + 0.5) * patchHeight / 16.0).toInt().coerceAtMost(patchHeight - 1)
      val pixel = source[y * width + x]
      if (pixel ushr 24 < 128) continue
      red[(pixel ushr 16) and 255]++; green[(pixel ushr 8) and 255]++; blue[pixel and 255]++; count++
    }
    if (count == 0) return 0xff808080.toInt()
    fun median(histogram: IntArray): Int {
      val middle = (count + 1) / 2
      var cumulative = 0
      for (channel in histogram.indices) {
        cumulative += histogram[channel]
        if (cumulative >= middle) return channel
      }
      return 128
    }
    return 0xff000000.toInt() or (median(red) shl 16) or (median(green) shl 8) or median(blue)
  }

  private fun colors(crop: IntArray, width: Int, height: Int, sourceBackground: Int): Colors {
    val start = floor(height * 0.8).toInt().coerceAtMost(height - 1)
    val edge = ceil(width * 0.2).toInt().coerceAtLeast(1)
    val centerStart = floor(width * 0.4).toInt()
    val centerEnd = ceil(width * 0.6).toInt()
    fun mean(include: (Int, Int) -> Boolean): Int {
      var a = 0L; var r = 0L; var g = 0L; var b = 0L
      for (y in 0 until height) for (x in 0 until width) if (include(x, y)) {
        val pixel = crop[y * width + x]
        a += pixel ushr 24; r += (pixel ushr 16) and 255; g += (pixel ushr 8) and 255; b += pixel and 255
      }
      if (a == 0L) return 0xff808080.toInt()
      return 0xff000000.toInt() or ((r * 255 / a).toInt().coerceIn(0, 255) shl 16) or
        ((g * 255 / a).toInt().coerceIn(0, 255) shl 8) or (b * 255 / a).toInt().coerceIn(0, 255)
    }
    return Colors(mean { _, y -> y >= start }, mean { x, y -> y >= start && (x < edge || x >= width - edge) },
      mean { x, y -> y >= start && x >= centerStart && x < centerEnd }, mean { _, _ -> true }, sourceBackground)
  }

  private fun smoothRamp(position: Double, start: Double, end: Double): Double {
    if (end <= start) return if (position >= end) 1.0 else 0.0
    val t = ((position - start) / (end - start)).coerceIn(0.0, 1.0)
    // Quintic smootherstep has zero first and second derivatives only at the
    // two endpoints, so the interior never repeatedly pauses at old stops.
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
  }

  private fun premultiply(color: Int): Int {
    val a = color ushr 24
    return (a shl 24) or ((((color ushr 16) and 255) * a + 127) / 255 shl 16) or
      ((((color ushr 8) and 255) * a + 127) / 255 shl 8) or (((color and 255) * a + 127) / 255)
  }

  private fun unpremultiplyWithFade(color: Int, fade: Double): Int {
    val a = color ushr 24
    val outputAlpha = (a * fade).roundToInt().coerceIn(0, 255)
    if (a == 0 || outputAlpha == 0) return 0
    fun channel(shift: Int) = ((((color ushr shift) and 255) * 255 + a / 2) / a).coerceIn(0, 255)
    return (outputAlpha shl 24) or (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
  }

  private fun mixColor(first: Int, second: Int, amount: Double): Int {
    fun channel(shift: Int) = (((first ushr shift) and 255) * (1.0 - amount) +
      ((second ushr shift) and 255) * amount).roundToInt().coerceIn(0, 255)
    return (channel(24) shl 24) or (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
  }
}
