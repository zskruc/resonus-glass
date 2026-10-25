package expo.modules.liquidglass

import android.graphics.BlendMode
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Color
import android.graphics.ComposeShader
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import kotlin.math.roundToInt

// One Gaussian in the shared low-resolution producer. The edge consumer alone
// fades it over the live page, like Kyant's alpha-masked ProgressiveBlurContent:
// https://github.com/Kyant0/AndroidLiquidGlass/blob/kmp/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/destinations/ProgressiveBlurContent.kt
internal val progressiveBlurStops = FloatArray(17) { it / 16f }

internal fun progressiveBlurAlpha(position: Float): Float {
  // Finish softening before the bottom controls' centers. The material's
  // bounds set the start; the existing curve also applies to the compact row.
  val progress = ((position - 0.04f) / 0.36f).coerceIn(0f, 1f)
  return progress * progress * (3f - 2f * progress)
}

private val progressiveBlurAlphaColors = IntArray(progressiveBlurStops.size) { index ->
  Color.argb((progressiveBlurAlpha(progressiveBlurStops[index]) * 255f).roundToInt(), 255, 255, 255)
}

private const val CLAMP_MAIN_ATLAS_SHADER = """
uniform shader source;
uniform float2 sourceSize;
uniform float2 origin;
uniform float sourceScale;
half4 main(float2 coord) {
    float2 sampleCoord = (coord - origin) * sourceScale;
    return source.eval(clamp(sampleCoord, float2(0.5), sourceSize - float2(0.5)));
}
"""

/** Frozen with the submission, including when its GPU image arrives later. */
internal data class ProgressiveBlurStamp(
  val materialId: Int,
  val blurRadius: Float,
  val tintColor: Int,
  val tintOpacity: Float,
  val screenY: Int,
  val materialHeight: Int
)

internal data class ProgressiveBlurCapture(val effect: RenderEffect, val stamp: ProgressiveBlurStamp)

/** Graph objects are reused until geometry or the edge configuration changes. */
internal class ProgressiveBlurEffectCache {
  // These filters depend on radius, not moving edge geometry. Keeping them
  // immutable also lets already-submitted frames retain their original graph.
  private var rawEffect: RenderEffect? = null
  private var gaussianEffect: RenderEffect? = null
  private var gaussianRadius = Float.NaN
  private var cachedWidth = -1
  private var cachedHeight = -1
  private var cachedTop = Float.NaN
  private var cachedEdgeHeight = Float.NaN
  private var cachedSampleRadius = Float.NaN
  private var cachedCapture: ProgressiveBlurCapture? = null
  var buildCount = 0L
    private set

  @RequiresApi(Build.VERSION_CODES.S)
  fun get(width: Int, height: Int, top: Float, edgeHeight: Float, sampleRadius: Float,
    materialId: Int, blurRadius: Float, tintColor: Int, tintOpacity: Float,
    screenY: Int, materialHeight: Int): ProgressiveBlurCapture {
    val existing = cachedCapture
    val opacity = tintOpacity.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f
    val radius = sampleRadius.takeIf { it.isFinite() }?.coerceAtLeast(0f) ?: 0f
    val safeHeight = edgeHeight.takeIf { it.isFinite() }?.coerceAtLeast(1f) ?: 1f
    val graphMatches = existing != null && cachedWidth == width && cachedHeight == height &&
      cachedTop == top && cachedSampleRadius == radius &&
      existing.stamp.tintColor == tintColor && existing.stamp.tintOpacity == opacity
    if (existing != null && graphMatches && cachedEdgeHeight == safeHeight &&
      existing.stamp.materialId == materialId && existing.stamp.blurRadius == blurRadius &&
      existing.stamp.screenY == screenY && existing.stamp.materialHeight == materialHeight) return existing
    val processed = if (graphMatches) existing!!.effect else
      buildGraph(top, radius, tintColor, opacity).also { buildCount++ }
    // Frozen screen bounds identify a capture, but do not change its shader
    // when the sampled mask coordinates and configuration remain the same.
    return ProgressiveBlurCapture(processed,
      ProgressiveBlurStamp(materialId, blurRadius, tintColor, opacity, screenY, materialHeight)).also {
      cachedWidth = width
      cachedHeight = height
      cachedTop = top
      cachedEdgeHeight = safeHeight
      cachedSampleRadius = radius
      cachedCapture = it
    }
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun buildGraph(top: Float, radius: Float, tintColor: Int, opacity: Float): RenderEffect {
    // The producer contains full Gaussian inside the edge, raw elsewhere.
    // Only the final overlay fades it over the live page. Mixing sharp captured
    // text into this region would reveal two differently timed scroll frames.
    // This edge is attached to the screen bottom. A one-sample transition
    // precedes its stamped top; CLAMP keeps the bottom and buffer padding fully
    // processed so upsampling cannot blend the last pixels back into raw text.
    val mask = LinearGradient(0f, top - 1f, 0f, top,
      intArrayOf(Color.TRANSPARENT, Color.WHITE), null, Shader.TileMode.CLAMP)
    val raw = rawEffect ?: RenderEffect.createOffsetEffect(0f, 0f).also { rawEffect = it }
    val gaussian = if (radius > 0f) {
      val existing = gaussianEffect
      if (existing != null && gaussianRadius == radius) existing else {
        RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP).also {
          gaussianEffect = it
          gaussianRadius = radius
        }
      }
    } else raw
    val maskedBlur = RenderEffect.createBlendModeEffect(gaussian, RenderEffect.createShaderEffect(mask), BlendMode.DST_IN)
    // Keep the source opaque: alpha defines blur replacement strength, not
    // transparent pixels visible through every downstream glass capsule.
    var processed = RenderEffect.createBlendModeEffect(raw, maskedBlur, BlendMode.SRC_OVER)
    if (opacity > 0f && Color.alpha(tintColor) > 0) {
      val fullTint = Color.argb((Color.alpha(tintColor) * opacity).roundToInt(),
        Color.red(tintColor), Color.green(tintColor), Color.blue(tintColor))
      val transparentTint = fullTint and 0x00ffffff
      val tint = LinearGradient(0f, top - 1f, 0f, top,
        intArrayOf(transparentTint, fullTint), null, Shader.TileMode.CLAMP)
      processed = RenderEffect.createBlendModeEffect(processed, RenderEffect.createShaderEffect(tint), BlendMode.SRC_OVER)
    }
    return processed
  }
}

