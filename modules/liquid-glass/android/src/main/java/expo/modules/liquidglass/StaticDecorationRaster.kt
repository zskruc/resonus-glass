package expo.modules.liquidglass

import android.os.Handler
import android.os.Build
import android.os.Looper
import android.os.Trace
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.draw
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeout

private fun rasterCounter(name: String, value: Long) {
  // Module lifecycle also runs on API 24–28, where this optional renderer is
  // ineligible but Trace.setCounter does not exist yet.
  if (Build.VERSION.SDK_INT >= 29) Trace.setCounter(name, value)
}

internal data class StaticDecorationImages(val body: ImageBitmap, val highlight: ImageBitmap) {
  val bytes: Long get() = body.asAndroidBitmap().allocationByteCount.toLong() +
    highlight.asAndroidBitmap().allocationByteCount.toLong()
}

/** Process-scoped pixels only: no Views, Activities, drawing closures, or artwork. */
internal object StaticDecorationRasters {
  // Real Samsung Yoga layouts contain both 554px and 555px cards. Keep those
  // exact shader-size keys; 24 MiB admits both ~9 MiB pairs without rescaling.
  private val budget = StaticRasterBudget<StaticDecorationKey, StaticDecorationImages>(24L * 1024 * 1024)
  private val main = Handler(Looper.getMainLooper())
  private var trimOnRelease = false
  var version by mutableIntStateOf(0)
    private set
  private var hits = 0L
  private var captures = 0L
  private var failures = 0L
  private var memoryFallback = false

  private fun checkMain() = check(Looper.myLooper() == Looper.getMainLooper())
  private fun publish(before: Long) {
    if (budget.revision != before) version++
    rasterCounter("StaticGlassRaster.bytes", budget.stats().bytes)
  }

  fun acquire(key: StaticDecorationKey, bytes: Long): StaticRasterBudget.Lease<StaticDecorationKey>? {
    checkMain()
    if (memoryFallback) return null
    trimOnRelease = false
    return budget.acquire(key, bytes).also {
      if (budget.value(it) != null) rasterCounter("StaticGlassRaster.hits", ++hits)
      rasterCounter("StaticGlassRaster.bytes", budget.stats().bytes)
    }
  }

  fun value(lease: StaticRasterBudget.Lease<StaticDecorationKey>?) = budget.value(lease)
  fun claim(lease: StaticRasterBudget.Lease<StaticDecorationKey>?) =
    if (memoryFallback) null else budget.claim(lease)

  fun complete(ticket: StaticRasterBudget.Producer<StaticDecorationKey>, images: StaticDecorationImages) {
    checkMain()
    val before = budget.revision
    if (budget.complete(ticket, images, images.bytes)) rasterCounter("StaticGlassRaster.captures", ++captures)
    publish(before)
  }

  fun fail(ticket: StaticRasterBudget.Producer<StaticDecorationKey>) {
    checkMain()
    val before = budget.revision
    budget.fail(ticket)
    if (budget.revision != before) rasterCounter("StaticGlassRaster.failures", ++failures)
    publish(before)
  }

  fun outOfMemory(ticket: StaticRasterBudget.Producer<StaticDecorationKey>) {
    // An optional optimization must not repeatedly allocate after GPU pressure
    // rejected it. Keep the original live renderer for the rest of this process.
    memoryFallback = true
    fail(ticket)
    trimUnused()
  }

  fun release(lease: StaticRasterBudget.Lease<StaticDecorationKey>?) {
    checkMain()
    val before = budget.revision
    budget.release(lease)
    if (trimOnRelease) budget.trimUnused()
    publish(before)
  }

  /** Existing displayed images retain leases; never recycle a display-list bitmap. */
  fun trimUnused() {
    if (Looper.myLooper() != Looper.getMainLooper()) { main.post { trimUnused() }; return }
    trimOnRelease = true
    val before = budget.revision
    budget.trimUnused()
    publish(before)
  }
}

private class StaticRasterLeaseSlot {
  var lease: StaticRasterBudget.Lease<StaticDecorationKey>? = null
  var attemptedVersion: Int? = null
}

/** The normal material stays live until a complete matching pair has been captured. */
@Composable
internal fun StaticDecorationRaster(
  style: StaticDecorationStyle,
  original: @Composable () -> Unit,
  body: @Composable (Modifier) -> Unit,
  highlight: @Composable (Modifier) -> Unit
) {
  BoxWithConstraints(Modifier.fillMaxSize()) {
    val key = remember(style, constraints.maxWidth, constraints.maxHeight) {
      StaticDecorationKey(constraints.maxWidth, constraints.maxHeight, style)
    }
    val geometry = remember(key) { staticDecorationGeometry(key) }
    if (geometry == null) { original(); return@BoxWithConstraints }
    val version = StaticDecorationRasters.version
    val slot = remember(key) { StaticRasterLeaseSlot() }
    // A new theme may initially compete with still-mounted old-theme leases.
    // Retry admission once when ownership/budget changes, never every draw.
    if (slot.lease == null && slot.attemptedVersion != version) {
      slot.attemptedVersion = version
      slot.lease = StaticDecorationRasters.acquire(key, geometry.reservationBytes)
    }
    DisposableEffect(slot) { onDispose { StaticDecorationRasters.release(slot.lease) } }
    val lease = slot.lease
    val cached = StaticDecorationRasters.value(lease)
    if (cached != null) {
      // Only these two image commands survive. No Backdrop/Shadow/Highlight
      // modifier subtree remains to rebuild GPU filters on clipped re-entry.
      Canvas(Modifier.fillMaxSize()) {
        drawImage(cached.body, topLeft = androidx.compose.ui.geometry.Offset(-geometry.body.left.toFloat(), -geometry.body.top.toFloat()))
        drawImage(cached.highlight, topLeft = androidx.compose.ui.geometry.Offset(-1f, -1f), blendMode = BlendMode.Plus)
      }
    } else {
      val ticket = remember(lease, version) { StaticDecorationRasters.claim(lease) }
      if (ticket == null) original()
      else CaptureStaticDecoration(key, geometry, ticket, body, highlight)
    }
  }
}

