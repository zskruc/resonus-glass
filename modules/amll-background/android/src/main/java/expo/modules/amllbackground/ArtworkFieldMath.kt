package expo.modules.amllbackground

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** Independent small-texture color treatment and a continuous, non-folding mesh. */
internal object ArtworkFieldMath {
  const val TEXTURE_SIZE = 32
  const val MESH_SIZE = 8
  const val NEUTRAL = 0xff25252d.toInt()

  fun shapeColor(argb: Int): Int {
    val alpha = ((argb ushr 24) and 255) / 255.0
    // Composite transparent artwork onto a neutral field before filtering.
    val r = ((argb ushr 16) and 255) * alpha + 37.0 * (1.0 - alpha)
    val g = ((argb ushr 8) and 255) * alpha + 37.0 * (1.0 - alpha)
    val b = (argb and 255) * alpha + 45.0 * (1.0 - alpha)
    val luma = r * 0.2126 + g * 0.7152 + b * 0.0722
    // Combined standard contrast / saturation / contrast / exposure matrix.
    val gain = 0.4 * 1.7 * 0.75
    val pedestal = 127.5 * (1.0 - 0.4 * 1.7) * 0.75
    fun channel(value: Double) = (gain * (luma + 3.0 * (value - luma)) + pedestal)
      .roundToInt().coerceIn(0, 255)
    return (255 shl 24) or (channel(r) shl 16) or (channel(g) shl 8) or channel(b)
  }

  /** A separable clamped box filter. Only called once per newly decoded cover. */
  fun soften(pixels: IntArray, width: Int, height: Int, radius: Int = 2, passes: Int = 4) {
    require(width > 0 && height > 0 && pixels.size == width * height)
    require(radius >= 0 && passes >= 0)
    if (radius == 0 || passes == 0) return
    val scratch = IntArray(pixels.size)
    val diameter = radius * 2 + 1
    repeat(passes) {
      for (y in 0 until height) for (x in 0 until width) {
        var r = 0; var g = 0; var b = 0
        for (offset in -radius..radius) {
          val color = pixels[y * width + (x + offset).coerceIn(0, width - 1)]
          r += (color ushr 16) and 255; g += (color ushr 8) and 255; b += color and 255
        }
        scratch[y * width + x] = (255 shl 24) or ((r / diameter) shl 16) or
          ((g / diameter) shl 8) or (b / diameter)
      }
      for (y in 0 until height) for (x in 0 until width) {
        var r = 0; var g = 0; var b = 0
        for (offset in -radius..radius) {
          val color = scratch[(y + offset).coerceIn(0, height - 1) * width + x]
          r += (color ushr 16) and 255; g += (color ushr 8) and 255; b += color and 255
        }
        pixels[y * width + x] = (255 shl 24) or ((r / diameter) shl 16) or
          ((g / diameter) shl 8) or (b / diameter)
      }
    }
  }

  /** Long edge is capped before any software rasterization or texture upload. */
  fun bufferSize(width: Int, height: Int): Pair<Int, Int> {
    if (width <= 0 || height <= 0) return 1 to 1
    val scale = minOf(1.0, 256.0 / maxOf(width, height))
    return maxOf(1, (width * scale).roundToInt()) to maxOf(1, (height * scale).roundToInt())
  }

  fun fillVertices(output: FloatArray, width: Int, height: Int, seconds: Double) {
    require(output.size == (MESH_SIZE + 1) * (MESH_SIZE + 1) * 2)
    val slow = seconds * 0.09
    val angle = sin(slow * 0.67) * 0.10
    val ca = cos(angle); val sa = sin(angle)
    val driftX = sin(slow) * 0.048
    val driftY = cos(slow * 0.83) * 0.052
    var index = 0
    for (row in 0..MESH_SIZE) for (column in 0..MESH_SIZE) {
      val u = column.toDouble() / MESH_SIZE
      val v = row.toDouble() / MESH_SIZE
      val edge = sin(PI * u) * sin(PI * v)
      val x = (u - 0.5) * 1.30 + sin(v * PI * 2.0 + slow) * 0.045 * edge + driftX
      val y = (v - 0.5) * 1.30 + cos(u * PI * 2.0 - slow * 0.79) * 0.045 * edge + driftY
      output[index++] = ((0.5 + x * ca - y * sa) * width).toFloat()
      output[index++] = ((0.5 + x * sa + y * ca) * height).toFloat()
    }
  }
}

/** This clock limits background work, never the containing window's refresh rate. */
internal class BackgroundFrameClock {
  private var previousTick = 0L
  private var previousRender = 0L
  var seconds = 0.0
    private set

  fun stop() { previousTick = 0L; previousRender = 0L }

  fun advance(timestamp: Long): Boolean {
    if (previousTick != 0L) seconds += ((timestamp - previousTick).coerceIn(0L, 100_000_000L)) / 1e9
    previousTick = timestamp
    if (previousRender == 0L || timestamp - previousRender >= 16_000_000L) {
      previousRender = timestamp
      return true
    }
    return false
  }
}

/** Any source change/detach invalidates a worker's result, even if cancellation loses. */
internal class ArtworkGeneration {
  @Volatile private var value = 0L
  fun next(): Long { value += 1; return value }
  fun accepts(token: Long): Boolean = value == token
}
