package expo.modules.liquidglass

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.ColorSpace
import android.graphics.HardwareRenderer
import android.graphics.Matrix
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.RenderNode
import android.graphics.drawable.ColorDrawable
import android.hardware.HardwareBuffer
import android.media.Image
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import android.view.View
import android.view.ViewTreeObserver
import androidx.annotation.RequiresApi
import androidx.compose.runtime.snapshots.Snapshot
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.util.ReactFindViewUtil
import java.time.Duration
import java.lang.ref.WeakReference
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor

/** Immutable coordinates for the mini's raw patch in the same GPU image. */
internal data class UnblurredBackdropPatch(
  val materialId: Int,
  val screenX: Float,
  val screenY: Float,
  val pixelWidth: Int,
  val pixelHeight: Int,
  val atlasX: Int,
  val atlasY: Int
)

/**
 * One GPU capture per root/window, shared by every material in that window.
 * The retained Image owns the sampled GPU buffer; it stays alive for two frames
 * rather than closing a buffer while Compose may still be drawing from it.
 */
internal data class BackdropFrame(
  val bitmap: Bitmap,
  val image: Image,
  val scale: Float,
  val screenX: Int,
  val screenY: Int,
  // A reader must outlive every displayed Image that it owns, including frames
  // retained across a resize or a discarded GPU generation.
  val source: ImageReader,
  val progressiveBlur: ProgressiveBlurStamp? = null,
  val mainPixelWidth: Int = bitmap.width,
  val mainPixelHeight: Int = bitmap.height,
  val unblurredPatch: UnblurredBackdropPatch? = null,
  val pageEpoch: Long
)

/** Ordinary alpha remains unchanged during capture, unlike transition alpha. */
private fun isMaterialVisible(surface: LiquidGlassView, visibleRect: Rect): Boolean {
  if (!surface.glassEnabled || !surface.isShown || surface.width <= 0 || surface.height <= 0) return false
  var ancestor: View? = surface
  while (ancestor != null) {
    if (ancestor.alpha <= 0f) return false
    ancestor = ancestor.parent as? View
  }
  return surface.getGlobalVisibleRect(visibleRect)
}

internal object WindowBackdrops {
  private val windows = mutableMapOf<View, WindowBackdrop>()
  private val surfaces = mutableSetOf<LiquidGlassView>()
  private val suppressedHosts = mutableSetOf<LiquidGlassView>()
  var isCapturing = false
    private set

  fun onHostSuppressed(surface: LiquidGlassView) {
    suppressedHosts.add(surface)
  }

  @RequiresApi(Build.VERSION_CODES.S)
  fun attach(surface: LiquidGlassView, activityDecor: View?): WindowBackdrop {
    val root = surface.rootView
    val backdrop = windows.getOrPut(root) { WindowBackdrop(root, activityDecor) }
    surfaces.add(surface)
    backdrop.add(surface)
    return backdrop
  }

  fun detach(surface: LiquidGlassView, backdrop: WindowBackdrop) {
    surfaces.remove(surface)
    backdrop.remove(surface)
    if (backdrop.isEmpty) {
      windows.remove(backdrop.root)
      backdrop.close()
    }
  }

  fun diagnostics(): Map<String, Any> = mapOf(
    "activeWindows" to windows.size,
    "activeSurfaces" to surfaces.size,
    "windows" to windows.values.map { it.diagnostics() }
  )

  /** The capture omits these parents, including their decorative/interactive children. */
  fun isGlassContainer(view: View, captureRoot: View): Boolean = view !== captureRoot &&
    surfaces.any { it.glassEnabled && it.parent === view }

  /** Omit wrappers without changing ordinary alpha or the visibility property. */
  fun <T> withoutGlass(root: View, activityDecor: View?, captureSource: View = root, capture: () -> T): T {
    // A background window's earlier observer can draw/clean its image/text
    // dirty flags before a modal's observer runs. Let modal consumers observe
    // the actual scene before this capture or its temporary alpha mutations.
    windows.values.forEach { it.observeBackgroundScene(root) }
    val visibleRect = Rect()
    val capturedSurfaces = surfaces.filter { surface ->
      backdropSourceContainsSurface(captureSource === root, isDescendantOf(surface, captureSource),
        activityDecor != null && isDescendantOf(surface, activityDecor))
    }
    val excluded = capturedSurfaces.mapNotNull { surface ->
      if (isMaterialVisible(surface, visibleRect)) {
        (surface.parent as? View)?.takeUnless { it === captureSource || it === root || it === activityDecor }
      } else null
    }.distinct()
    val originalTransitionAlpha = excluded.map { it.transitionAlpha }
    val wasCapturing = isCapturing
    isCapturing = true
    try {
      // INVISIBLE clears TextInput focus. Transition alpha avoids changing the
      // visibility property, ordinary alpha, or dispatching ordinary visibility
      // events. Android's isVisibleToUser can still report false while it is zero.
      excluded.forEach { it.transitionAlpha = 0f }
      // ViewOverlay lives outside LiquidGlassView.dispatchDraw. Explicitly
      // exclude even its cached RenderNode; an onDraw guard alone cannot stop
      // replay of a previous selected layer into the backdrop it samples.
      capturedSurfaces.forEach { it.suppressSelectionOverlayForCapture() }
      return capture()
    } finally {
      try {
        excluded.forEachIndexed { index, view -> view.transitionAlpha = originalTransitionAlpha[index] }
      } finally {
        isCapturing = wasCapturing
        if (!isCapturing) {
          try {
            capturedSurfaces.forEach { it.restoreSelectionOverlayAfterCapture() }
          } finally {
            // Drawing an alpha-zero parent can still re-record dirty child nodes.
            // Restore suppressed hosts even if an overlay's restoration fails.
            try {
              suppressedHosts.forEach { it.restoreDisplayListAfterCapture() }
            } finally { suppressedHosts.clear() }
          }
        }
      }
    }
  }

  private fun isDescendantOf(view: View, ancestor: View): Boolean {
    var current: View? = view
    while (current != null) {
      if (current === ancestor) return true
      current = current.parent as? View
    }
    return false
  }
}