@Composable
private fun CaptureStaticDecoration(
  key: StaticDecorationKey,
  geometry: StaticDecorationGeometry,
  ticket: StaticRasterBudget.Producer<StaticDecorationKey>,
  body: @Composable (Modifier) -> Unit,
  highlight: @Composable (Modifier) -> Unit
) {
  val bodyLayer = rememberGraphicsLayer()
  val highlightLayer = rememberGraphicsLayer()
  val bodyRecorded = remember(ticket) { CompletableDeferred<Unit>() }
  val highlightRecorded = remember(ticket) { CompletableDeferred<Unit>() }
  // Additive highlight is replayed additively both before and after capture.
  // Flattening it into the body and using SrcOver would change AA edge pixels.
  highlightLayer.blendMode = BlendMode.Plus
  Box(Modifier.fillMaxSize()) {
    body(Modifier.captureStaticLayer(bodyLayer, geometry.body, key, bodyRecorded))
    highlight(Modifier.captureStaticLayer(highlightLayer, geometry.highlight, key, highlightRecorded))
  }
  LaunchedEffect(ticket) {
    try {
      withTimeout(2_000L) {
        bodyRecorded.await()
        highlightRecorded.await()
        // Deferred completion occurs in draw(). Leave that recording stack
        // before invoking Android's synchronous hardware bitmap renderer.
        withFrameNanos { }
      }
      currentCoroutineContext().ensureActive()
      // Compose 1.9.4 / API 28+: toImageBitmap synchronously invokes
      // Bitmap.createBitmap(Picture). Keep live-layer access on MAIN.
      val first = traceSnapshot("StaticGlassRaster:body", bodyLayer)
      currentCoroutineContext().ensureActive()
      val second = traceSnapshot("StaticGlassRaster:highlight", highlightLayer)
      currentCoroutineContext().ensureActive()
      check(first.hasAlpha && second.hasAlpha)
      StaticDecorationRasters.complete(ticket, StaticDecorationImages(first, second))
    } catch (_: TimeoutCancellationException) {
      // A hidden attached host must never own the global producer forever.
      StaticDecorationRasters.fail(ticket)
    } catch (cancelled: CancellationException) {
      // Disposal releases this producer lease, allowing a surviving host to
      // take over. It must not publish an obsolete size/theme generation.
      throw cancelled
    } catch (_: OutOfMemoryError) {
      StaticDecorationRasters.outOfMemory(ticket)
    } catch (_: Exception) {
      StaticDecorationRasters.fail(ticket)
    }
  }
}

private suspend fun traceSnapshot(name: String, layer: GraphicsLayer): ImageBitmap {
  Trace.beginSection(name)
  return try { layer.toImageBitmap() } finally { Trace.endSection() }
}

/** Recording uses an expanded transparent canvas, but the material sees its real size. */
private fun Modifier.captureStaticLayer(
  layer: GraphicsLayer,
  envelope: StaticRasterEnvelope,
  key: StaticDecorationKey,
  recorded: CompletableDeferred<Unit>
): Modifier = fillMaxSize().drawWithContent {
  if (!recorded.isCompleted) {
    val logicalSize = androidx.compose.ui.geometry.Size(key.width.toFloat(), key.height.toFloat())
    layer.record(density = this, layoutDirection = layoutDirection, size = IntSize(envelope.width, envelope.height)) {
      withTransform({ translate(envelope.left.toFloat(), envelope.top.toFloat()) }) {
        this@drawWithContent.draw(density = drawContext.density, layoutDirection = drawContext.layoutDirection,
          canvas = drawContext.canvas, size = logicalSize, graphicsLayer = drawContext.graphicsLayer) {
          this@drawWithContent.drawContent()
        }
      }
    }
    recorded.complete(Unit)
  }
  // Keep GraphicsLayer.topLeft at zero: toImageBitmap includes its properties.
  // Only the on-screen replay moves; the captured transparent bitmap must
  // retain its complete positive-coordinate shadow/highlight envelope.
  withTransform({ translate(-envelope.left.toFloat(), -envelope.top.toFloat()) }) {
    drawLayer(layer)
  }
}
