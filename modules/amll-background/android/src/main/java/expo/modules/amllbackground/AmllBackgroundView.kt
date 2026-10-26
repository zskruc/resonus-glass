package expo.modules.amllbackground

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference
import java.util.WeakHashMap
import java.util.concurrent.Future

/** A normal child View: no separate Surface, screenshot, window, or refresh-rate override. */
class AmllBackgroundView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var ready = false
  private var requestedUri: String? = null
  private var texture: Bitmap? = null
  private var decodeTask: Future<*>? = null
  private val generation = ArtworkGeneration()
  private var active = false
  private var foreground = ArtworkBackgroundViews.foreground
  private var framePosted = false
  private val clock = BackgroundFrameClock()
  private val choreographer = Choreographer.getInstance()
  private val vertices = FloatArray((ArtworkFieldMath.MESH_SIZE + 1) * (ArtworkFieldMath.MESH_SIZE + 1) * 2)
  private val texturePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
  private val outputPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
  private val vignettePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val destination = RectF()
  private var buffer: Bitmap? = null
  private var bufferCanvas: Canvas? = null
  private var bufferViewWidth = 0
  private var bufferViewHeight = 0

  private val frameCallback = Choreographer.FrameCallback { timestamp ->
    framePosted = false
    if (shouldAnimateField()) {
      if (clock.advance(timestamp)) {
        renderField()
        invalidate()
      }
      scheduleFrames()
    } else clock.stop()
  }

  init {
    setWillNotDraw(false)
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    isClickable = false
    isFocusable = false
    ready = true
  }

  fun setArtwork(uri: String?) {
    val clean = uri?.takeIf { it.startsWith("/") || it.startsWith("file:") || it.startsWith("content:") }
    if (clean == requestedUri) return
    requestedUri = clean
    generation.next()
    ArtworkTextures.cancel(decodeTask)
    decodeTask = null
    texture = clean?.let(ArtworkTextures::get)
    // A cache miss belongs to this song; never leave another song's field under its title.
    renderField()
    invalidate()
    scheduleFrames()
    if (clean != null && texture == null) loadArtwork(clean)
  }

  fun setActive(value: Boolean) {
    if (active == value) return
    active = value
    scheduleFrames()
  }

  internal fun setAppForeground(value: Boolean) {
    foreground = value
    scheduleFrames()
  }

  private fun loadArtwork(uri: String) {
    val token = generation.next()
    val weakView = WeakReference(this)
    val guard = generation
    decodeTask = ArtworkTextures.load(context.applicationContext, uri, { guard.accepts(token) }) { decoded ->
      // Never hold an unmounted view throughout a decode or post a strong view reference.
      ArtworkBackgroundViews.main.post {
        val view = weakView.get() ?: return@post
        if (!guard.accepts(token)) return@post
        view.texture = decoded
        view.decodeTask = null
        view.renderField()
        view.invalidate()
        view.scheduleFrames()
      }
    }
  }

  private fun shouldAnimateField() = active && foreground && texture != null && isAttachedToWindow &&
    isShown && windowVisibility == View.VISIBLE && width > 0 && height > 0

  private fun scheduleFrames() {
    if (!ready) return
    if (shouldAnimateField()) {
      if (!framePosted) {
        framePosted = true
        choreographer.postFrameCallback(frameCallback)
      }
    } else {
      if (framePosted) choreographer.removeFrameCallback(frameCallback)
      framePosted = false
      clock.stop()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ArtworkBackgroundViews.attach(this)
    val uri = requestedUri
    if (texture == null && uri != null && decodeTask == null) loadArtwork(uri)
    renderField()
    scheduleFrames()
  }

  override fun onDetachedFromWindow() {
    generation.next()
    ArtworkTextures.cancel(decodeTask)
    decodeTask = null
    if (framePosted) choreographer.removeFrameCallback(frameCallback)
    framePosted = false
    clock.stop()
    ArtworkBackgroundViews.detach(this)
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (ready) scheduleFrames()
  }

  override fun onVisibilityAggregated(isVisible: Boolean) {
    super.onVisibilityAggregated(isVisible)
    if (ready) scheduleFrames()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    destination.set(0f, 0f, w.toFloat(), h.toFloat())
    renderField()
    scheduleFrames()
  }

  private fun ensureBuffer(): Boolean {
    if (width <= 0 || height <= 0) return false
    if (buffer != null && bufferViewWidth == width && bufferViewHeight == height) return true
    bufferViewWidth = width
    bufferViewHeight = height
    val (w, h) = ArtworkFieldMath.bufferSize(width, height)
    if (buffer?.width == w && buffer?.height == h) return true
    // Only size changes allocate, not animation frames. Old buffers may still be in a display list.
    buffer = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    bufferCanvas = Canvas(buffer!!)
    vignettePaint.shader = RadialGradient(w * 0.5f, h * 0.43f, maxOf(w, h) * 0.70f,
      intArrayOf(Color.TRANSPARENT, 0x66000000), floatArrayOf(0.12f, 1f), Shader.TileMode.CLAMP)
    return true
  }

  private fun renderField() {
    if (!ensureBuffer()) return
    val target = buffer!!
    val canvas = bufferCanvas!!
    canvas.drawColor(ArtworkFieldMath.NEUTRAL)
    val artwork = texture ?: return
    ArtworkFieldMath.fillVertices(vertices, target.width, target.height, clock.seconds)
    canvas.drawBitmapMesh(artwork, ArtworkFieldMath.MESH_SIZE, ArtworkFieldMath.MESH_SIZE,
      vertices, 0, null, 0, texturePaint)
    canvas.drawRect(0f, 0f, target.width.toFloat(), target.height.toFloat(), vignettePaint)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val field = buffer
    if (field == null) canvas.drawColor(ArtworkFieldMath.NEUTRAL)
    else canvas.drawBitmap(field, null, destination, outputPaint)
  }
}

/** Weak registrations provide a native backstop when JS is busy during backgrounding. */
internal object ArtworkBackgroundViews {
  val main = Handler(Looper.getMainLooper())
  private val views = WeakHashMap<AmllBackgroundView, Unit>()
  var foreground = true
    private set

  fun attach(view: AmllBackgroundView) {
    views[view] = Unit
    view.setAppForeground(foreground)
  }

  fun detach(view: AmllBackgroundView) { views.remove(view) }

  fun setForeground(value: Boolean) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { setForeground(value) }
      return
    }
    foreground = value
    views.keys.toList().forEach { it.setAppForeground(value) }
  }
}