@RequiresApi(Build.VERSION_CODES.S)
internal class WindowBackdrop(
  val root: View,
  private val activityDecor: View?
) : ViewTreeObserver.OnPreDrawListener, ViewTreeObserver.OnScrollChangedListener {
  private val surfaces = mutableSetOf<LiquidGlassView>()
  private val frames = ArrayDeque<BackdropFrame>()
  private val retiredReaders = mutableSetOf<ImageReader>()
  private val ticketLock = Any()
  private val queuedTickets = ArrayDeque<PendingCapture>()
  // Main-thread ownership includes worker-prepared results awaiting UI delivery.
  // Taking an image off the FIFO does not release its pipeline capacity.
  private val inFlightTickets = linkedSetOf<PendingCapture>()
  private val location = IntArray(2)
  private val activityLocation = IntArray(2)
  private val contentLocation = IntArray(2)
  private var contentSourceReference: WeakReference<View>? = null
  private var menuScrimReference: WeakReference<View>? = null
  private val backgroundChanges = BackdropSceneChanges()
  private val nativePage = NativeBackdropPage()
  private val menuGeometry = BackdropSceneChanges()
  private var menuGeometrySignature: Long? = null
  private val surfaceGeometry = BackdropGeometryChanges<LiquidGlassView>()
  private val surfaceGeometryMatrix = Matrix()
  private val surfaceGeometryMatrixValues = FloatArray(9)
  private val surfaceGeometryObserver = object : BackdropGeometryChanges.Observer<LiquidGlassView> {
    override fun fingerprint(surface: LiquidGlassView): Long = surfaceGeometryFingerprint(surface)
    override fun changed(surface: LiquidGlassView) {
      surface.onBackdropGeometryChanged()
      surfaceGeometryRedrawCount++
      if (surface.isolateModalForeground) menuGeometryRedrawCount++
    }
    override fun commitChanges() {
      // All geometry changes are staged before applying their drawing
      // observers. This still runs in pre-draw, before the capture or draw.
      Snapshot.sendApplyNotifications()
    }
  }
  private val screenRect = Rect()
  private val surfaceLocation = IntArray(2)
  private val captureRect = Rect()
  private val captureRegion = BackdropCaptureRegion()
  private val progressiveRect = Rect()
  private val rawRect = Rect()
  private val progressiveEffect = ProgressiveBlurEffectCache()
  private val asynchronous = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
  private val choreographer = Choreographer.getInstance()
  private var currentFrameTimeNanos = Long.MIN_VALUE
  private var frameClockPosted = false
  private val frameClock = Choreographer.FrameCallback { frameTimeNanos ->
    frameClockPosted = false
    currentFrameTimeNanos = frameTimeNanos
    if (!closed && (scrollVersion != capturedScrollVersion || materialVersion != capturedMaterialVersion ||
        sceneVersion != capturedSceneVersion) &&
      root.isAttachedToWindow) root.invalidate()
  }
  private val mainHandler = Handler(Looper.getMainLooper())
  private val imageThread = if (asynchronous) HandlerThread("Resonus backdrop images").apply { start() } else null
  private val imageHandler = imageThread?.let { Handler(it.looper) }
  private val retiredImages = BoundedRetirementQueue<Image>(MAX_RETIRED_IMAGES)
  private val retirementDrainPosted = AtomicBoolean(false)
  private val retirementFallbackCount = AtomicInteger(0)
  private val retirementCloseFailureCount = AtomicInteger(0)
  private var retirementBackpressureCount = 0L
  private var retirementPeak = 0
  private val retirementDrain = Runnable {
    try { drainRetiredImages() } finally {
      retirementDrainPosted.set(false)
      // A publisher can enqueue after the last poll but before this reset.
      // Re-arm that race so an otherwise idle window never strands an Image.
      if (retiredImages.size > 0) scheduleRetirementDrain()
    }
  }
  private var reader: ImageReader? = null
  private var renderer: HardwareRenderer? = null
  private var renderNode: RenderNode? = null
  private var rawSourceNode: RenderNode? = null
  private var processedSourceNode: RenderNode? = null
  private var pixelWidth = 0
  private var pixelHeight = 0
  private var shrinkWidth = 0
  private var shrinkHeight = 0
  private var shrinkSince = 0L
  private var captureShrinkCount = 0L
  private var lastCapture = 0L
  private var lastCaptureVsyncNanos = Long.MIN_VALUE
  private var scrollVersion = 0L
  private var capturedScrollVersion = 0L
  private var materialVersion = 0L
  private var capturedMaterialVersion = Long.MIN_VALUE
  private var sceneVersion = 0L
  private var capturedSceneVersion = 0L
  private var modalForegroundScrollIgnoredCount = 0L
  private var modalStaticDrawSkipCount = 0L
  private var backgroundPreDrawCount = 0L
  private var backgroundSceneChangeCount = 0L
  private var menuGeometryChangeCount = 0L
  private var menuGeometryRedrawCount = 0L
  private var surfaceGeometryChangeCount = 0L
  private var surfaceGeometryRedrawCount = 0L
  private var pageChangeCount = 0L
  private var stalePageFrameCount = 0L
  private var isolatedPageCaptureCount = 0L
  private var contentCaptureCount = 0L
  private var ownRedrawsToSkip = 0
  private var captureFailed = false
  private var captureCount = 0L
  private var preDrawCount = 0L
  private var ownRedrawSkipCount = 0L
  private var throttledDrawCount = 0L
  private var delayedCaptureCount = 0L
  private var hostRestoreCount = 0L
  private var asyncCaptureCount = 0L
  private var droppedFrameCount = 0L
  private var inFlightSkipCount = 0L
  private var inFlightPeak = 0
  private var captureRecreateCount = 0L
  private var discardedGenerationCount = 0L
  private var asyncPublishedCount = 0L
  private var deliveryLatencyTotalNanos = 0L
  private var deliveryLatencyMaxNanos = 0L
  private val publishIntervals = LongArray(256)
  private var publishIntervalCount = 0
  private var publishIntervalIndex = 0
  private var lastPublishNanos = 0L
  private var fenceTimeoutCount = 0L
  private var scrollCaptureCount = 0L
  private var captureAttemptCount = 0L
  private var captureCpuTotalNanos = 0L
  private var captureCpuMaxNanos = 0L
  // Fixed per-window counters; recording a phase never allocates a map or logs.
  private val capturePrepareStats = CapturePhaseStats()
  private val sourceRecordStats = CapturePhaseStats()
  private val atlasRecordStats = CapturePhaseStats()
  private val renderSyncAndDrawStats = CapturePhaseStats()
  private var lastDiagnosticLog = 0L
  private val diagnosticId = System.identityHashCode(root)
  private val backgroundScrollListener = ViewTreeObserver.OnScrollChangedListener {
    if (!closed && !WindowBackdrops.isCapturing) markScrollChanged()
  }
  private val backgroundPreDrawListener = ViewTreeObserver.OnPreDrawListener {
    if (!closed && !captureFailed && !WindowBackdrops.isCapturing && isolatesModalForeground() &&
      activityDecor != null) {
      backgroundPreDrawCount++
      observeBackgroundScene(activityDecor)
    }
    true
  }
  private var failureClass: String? = null

  private class CapturePhaseStats {
    var count = 0L
      private set
    var totalNanos = 0L
      private set
    var maxNanos = 0L
      private set

    fun record(elapsedNanos: Long) {
      count++
      totalNanos += elapsedNanos
      maxNanos = maxOf(maxNanos, elapsedNanos)
    }
  }

  private inline fun <T> timeCapturePhase(stats: CapturePhaseStats, block: () -> T): T {
    val started = SystemClock.elapsedRealtimeNanos()
    try {
      return block()
    } finally {
      stats.record(SystemClock.elapsedRealtimeNanos() - started)
    }
  }
  @Volatile private var closed = false
  @Volatile private var generation = 0L
  private var delayedCapturePosted = false
  private val delayedCapture = Runnable {
    delayedCapturePosted = false
    if (!closed && root.isAttachedToWindow) {
      delayedCaptureCount++
      root.invalidate()
    }
  }
  // Two finite observations do not invalidate views or request GPU frames.
  private val diagnosticLog = Runnable { if (!closed) logCounters() }
  private val captureWatchdog = Runnable {
    val oldest = inFlightTickets.firstOrNull()
    if (!closed && oldest != null &&
      SystemClock.uptimeMillis() - oldest.submittedAt >= IMAGE_DELIVERY_TIMEOUT_MS) {
      droppedFrameCount++
      failCapture(IllegalStateException("GPU image delivery timeout"))
    } else updateCaptureWatchdog()
  }

  private class PendingCapture(
    val generation: Long,
    val source: ImageReader,
    val scale: Float,
    val screenX: Int,
    val screenY: Int,
    val progressiveBlur: ProgressiveBlurStamp?,
    val mainPixelWidth: Int,
    val mainPixelHeight: Int,
    val unblurredPatch: UnblurredBackdropPatch?,
    val targets: List<LiquidGlassView>,
    val pageEpoch: Long,
    val submittedAt: Long,
    val submittedAtNanos: Long
  )

  private data class AsyncImageResult(
    val frame: BackdropFrame? = null,
    val failure: Exception? = null,
    val fenceTimedOut: Boolean = false
  )

  var frame: BackdropFrame? = null
    private set
  val isEmpty get() = surfaces.isEmpty()

  fun add(surface: LiquidGlassView) {
    surfaces.add(surface)
    nativePage.retryMissingStack()
    observeNativePage()
    materialVersion++
    requestFrameClock()
    if (surfaces.size == 1) {
      root.viewTreeObserver.addOnPreDrawListener(this)
      root.viewTreeObserver.addOnScrollChangedListener(this)
      if (activityDecor !== root && activityDecor?.isAttachedToWindow == true) {
        activityDecor.viewTreeObserver.addOnScrollChangedListener(backgroundScrollListener)
        activityDecor.viewTreeObserver.addOnPreDrawListener(backgroundPreDrawListener)
      }
      root.postDelayed(diagnosticLog, 2_000L)
      root.postDelayed(diagnosticLog, 8_000L)
    }
    root.invalidate()
  }

  fun remove(surface: LiquidGlassView) {
    surfaces.remove(surface)
    surfaceGeometry.forget(surface)
    materialVersion++
    root.invalidate()
  }

  fun onMaterialChanged() {
    materialVersion++
    requestFrameClock()
    root.invalidate()
  }

  /** Invalidate displayed pixels, retaining their buffers until newer frames retire them. */
  private fun observeNativePage() {
    val source = activityDecor?.takeIf { it.isAttachedToWindow } ?: root
    if (!nativePage.observe(source)) return
    pageChangeCount++
    frame = null
    notifyBackdropDrawingChanged(surfaces)
    sceneVersion++
    ownRedrawsToSkip = 0
    requestFrameClock()
    root.invalidate()
  }

  override fun onScrollChanged() {
    if (isolatesModalForeground() && findMenuScrim() != null) {
      modalForegroundScrollIgnoredCount++
      return
    }
    markScrollChanged()
  }

  private fun markScrollChanged() {
    // Actual content movement must not be mistaken for a Compose/property redraw.
    scrollVersion++
    requestFrameClock()
  }

  private fun isolatesModalForeground(): Boolean = activityDecor != null && activityDecor !== root &&
    surfaces.isNotEmpty() && surfaces.all { it.isolateModalForeground }

  /** Called before another window captures, or before the Activity's normal draw. */
  fun observeBackgroundScene(source: View) {
    if (closed || captureFailed || WindowBackdrops.isCapturing || activityDecor !== source ||
      !isolatesModalForeground()) return
    // Omitted wrapper dirty flags cannot become a two-window feedback loop.
    if (backgroundChanges.hasChanged(source)) {
      backgroundSceneChangeCount++
      sceneVersion++
      requestFrameClock()
      root.invalidate()
    }
  }

  private fun findMenuScrim(): View? {
    val cached = menuScrimReference?.get()
    if (cached != null && cached.isAttachedToWindow && cached.rootView === root) return cached
    menuScrimReference = null
    val found = ReactFindViewUtil.findView(root, MENU_SCRIM_NATIVE_ID) ?: return null
    if (!found.isAttachedToWindow || found.rootView !== root) return null
    menuScrimReference = WeakReference(found)
    return found
  }

  /** Includes ancestor transforms, not only the material's rounded screen origin. */
  private fun surfaceGeometryFingerprint(surface: LiquidGlassView): Long {
    surface.getMaterialBoundsOnScreen(screenRect)
    var signature = screenRect.left.toLong()
    signature = signature * 31L + screenRect.top
    signature = signature * 31L + screenRect.right
    signature = signature * 31L + screenRect.bottom
    surfaceGeometryMatrix.reset()
    surface.transformMatrixToGlobal(surfaceGeometryMatrix)
    surfaceGeometryMatrix.getValues(surfaceGeometryMatrixValues)
    for (value in surfaceGeometryMatrixValues) signature = signature * 31L + value.toRawBits()
    return signature
  }

  /** Null means the overlay is unknown; false means its captured scene stayed static. */
  private fun updateMenuGeometry(): Boolean? {
    val scrim = findMenuScrim() ?: run {
      menuGeometrySignature = null
      return null // Unknown overlay: retain ordinary capture scheduling.
    }
    var signature = menuGeometry.properties(root)
    signature = signature * 31L + menuGeometry.properties(scrim)
    if (signature != menuGeometrySignature) {
      menuGeometrySignature = signature
      menuGeometryChangeCount++
      return true
    }
    return false
  }

  private fun requestFrameClock() {
    if (!closed && !frameClockPosted) {
      frameClockPosted = true
      choreographer.postFrameCallback(frameClock)
    }
  }

  override fun onPreDraw(): Boolean {
    preDrawCount++
    if (closed || captureFailed || WindowBackdrops.isCapturing) return true
    observeNativePage()
    if (!nativePage.policy.captureAllowed) return true
    val now = SystemClock.uptimeMillis()
    val visible = surfaces.filter { isMaterialVisible(it, screenRect) }
    // A parent can move while the cached image stays valid or both GPU slots
    // are occupied. Re-record only moved materials before any scheduling skip.
    val geometryChanged = surfaceGeometry.update(visible, surfaceGeometryObserver)
    if (geometryChanged) surfaceGeometryChangeCount++
    val menuSceneChanged = if (isolatesModalForeground()) updateMenuGeometry() else {
      menuGeometrySignature = null
      null
    }
    if (geometryChanged || menuSceneChanged == true) {
      sceneVersion++
      requestFrameClock()
    }
    val isolatedSceneKnown = menuSceneChanged != null
    val scrollDirty = scrollVersion != capturedScrollVersion
    val materialDirty = materialVersion != capturedMaterialVersion
    val sceneDirty = sceneVersion != capturedSceneVersion
    if (isolatedSceneKnown && frame != null && !scrollDirty && !materialDirty && !sceneDirty) {
      // Foreground scrolling does not change the omitted card's background.
      // Do not leave the old 42ms idle request waking this otherwise static scene.
      root.removeCallbacks(delayedCapture)
      delayedCapturePosted = false
      modalStaticDrawSkipCount++
      return true
    }
    // Restoring Android properties and applying Compose snapshot changes can
    // arrive in separate traversals. Neither should schedule a trailing capture.
    if (ownRedrawsToSkip > 0 && !scrollDirty && !materialDirty && !sceneDirty) {
      ownRedrawsToSkip--
      ownRedrawSkipCount++
      return true
    }
    if (visible.isEmpty() || !root.isHardwareAccelerated || root.width == 0 || root.height == 0) return true
    // Leave capacity for both already-submitted results and final displayed
    // frames on teardown. Normally the image thread drains long before this.
    if (asynchronous && retiredImages.size >= MAX_RETIRED_IMAGES - MAX_IN_FLIGHT - 2) {
      retirementBackpressureCount++
      scheduleRetirementDrain()
      requestFrameClock()
      return true
    }
    if (inFlightTickets.size >= MAX_IN_FLIGHT) {
      inFlightSkipCount++
      return true
    }
    val vsyncNanos = currentFrameTimeNanos
    val displayDirty = scrollDirty || materialDirty || sceneDirty
    if (displayDirty && vsyncNanos == lastCaptureVsyncNanos) {
      requestFrameClock()
      return true
    }
    // Scrolling or changed native material geometry samples once per VSync
    // (120 Hz -> 8.33 ms,
    // 60 Hz -> 16.67 ms). Comparing VSync IDs/timestamps avoids a rounded 8/9 ms
    // timer accidentally skipping alternating 120 Hz frames. This also keeps
    // the progressive mask aligned during the dock's spring after drag ends.
    // Only idle draws
    // use the 42 ms limiter; the two-image pipeline supplies GPU backpressure.
    val remaining = if (displayDirty) 0L else MIN_FRAME_MS - (now - lastCapture)
    if (remaining > 0) {
      throttledDrawCount++
      if (!delayedCapturePosted) {
        delayedCapturePosted = true
        root.postDelayed(delayedCapture, remaining)
      }
      return true
    }
    // A previous trailing request is obsolete once a current frame is captured.
    root.removeCallbacks(delayedCapture)
    delayedCapturePosted = false
    lastCapture = now
    val captureStarted = SystemClock.elapsedRealtimeNanos()
    captureAttemptCount++
    try {
      val captured = capture(visible, scrollVersion, materialVersion, sceneVersion, vsyncNanos, scrollDirty)
      if (asynchronous || captured != null) ownRedrawsToSkip = OWN_REDRAW_TRAVERSALS
      if (captured != null) publishFrame(captured, visible)
    } catch (exception: RuntimeException) {
      failCapture(exception)
    } finally {
      val elapsed = SystemClock.elapsedRealtimeNanos() - captureStarted
      captureCpuTotalNanos += elapsed
      captureCpuMaxNanos = maxOf(captureCpuMaxNanos, elapsed)
      if (now - lastDiagnosticLog >= 2_000L) logCounters()
    }
    return true
  }

  private fun capture(
    visible: List<LiquidGlassView>,
    submittedScrollVersion: Long,
    submittedMaterialVersion: Long,
    submittedSceneVersion: Long,
    vsyncNanos: Long,
    isScrollCapture: Boolean
  ): BackdropFrame? {
    val preparationStarted = SystemClock.elapsedRealtimeNanos()
    var preparationEnded = 0L
    try {
      root.getLocationOnScreen(location)
      updateCaptureRect(visible)
      val edge = visible.firstOrNull { it.progressiveBlur }
      val activityWindow = activityDecor == null || activityDecor === root
      // ScreenStack can still draw disappearing Home siblings after assigning
      // a new top. For an opaque page with no transition, drawing that exact
      // native page prevents those covers entering a new-page capture. Keep the
      // original composition for animations, player reveals and dialog windows.
      val isolatedTop = if (activityWindow) nativePage.isolatedOpaqueSource() else null
      // The Stack host deliberately excludes global dock/Compose consumers.
      // Sampling DecorView and making them alpha-zero still lets Android prepare
      // their cached GPU layers. Use the host for ordinary scrolling as well as
      // the optional progressive edge, while retaining its complete fade stack.
      val stackContent = if (activityWindow && isolatedTop == null) findContentSource() else null
      // The host is transparent. Preserve the opaque theme underlay during a
      // Stack fade; an unknown/custom ancestor retains the original root path.
      val contentUnderlay = stackContent?.let { findContentUnderlayColor(it) }
      val captureSource = selectBackdropCaptureSource(root, activityWindow, isolatedTop,
        stackContent?.takeIf { contentUnderlay != null })
      if (isolatedTop != null) isolatedPageCaptureCount++
      if (captureSource === stackContent) contentCaptureCount++
      // The edge's shader clamps atlas sampling on API 33+. Earlier releases
      // keep the original one-region path and their existing Gaussian fallback.
      val rawMaterial = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && edge != null)
        visible.firstOrNull { it.preferUnblurredBackdrop } else null
      rawRect.setEmpty()
      if (rawMaterial != null) {
        rawMaterial.getMaterialBoundsOnScreen(rawRect)
        val padding = ceil((rawMaterial.blurRadius * 2f + abs(rawMaterial.refraction) +
          abs(rawMaterial.refractionHeight ?: (rawMaterial.refraction * 0.65f)) +
          RAW_MOTION_GUARD_DP) * root.resources.displayMetrics.density).toInt()
        rawRect.inset(-padding, -padding)
        rawRect.offset(-location[0], -location[1])
        if (!rawRect.intersect(0, 0, root.width, root.height)) rawRect.setEmpty()
        captureRect.union(rawRect)
        clampCaptureRect()
      }
      val scale = minOf(0.5f, MAX_SAMPLE_WIDTH / root.width.toFloat())
      // Quantization keeps animated bounds from reallocating a Surface every pixel.
      val width = quantize(ceil(captureRect.width() * scale).toInt(), SAMPLE_SIZE_STEP)
      val requestedMainHeight = quantize(ceil(captureRect.height() * scale).toInt(), SAMPLE_SIZE_STEP)
      val originX = location[0] + captureRect.left
      val originY = location[1] + captureRect.top
      val rawSampleX = floor((rawRect.left - captureRect.left) * scale).toInt().coerceAtLeast(0)
      val rawSampleY = floor((rawRect.top - captureRect.top) * scale).toInt().coerceAtLeast(0)
      val rawSampleWidth = if (rawMaterial != null && !rawRect.isEmpty)
        ceil((rawRect.right - captureRect.left) * scale).toInt() - rawSampleX else 0
      val rawSampleHeight = if (rawMaterial != null && !rawRect.isEmpty)
        ceil((rawRect.bottom - captureRect.top) * scale).toInt() - rawSampleY else 0
      val hasRawPatch = rawSampleWidth > 0 && rawSampleHeight > 0
      val height = if (hasRawPatch)
        quantize(requestedMainHeight + ATLAS_GUARD_ROWS + rawSampleHeight, SAMPLE_SIZE_STEP) else requestedMainHeight
      val now = SystemClock.uptimeMillis()
      // Keep capacity during moving/elastic bounds, but do not carry a full-page
      // Surface into a small bottom dock for the rest of the session. Clearing
      // and presenting the unused capacity still costs GPU time on every frame.
      val oversized = reader != null && width <= pixelWidth && height <= pixelHeight &&
        pixelWidth.toLong() * pixelHeight >= width.toLong() * height * 2L
      if (!oversized) {
        shrinkSince = 0L
      } else if (shrinkSince == 0L || shrinkWidth != width || shrinkHeight != height) {
        shrinkWidth = width
        shrinkHeight = height
        shrinkSince = now
      }
      val shrink = oversized && now - shrinkSince >= CAPACITY_SHRINK_SETTLE_MS
      if (reader == null || width > pixelWidth || height > pixelHeight || shrink) {
        // Do not invalidate metadata for a frame currently being produced merely
        // because the next ROI changed. Its completion will schedule the dirty tail.
        if (inFlightTickets.isNotEmpty()) {
          inFlightSkipCount++
          return null
        }
        releaseCapture(keepDisplayedFrames = true)
        captureRecreateCount++
        if (shrink) captureShrinkCount++
        shrinkSince = 0L
        pixelWidth = width
        pixelHeight = height
        reader = ImageReader.newInstance(
          width, height, PixelFormat.RGBA_8888, if (asynchronous) 6 else 4,
          HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE or HardwareBuffer.USAGE_GPU_COLOR_OUTPUT
        )
        renderNode = RenderNode("Resonus shared backdrop").apply {
          setPosition(0, 0, width, height)
        }
        renderer = HardwareRenderer().apply {
          setSurface(reader!!.surface)
          setContentRoot(renderNode!!)
          setOpaque(false)
        }
        if (asynchronous) {
          val readerGeneration = generation
          reader!!.setOnImageAvailableListener(
            { source -> consumeAsyncImage(source, readerGeneration) }, imageHandler
          )
        }
      }
      val node = renderNode ?: return null
      val source = reader ?: return null
      val mainHeight = if (hasRawPatch) requestedMainHeight else pixelHeight
      val patch = if (hasRawPatch) UnblurredBackdropPatch(rawMaterial!!.progressiveMaterialId,
        originX + rawSampleX / scale, originY + rawSampleY / scale,
        rawSampleWidth, rawSampleHeight, 0, mainHeight + ATLAS_GUARD_ROWS) else null
      val processed = edge?.let {
        it.getMaterialBoundsOnScreen(progressiveRect)
        progressiveEffect.get(pixelWidth, mainHeight,
          (progressiveRect.top - originY) * scale, progressiveRect.height() * scale,
          it.blurRadius * root.resources.displayMetrics.density * scale,
          it.progressiveMaterialId, it.blurRadius, it.tintColor, it.tintOpacity,
          progressiveRect.top, progressiveRect.height())
      }
      // One low-resolution graph on the existing producer; every material samples
      // the same processed frame. No visible edge restores the original raw path.
      val recordingNode = if (patch != null) {
        val raw = rawSourceNode ?: RenderNode("Resonus raw backdrop source").also { rawSourceNode = it }
        raw.setPosition(0, 0, pixelWidth, mainHeight)
        raw.setClipToBounds(true)
        val filtered = processedSourceNode ?: RenderNode("Resonus processed backdrop source").also { processedSourceNode = it }
        filtered.setPosition(0, 0, pixelWidth, mainHeight)
        filtered.setClipToBounds(true)
        filtered.setRenderEffect(processed?.effect)
        node.setRenderEffect(null)
        raw
      } else {
        node.setRenderEffect(processed?.effect)
        node
      }
      if (asynchronous) {
        val ticket = PendingCapture(generation, source, scale, originX, originY, processed?.stamp,
          pixelWidth, mainHeight, patch, visible, nativePage.policy.epoch,
          SystemClock.uptimeMillis(), SystemClock.elapsedRealtimeNanos())
        inFlightTickets.add(ticket)
        synchronized(ticketLock) { queuedTickets.addLast(ticket) }
        inFlightPeak = maxOf(inFlightPeak, inFlightTickets.size)
        updateCaptureWatchdog()
      }
      preparationEnded = SystemClock.elapsedRealtimeNanos()
      val syncResult = WindowBackdrops.withoutGlass(root, activityDecor, captureSource) {
        // Reuse the buffer's capacity when the ROI shrinks or shifts. Progressive
        // Gaussian needs opaque padding: transparent unused rows would lower its
        // alpha at the screen bottom and expose sharp raw content underneath.
        // Ordinary materials retain their original transparent capture path.
        timeCapturePhase(sourceRecordStats) {
          val canvas = recordingNode.beginRecording(pixelWidth, mainHeight)
          try {
            if (processed != null) {
              val background = processed.stamp.tintColor
              canvas.drawColor(Color.rgb(Color.red(background), Color.green(background), Color.blue(background)), PorterDuff.Mode.SRC)
            } else {
              canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
            }
            canvas.scale(scale, scale)
            canvas.translate(-captureRect.left.toFloat(), -captureRect.top.toFloat())
            canvas.clipRect(captureRect)
            if (captureSource === stackContent && contentUnderlay != null) canvas.drawColor(contentUnderlay)
            // A transparent React Native Modal lives in a second window. Include
            // the Activity's actual screen behind it before drawing the modal.
            if (activityDecor != null && activityDecor !== root && activityDecor.isAttachedToWindow) {
              activityDecor.getLocationOnScreen(activityLocation)
              val checkpoint = canvas.save()
              canvas.translate(
                (activityLocation[0] - location[0]).toFloat(),
                (activityLocation[1] - location[1]).toFloat()
              )
              activityDecor.draw(canvas)
              canvas.restoreToCount(checkpoint)
            }
            if (captureSource === root) root.draw(canvas) else {
              captureSource.getLocationOnScreen(contentLocation)
              canvas.translate((contentLocation[0] - location[0]).toFloat(),
                (contentLocation[1] - location[1]).toFloat())
              captureSource.draw(canvas)
            }
          } finally {
            recordingNode.endRecording()
          }
        }
        if (patch != null) {
          timeCapturePhase(atlasRecordStats) {
            // Replay the already-recorded scene; never draw the Android root twice.
            // Only this wrapper carries the edge effect, leaving the raw node raw.
            val filtered = processedSourceNode!!
            val filteredCanvas = filtered.beginRecording(pixelWidth, mainHeight)
            try { filteredCanvas.drawRenderNode(recordingNode) } finally { filtered.endRecording() }
            val atlasCanvas = node.beginRecording(pixelWidth, pixelHeight)
            try {
              val background = processed!!.stamp.tintColor
              atlasCanvas.drawColor(Color.rgb(Color.red(background), Color.green(background), Color.blue(background)), PorterDuff.Mode.SRC)
              var checkpoint = atlasCanvas.save()
              atlasCanvas.clipRect(0, 0, pixelWidth, mainHeight)
              atlasCanvas.drawRenderNode(filtered)
              atlasCanvas.restoreToCount(checkpoint)
              checkpoint = atlasCanvas.save()
              atlasCanvas.clipRect(patch.atlasX, patch.atlasY,
                patch.atlasX + patch.pixelWidth, patch.atlasY + patch.pixelHeight)
              atlasCanvas.translate((patch.atlasX - rawSampleX).toFloat(), (patch.atlasY - rawSampleY).toFloat())
              atlasCanvas.drawRenderNode(recordingNode)
              atlasCanvas.restoreToCount(checkpoint)
            } finally { node.endRecording() }
          }
        }
        // syncAndDraw synchronizes staging properties into RenderThread before
        // returning. Restoring transition alpha afterwards changes UI staging,
        // while this submitted tree retains the excluded wrappers. API 33+ waits
        // for the produced buffer's fence off the UI thread instead of blocking
        // the window's pre-draw until offscreen presentation has completed.
        timeCapturePhase(renderSyncAndDrawStats) {
          val request = renderer!!.createRenderRequest().setWaitForPresent(!asynchronous)
          if ((isScrollCapture || submittedMaterialVersion != capturedMaterialVersion ||
              submittedSceneVersion != capturedSceneVersion) && vsyncNanos > 0L) {
            request.setVsyncTime(vsyncNanos)
          }
          request.syncAndDraw()
        }
      }
      // syncAndDraw can report a lost/stopped renderer without throwing. Treat
      // those flags like driver exceptions, but retain the current frame for an
      // ordinary dropped frame. REDRAW_REQUESTED remains a successful capture.
      val fatalFlags = HardwareRenderer.SYNC_LOST_SURFACE_REWARD_IF_FOUND or
        HardwareRenderer.SYNC_CONTEXT_IS_STOPPED
      if ((syncResult and fatalFlags) != 0) throw GpuCaptureUnavailable(syncResult)
      if ((syncResult and HardwareRenderer.SYNC_FRAME_DROPPED) != 0) {
        droppedFrameCount++
        if (!asynchronous) return null
        // A dropped request can be retried after the main window has restored
        // shared RenderNode alpha, and a later request can replace that retry.
        // Neither its content nor FIFO image count is reliable. Discard the whole
        // producer generation; retained displayed images stay valid until replaced.
        discardedGenerationCount++
        releaseCapture(keepDisplayedFrames = true)
        capturedMaterialVersion = Long.MIN_VALUE
        requestFrameClock()
        root.invalidate()
        return null
      }
      if (asynchronous) {
        asyncCaptureCount++
        recordSubmission(submittedScrollVersion, submittedMaterialVersion, submittedSceneVersion, vsyncNanos, isScrollCapture)
        return null
      }
      val image = source.acquireLatestImage() ?: return null
      val bitmap = wrapImage(image)
      if (bitmap == null) {
        image.close()
        return null
      }
      recordSubmission(submittedScrollVersion, submittedMaterialVersion, submittedSceneVersion, vsyncNanos, isScrollCapture)
      return BackdropFrame(bitmap, image, scale, originX, originY, source, processed?.stamp,
        pixelWidth, mainHeight, patch, nativePage.policy.epoch)
    } finally {
      // Include partial preparation when a resize is deferred or setup throws.
      val ended = if (preparationEnded != 0L) preparationEnded else SystemClock.elapsedRealtimeNanos()
      capturePrepareStats.record(ended - preparationStarted)
    }
  }

  private fun findContentSource(): View? {
    val cached = contentSourceReference?.get()
    if (cached != null && cached.isAttachedToWindow && cached.rootView === root &&
      cached.isShown && cached.width > 0 && cached.height > 0) return cached
    contentSourceReference = null
    val found = ReactFindViewUtil.findView(root, CONTENT_NATIVE_ID) ?: return null
    if (!found.isAttachedToWindow || !found.isShown || found.width <= 0 || found.height <= 0) return null
    contentSourceReference = WeakReference(found)
    return found
  }

  private fun findContentUnderlayColor(content: View): Int? {
    var ancestor = content.parent as? View
    while (ancestor != null) {
      val background = ancestor.background
      val color = (background as? ColorDrawable)?.color ?: BackgroundStyleApplicator.getBackgroundColor(ancestor)
      if (color != null && Color.alpha(color) == 255) return color
      // Do not flatten a gradient/image or translucent ancestor into an
      // unrelated opaque color found farther up the window hierarchy.
      if (background != null && !(background is ColorDrawable && background.alpha == 0)) return null
      ancestor = ancestor.parent as? View
    }
    return null
  }

  private fun recordSubmission(
    submittedScrollVersion: Long,
    submittedMaterialVersion: Long,
    submittedSceneVersion: Long,
    vsyncNanos: Long,
    isScrollCapture: Boolean
  ) {
    capturedScrollVersion = submittedScrollVersion
    capturedMaterialVersion = submittedMaterialVersion
    capturedSceneVersion = submittedSceneVersion
    lastCaptureVsyncNanos = vsyncNanos
    if (isScrollCapture) scrollCaptureCount++
  }

  private fun updateCaptureRect(visible: List<LiquidGlassView>) {
    captureRegion.clear()
    val density = root.resources.displayMetrics.density
    visible.forEach { surface ->
      val padding = ceil((surface.blurRadius * 2f + abs(surface.refraction) +
        abs(surface.refractionHeight ?: (surface.refraction * 0.65f)) + 4f) * density).toInt()
      surface.getMaterialBoundsOnScreen(screenRect)
      captureRegion.include(screenRect.left - location[0], screenRect.top - location[1],
        screenRect.right - location[0], screenRect.bottom - location[1], padding)
      val pressed = AmPlusSelectionMotion.isInteracting(surface.tabPressProgress, surface.tabScaleX,
        surface.tabScaleY, surface.tabVelocity, surface.tabPanelOffset) || surface.buttonPressProgress > .001f
      if (retainBackdropHostBounds(surface.dockCompactWidth > 0f, surface.dockProgress, pressed)) {
        // Never crop an enlarged pressed lens, moving outline, or shadow by
        // tightening the source to an intermediate layout's optical rectangle.
        surface.getLocationOnScreen(surfaceLocation)
        val left = surfaceLocation[0] - location[0]
        val top = surfaceLocation[1] - location[1]
        captureRegion.include(left, top, left + surface.width, top + surface.height, padding)
      }
    }
    if (captureRegion.empty) captureRect.setEmpty() else
      captureRect.set(captureRegion.left, captureRegion.top, captureRegion.right, captureRegion.bottom)
    clampCaptureRect()
  }

  private fun clampCaptureRect() {
    captureRect.intersect(0, 0, root.width, root.height)
    captureRect.left = (captureRect.left / ROI_POSITION_STEP) * ROI_POSITION_STEP
    captureRect.top = (captureRect.top / ROI_POSITION_STEP) * ROI_POSITION_STEP
    captureRect.right = minOf(root.width, quantize(captureRect.right, ROI_POSITION_STEP))
    captureRect.bottom = minOf(root.height, quantize(captureRect.bottom, ROI_POSITION_STEP))
  }

  /** Only this Handler consumes/cleans up readers while a fence is pending. */
  private fun consumeAsyncImage(source: ImageReader, readerGeneration: Long) {
    while (true) {
      // Closing on this same thread removes the ImageReader monitor race with
      // nativeImageSetup. Drain first so deferred releases cannot exhaust the
      // reader's maxImages=6 before the next acquire.
      drainRetiredImages()
      // Next, not latest: discarding an image here would shift every subsequent
      // immutable ticket's source origin/scale onto the wrong GPU buffer.
      val image = try {
        source.acquireNextImage() ?: return
      } catch (exception: Exception) {
        val ticket = claimTicket(source, readerGeneration) ?: return
        mainHandler.post { completeAsyncImage(ticket, AsyncImageResult(failure = exception)) }
        return
      }
      val ticket = claimTicket(source, readerGeneration)
      if (ticket == null) {
        image.close()
        continue
      }
      val result = try {
        prepareAsyncImage(image, ticket)
      } catch (exception: Exception) {
        // Image.getFence may throw IOException, unlike the synchronous APIs.
        AsyncImageResult(failure = exception)
      }
      if (result.frame == null) image.close()
      if (!mainHandler.post { completeAsyncImage(ticket, result) }) {
        result.frame?.image?.close()
      }
    }
  }

  private fun claimTicket(source: ImageReader, readerGeneration: Long): PendingCapture? =
    synchronized(ticketLock) {
      if (closed || generation != readerGeneration || queuedTickets.peekFirst()?.source !== source) null
      else queuedTickets.removeFirst()
    }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun prepareAsyncImage(image: Image, ticket: PendingCapture): AsyncImageResult {
    val ready = image.fence.use { !it.isValid || it.await(Duration.ofMillis(FENCE_WAIT_MS)) }
    if (!ready) return AsyncImageResult(fenceTimedOut = true)
    val bitmap = wrapImage(image) ?: return AsyncImageResult()
    return AsyncImageResult(BackdropFrame(bitmap, image, ticket.scale, ticket.screenX, ticket.screenY,
      ticket.source, ticket.progressiveBlur, ticket.mainPixelWidth, ticket.mainPixelHeight,
      ticket.unblurredPatch, ticket.pageEpoch))
  }

  private fun completeAsyncImage(ticket: PendingCapture, result: AsyncImageResult) {
    if (closed || generation != ticket.generation || !inFlightTickets.remove(ticket)) {
      result.frame?.image?.let { retireImage(it) }
      return
    }
    updateCaptureWatchdog()
    // A Fragment swap can finish after the capture was queued but before the
    // next pre-draw. Observe native identity here too, before accepting pixels.
    observeNativePage()
    if (!nativePage.policy.accepts(ticket.pageEpoch)) {
      stalePageFrameCount++
      result.frame?.image?.let { retireImage(it) }
      requestFrameClock()
      root.invalidate()
      return
    }
    if (result.failure != null) {
      failCapture(result.failure)
      return
    }
    if (result.frame != null) {
      asyncPublishedCount++
      val latency = SystemClock.elapsedRealtimeNanos() - ticket.submittedAtNanos
      deliveryLatencyTotalNanos += latency
      deliveryLatencyMaxNanos = maxOf(deliveryLatencyMaxNanos, latency)
      ownRedrawsToSkip = OWN_REDRAW_TRAVERSALS
      publishFrame(result.frame, ticket.targets)
    } else {
      droppedFrameCount++
      if (result.fenceTimedOut) fenceTimeoutCount++
      // Retain the current image on a dropped/slow frame and try the next draw.
      capturedMaterialVersion = Long.MIN_VALUE
      ownRedrawsToSkip = 0
      requestFrameClock()
      root.invalidate()
    }
    if ((scrollVersion != capturedScrollVersion || materialVersion != capturedMaterialVersion ||
        sceneVersion != capturedSceneVersion) &&
      root.isAttachedToWindow) {
      requestFrameClock()
      root.invalidate()
    }
  }

  private fun updateCaptureWatchdog() {
    mainHandler.removeCallbacks(captureWatchdog)
    if (!closed) inFlightTickets.firstOrNull()?.let { oldest ->
      val remaining = IMAGE_DELIVERY_TIMEOUT_MS - (SystemClock.uptimeMillis() - oldest.submittedAt)
      mainHandler.postDelayed(captureWatchdog, remaining.coerceAtLeast(1L))
    }
  }

  private fun wrapImage(image: Image): Bitmap? {
    val buffer = image.hardwareBuffer
    if (buffer == null) return null
    return try {
      Bitmap.wrapHardwareBuffer(buffer, ColorSpace.get(ColorSpace.Named.SRGB))
    } finally {
      buffer.close()
    }
  }

  private fun retireImage(image: Image) {
    val handler = imageHandler
    if (handler == null || Thread.currentThread() === imageThread) {
      image.close()
      return
    }
    if (!retiredImages.offer(image)) {
      // A bounded safety valve for exceptional generation/shutdown races.
      // Capture backpressure reserves four slots, so normal publication never
      // reaches this branch. Ownership must not leak even if the worker stops.
      retirementFallbackCount.incrementAndGet()
      image.close()
      return
    }
    retirementPeak = maxOf(retirementPeak, retiredImages.size)
    scheduleRetirementDrain()
  }

  private fun scheduleRetirementDrain() {
    val handler = imageHandler ?: return
    if (!retirementDrainPosted.compareAndSet(false, true)) return
    if (!handler.post(retirementDrain)) {
      retirementDrainPosted.set(false)
      // quitSafely has already drained its reader work. A late stale result
      // still needs cleanup after the looper has rejected further messages.
      retirementFallbackCount.incrementAndGet()
      drainRetiredImages()
    }
  }

  private fun drainRetiredImages() {
    while (true) {
      val image = retiredImages.poll() ?: return
      try { image.close() } catch (_: Exception) {
        retirementCloseFailureCount.incrementAndGet()
      }
    }
  }

  private fun publishFrame(captured: BackdropFrame, targets: List<LiquidGlassView>) {
    if (!nativePage.policy.accepts(captured.pageEpoch)) {
      stalePageFrameCount++
      retireImage(captured.image)
      return
    }
    val publishedAt = SystemClock.elapsedRealtimeNanos()
    if (lastPublishNanos != 0L) {
      publishIntervals[publishIntervalIndex] = publishedAt - lastPublishNanos
      publishIntervalIndex = (publishIntervalIndex + 1) % publishIntervals.size
      publishIntervalCount = minOf(publishIntervalCount + 1, publishIntervals.size)
    }
    lastPublishNanos = publishedAt
    captureCount++
    if (captureCount == 1L) {
      Log.i("ResonusGlass", "GPU backdrop active (${pixelWidth}x${pixelHeight}, ${targets.size} visible materials, async=$asynchronous)")
    }
    frame = captured
    frames.addLast(captured)
    // Keep both sampled images alive; maxImages=6 also covers both pipeline
    // results that the worker has prepared but the UI has not published yet.
    while (frames.size > 2) retireImage(frames.removeFirst().image)
    closeUnusedReaders()
    notifyBackdropDrawingChanged(targets.filter { isMaterialVisible(it, screenRect) })
  }

  private fun notifyBackdropDrawingChanged(targets: Iterable<LiquidGlassView>) {
    targets.forEach { if (it.onBackdropFrame()) hostRestoreCount++ }
    // Image delivery and page invalidation can occur after Compose's frame
    // callback. Apply their draw-state observers together before this window
    // draws, rather than leaving old display lists for another display frame.
    Snapshot.sendApplyNotifications()
    targets.forEach { it.invalidateBackdropDrawing() }
  }

  private fun failCapture(exception: Exception) {
    failureClass = exception.javaClass.simpleName
    Log.w("ResonusGlass", "GPU backdrop unavailable ($failureClass); using material fallback")
    captureFailed = true
    frame = null
    notifyBackdropDrawingChanged(surfaces)
    releaseCapture()
  }

  private fun releaseCapture(keepDisplayedFrames: Boolean = false) {
    synchronized(ticketLock) {
      generation++
      queuedTickets.clear()
    }
    inFlightTickets.clear()
    mainHandler.removeCallbacks(captureWatchdog)
    if (!keepDisplayedFrames) {
      frame = null
      frames.forEach { retireImage(it.image) }
      frames.clear()
    }
    renderer?.destroy()
    renderer = null
    renderNode?.discardDisplayList()
    renderNode = null
    processedSourceNode?.discardDisplayList()
    processedSourceNode = null
    rawSourceNode?.discardDisplayList()
    rawSourceNode = null
    val oldReader = reader
    reader = null
    oldReader?.setOnImageAvailableListener(null, null)
    if (oldReader != null) retiredReaders.add(oldReader)
    closeUnusedReaders()
  }

  private fun closeUnusedReaders() {
    val unused = retiredReaders.filter { source -> frames.none { it.source === source } }
    unused.forEach { source ->
      retiredReaders.remove(source)
      // reader.close invalidates all its Images. Queue cleanup behind any
      // bounded fence wait, and only after displayed frames have been replaced.
      if (imageHandler != null) {
        if (!imageHandler.post { drainRetiredImages(); source.close() }) {
          drainRetiredImages()
          source.close()
        }
      } else source.close()
    }
  }

  fun diagnostics(): Map<String, Any?> {
    val publishIntervalStats = publishIntervalStats()
    return mapOf(
      "captureCount" to captureCount,
      "preDrawCount" to preDrawCount,
      "ownRedrawSkipCount" to ownRedrawSkipCount,
      "throttledDrawCount" to throttledDrawCount,
      "delayedCaptureCount" to delayedCaptureCount,
      "hostRestoreCount" to hostRestoreCount,
      "visibleSurfaces" to surfaces.count { isMaterialVisible(it, screenRect) },
      "sampleWidth" to pixelWidth,
      "sampleHeight" to pixelHeight,
      "sourceWidth" to captureRect.width(),
      "sourceHeight" to captureRect.height(),
      "mainSampleHeight" to (frame?.mainPixelHeight ?: pixelHeight),
      "unblurredPatchActive" to (frame?.unblurredPatch != null),
      "unblurredPatchHeight" to (frame?.unblurredPatch?.pixelHeight ?: 0),
      "progressiveBlurActive" to (frame?.progressiveBlur != null),
      "progressiveEffectBuildCount" to progressiveEffect.buildCount,
      "hasFrame" to (frame != null),
      "failed" to captureFailed,
      "failureClass" to failureClass,
      "isModal" to (activityDecor != null && activityDecor !== root),
      "async" to asynchronous,
      "asyncCaptureCount" to asyncCaptureCount,
      "droppedFrameCount" to droppedFrameCount,
      "inFlightSkipCount" to inFlightSkipCount,
      "inFlightPeak" to inFlightPeak,
      "recreateCount" to captureRecreateCount,
      "shrinkCount" to captureShrinkCount,
      "discardedGenerationCount" to discardedGenerationCount,
      "fenceTimeoutCount" to fenceTimeoutCount,
      "scrollCaptureCount" to scrollCaptureCount,
      "scrollEventCount" to scrollVersion,
      "modalForegroundScrollIgnoredCount" to modalForegroundScrollIgnoredCount,
      "modalStaticDrawSkipCount" to modalStaticDrawSkipCount,
      "backgroundPreDrawCount" to backgroundPreDrawCount,
      "backgroundSceneChangeCount" to backgroundSceneChangeCount,
      "menuGeometryChangeCount" to menuGeometryChangeCount,
      "menuGeometryRedrawCount" to menuGeometryRedrawCount,
      "surfaceGeometryChangeCount" to surfaceGeometryChangeCount,
      "surfaceGeometryRedrawCount" to surfaceGeometryRedrawCount,
      "pageChangeCount" to pageChangeCount,
      "stalePageFrameCount" to stalePageFrameCount,
      "isolatedPageCaptureCount" to isolatedPageCaptureCount,
      "contentCaptureCount" to contentCaptureCount,
      "pageEpoch" to nativePage.policy.epoch,
      "pageCaptureAllowed" to nativePage.policy.captureAllowed,
      "scrollTargetHz" to (root.display?.refreshRate ?: 60f),
      "captureAttemptCount" to captureAttemptCount,
      "captureCpuTotalNs" to captureCpuTotalNanos,
      "captureCpuAvgMs" to captureCpuAverageMs(),
      "captureCpuMaxMs" to (captureCpuMaxNanos / 1_000_000.0),
      "asyncPublishedCount" to asyncPublishedCount,
      "deliveryLatencyTotalNs" to deliveryLatencyTotalNanos,
      "deliveryLatencyAvgMs" to deliveryLatencyAverageMs(),
      "deliveryLatencyMaxMs" to (deliveryLatencyMaxNanos / 1_000_000.0),
      "capturePrepareCount" to capturePrepareStats.count,
      "capturePrepareTotalNs" to capturePrepareStats.totalNanos,
      "capturePrepareMaxNs" to capturePrepareStats.maxNanos,
      "sourceRecordCount" to sourceRecordStats.count,
      "sourceRecordTotalNs" to sourceRecordStats.totalNanos,
      "sourceRecordMaxNs" to sourceRecordStats.maxNanos,
      "atlasRecordCount" to atlasRecordStats.count,
      "atlasRecordTotalNs" to atlasRecordStats.totalNanos,
      "atlasRecordMaxNs" to atlasRecordStats.maxNanos,
      "renderSyncAndDrawCount" to renderSyncAndDrawStats.count,
      "renderSyncAndDrawTotalNs" to renderSyncAndDrawStats.totalNanos,
      "renderSyncAndDrawMaxNs" to renderSyncAndDrawStats.maxNanos,
      "inFlight" to inFlightTickets.isNotEmpty(),
      "inFlightCount" to inFlightTickets.size,
      "retiredImageCount" to retiredImages.size,
      "retiredImagePeak" to retirementPeak,
      "imageRetirementBackpressureCount" to retirementBackpressureCount,
      "imageRetirementFallbackCount" to retirementFallbackCount.get(),
      "imageRetirementCloseFailureCount" to retirementCloseFailureCount.get(),
      "publishIntervalP50Ms" to publishIntervalStats[0],
      "publishIntervalP95Ms" to publishIntervalStats[1]
    )
  }

  private fun logCounters() {
    lastDiagnosticLog = SystemClock.uptimeMillis()
    val publishIntervalStats = publishIntervalStats()
    Log.i("ResonusGlass", "window=$diagnosticId captureCount=$captureCount " +
      "preDrawCount=$preDrawCount ownSkip=$ownRedrawSkipCount " +
      "throttled=$throttledDrawCount delayed=$delayedCaptureCount " +
      "hostRestore=$hostRestoreCount failed=$captureFailed " +
      "async=$asyncCaptureCount dropped=$droppedFrameCount busy=$inFlightSkipCount " +
      "inFlightPeak=$inFlightPeak recreate=$captureRecreateCount shrink=$captureShrinkCount discarded=$discardedGenerationCount " +
      "retiredImages=${retiredImages.size} retiredPeak=$retirementPeak retirementBusy=$retirementBackpressureCount " +
      "retirementFallback=${retirementFallbackCount.get()} retirementFailures=${retirementCloseFailureCount.get()} " +
      "buffer=${pixelWidth}x${pixelHeight} source=${captureRect.width()}x${captureRect.height()} " +
      "fenceTimeout=$fenceTimeoutCount scrollEvents=$scrollVersion scrollFrames=$scrollCaptureCount " +
      "modalForegroundScrollIgnored=$modalForegroundScrollIgnoredCount modalStaticSkip=$modalStaticDrawSkipCount " +
      "backgroundPreDraw=$backgroundPreDrawCount backgroundChanges=$backgroundSceneChangeCount menuGeometryChanges=$menuGeometryChangeCount " +
      "menuGeometryRedraws=$menuGeometryRedrawCount " +
      "surfaceGeometryChanges=$surfaceGeometryChangeCount surfaceGeometryRedraws=$surfaceGeometryRedrawCount " +
      "pageChanges=$pageChangeCount stalePageFrames=$stalePageFrameCount pageEpoch=${nativePage.policy.epoch} isolatedPageCaptures=$isolatedPageCaptureCount contentCaptures=$contentCaptureCount " +
      "scrollTargetHz=${root.display?.refreshRate ?: 60f} " +
      "captureAttemptCount=$captureAttemptCount captureCpuTotalNs=$captureCpuTotalNanos " +
      "cpuAvgMs=${captureCpuAverageMs()} cpuMaxMs=${captureCpuMaxNanos / 1_000_000.0} " +
      "asyncPublishedCount=$asyncPublishedCount deliveryLatencyTotalNs=$deliveryLatencyTotalNanos " +
      "latencyAvgMs=${deliveryLatencyAverageMs()} latencyMaxMs=${deliveryLatencyMaxNanos / 1_000_000.0} " +
      "capturePrepareCount=${capturePrepareStats.count} capturePrepareTotalNs=${capturePrepareStats.totalNanos} capturePrepareMaxNs=${capturePrepareStats.maxNanos} " +
      "sourceRecordCount=${sourceRecordStats.count} sourceRecordTotalNs=${sourceRecordStats.totalNanos} sourceRecordMaxNs=${sourceRecordStats.maxNanos} " +
      "atlasRecordCount=${atlasRecordStats.count} atlasRecordTotalNs=${atlasRecordStats.totalNanos} atlasRecordMaxNs=${atlasRecordStats.maxNanos} " +
      "renderSyncAndDrawCount=${renderSyncAndDrawStats.count} renderSyncAndDrawTotalNs=${renderSyncAndDrawStats.totalNanos} renderSyncAndDrawMaxNs=${renderSyncAndDrawStats.maxNanos} " +
      "publishIntervalP50Ms=${publishIntervalStats[0]} publishIntervalP95Ms=${publishIntervalStats[1]}")
  }

  private fun captureCpuAverageMs(): Double =
    if (captureAttemptCount == 0L) 0.0 else captureCpuTotalNanos / captureAttemptCount / 1_000_000.0

  private fun deliveryLatencyAverageMs(): Double =
    if (asyncPublishedCount == 0L) 0.0 else deliveryLatencyTotalNanos / asyncPublishedCount / 1_000_000.0

  // Sorting is restricted to diagnostics/logging, never the per-frame path.
  private fun publishIntervalStats(): DoubleArray {
    if (publishIntervalCount == 0) return doubleArrayOf(0.0, 0.0)
    val sorted = publishIntervals.copyOf(publishIntervalCount).apply { sort() }
    return doubleArrayOf(sorted[(sorted.lastIndex * 50) / 100] / 1_000_000.0,
      sorted[(sorted.lastIndex * 95) / 100] / 1_000_000.0)
  }

  fun close() {
    logCounters()
    closed = true
    contentSourceReference = null
    surfaceGeometry.clear()
    nativePage.clear()
    menuScrimReference = null
    choreographer.removeFrameCallback(frameClock)
    frameClockPosted = false
    root.removeCallbacks(delayedCapture)
    root.removeCallbacks(diagnosticLog)
    if (root.viewTreeObserver.isAlive) {
      root.viewTreeObserver.removeOnPreDrawListener(this)
      root.viewTreeObserver.removeOnScrollChangedListener(this)
    }
    if (activityDecor !== root && activityDecor?.viewTreeObserver?.isAlive == true) {
      activityDecor.viewTreeObserver.removeOnScrollChangedListener(backgroundScrollListener)
      activityDecor.viewTreeObserver.removeOnPreDrawListener(backgroundPreDrawListener)
    }
    releaseCapture()
    imageThread?.quitSafely()
  }

  companion object {
    private const val OWN_REDRAW_TRAVERSALS = 2
    private const val MAX_IN_FLIGHT = 2
    // Four-slot capture/teardown reserve above the normal retirement backlog.
    private const val MAX_RETIRED_IMAGES = 8
    private const val MIN_FRAME_MS = 42L
    private const val FENCE_WAIT_MS = 100L
    private const val IMAGE_DELIVERY_TIMEOUT_MS = 1_000L
    private const val ROI_POSITION_STEP = 64
    private const val SAMPLE_SIZE_STEP = 32
    private const val CAPACITY_SHRINK_SETTLE_MS = 350L
    private const val MAX_SAMPLE_WIDTH = 480f
    private const val RAW_MOTION_GUARD_DP = 8f
    private const val ATLAS_GUARD_ROWS = 2
    private const val CONTENT_NATIVE_ID = "resonus-glass-content"
    private const val MENU_SCRIM_NATIVE_ID = "resonus-menu-scrim"
    private fun quantize(value: Int, step: Int): Int = ((value.coerceAtLeast(1) + step - 1) / step) * step
  }
}

/** The status is generic renderer state; it contains no captured UI data. */
private class GpuCaptureUnavailable(status: Int) : IllegalStateException("GPU renderer unavailable: $status")