/** A single-pass transparent overlay; never draws sharp opaque capture padding. */
internal class ProgressiveBlurOverlayCache {
  private var bitmap: Bitmap? = null
  private var bitmapShader: BitmapShader? = null
  private var clampedBitmapShader: RuntimeShader? = null
  private var maskShader: LinearGradient? = null
  private var composite: ComposeShader? = null
  private var maskTop = Float.NaN
  private var maskHeight = Float.NaN
  private var sourceScale = Float.NaN
  private var sourceX = Float.NaN
  private var sourceY = Float.NaN
  private val matrix = Matrix()

  @RequiresApi(Build.VERSION_CODES.Q)
  fun get(frame: BackdropFrame, originX: Int, originY: Int, childHeight: Float): Shader {
    val stamp = requireNotNull(frame.progressiveBlur)
    val stampTop = (stamp.screenY - originY).toFloat()
    val top = maxOf(0f, stampTop)
    val bottom = minOf(childHeight, stampTop + stamp.materialHeight)
    val height = (bottom - top).coerceAtLeast(1f)
    // A delayed frame may start above a collapsing child. Restart alpha at
    // their intersection, rather than exposing the old mask's nonzero middle.
    if (maskShader == null || maskTop != top || maskHeight != height) {
      maskShader = LinearGradient(0f, top, 0f, top + height,
        progressiveBlurAlphaColors, progressiveBlurStops, Shader.TileMode.CLAMP)
      maskTop = top
      maskHeight = height
      composite = null
    }
    if (bitmap !== frame.bitmap) {
      bitmap = frame.bitmap
      bitmapShader = BitmapShader(frame.bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
      if (frame.unblurredPatch != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        // RuntimeShader input defaults to nearest, regardless of Paint flags.
        bitmapShader!!.setFilterMode(BitmapShader.FILTER_MODE_LINEAR)
        val shader = clampedBitmapShader ?: RuntimeShader(CLAMP_MAIN_ATLAS_SHADER).also { clampedBitmapShader = it }
        shader.setInputShader("source", bitmapShader!!)
        shader.setFloatUniform("sourceSize", frame.mainPixelWidth.toFloat(), frame.mainPixelHeight.toFloat())
      } else clampedBitmapShader = null
      sourceScale = Float.NaN
      composite = null
    }
    val scale = 1f / frame.scale
    val x = (frame.screenX - originX).toFloat()
    val y = (frame.screenY - originY).toFloat()
    if (sourceScale != scale || sourceX != x || sourceY != y) {
      val clamp = clampedBitmapShader
      if (clamp != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        clamp.setFloatUniform("origin", x, y)
        clamp.setFloatUniform("sourceScale", frame.scale)
      } else {
        matrix.setScale(scale, scale)
        matrix.postTranslate(x, y)
        bitmapShader!!.setLocalMatrix(matrix)
      }
      composite = null
      sourceScale = scale
      sourceX = x
      sourceY = y
    }
    return composite ?: ComposeShader(clampedBitmapShader ?: bitmapShader!!, maskShader!!, BlendMode.DST_IN).also { composite = it }
  }

  fun clear() {
    // A detached edge must not retain a Bitmap backed by a retired GPU Image.
    composite = null
    bitmapShader = null
    clampedBitmapShader = null
    bitmap = null
    maskShader = null
    maskTop = Float.NaN
    maskHeight = Float.NaN
    sourceScale = Float.NaN
    sourceX = Float.NaN
    sourceY = Float.NaN
  }
}
