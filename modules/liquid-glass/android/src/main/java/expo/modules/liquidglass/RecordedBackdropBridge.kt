package expo.modules.liquidglass

/** Frozen sample coordinates; the producer owns and reuses the actual drawing node. */
internal data class RecordedBackdropGeometry(
  val scale: Float,
  val screenX: Int,
  val screenY: Int,
  val pixelWidth: Int,
  val pixelHeight: Int
) {
  val inverseScale: Float get() = 1f / scale

  fun isValid(): Boolean = scale.isFinite() && scale > 0f && inverseScale.isFinite() &&
    inverseScale > 0f && pixelWidth > 0 && pixelHeight > 0 &&
    (pixelWidth * inverseScale).isFinite() && (pixelHeight * inverseScale).isFinite()

  fun localX(pixelX: Float, originX: Int): Float =
    (screenX.toLong() - originX.toLong()).toFloat() + pixelX * inverseScale

  fun localY(pixelY: Float, originY: Int): Float =
    (screenY.toLong() - originY.toLong()).toFloat() + pixelY * inverseScale
}

/** Every condition is required: an absent bit always keeps the existing image-only path. */
internal object RecordedBackdropEligibility {
  const val ASYNC = 1
  const val ACTIVITY = 1 shl 1
  const val NON_WINDOW_SOURCE = 1 shl 2
  const val NO_SOURCE_CONSUMERS = 1 shl 3
  const val NO_PROGRESSIVE = 1 shl 4
  const val NO_PATCH = 1 shl 5
  const val NO_IMAGE = 1 shl 6
  const val SOURCE_DRAWABLE = 1 shl 7
  const val RECORDED = 1 shl 8
  const val SYNC_OK = 1 shl 9
  const val REQUIRED = ASYNC or ACTIVITY or NON_WINDOW_SOURCE or NO_SOURCE_CONSUMERS or
    NO_PROGRESSIVE or NO_PATCH or NO_IMAGE or SOURCE_DRAWABLE or RECORDED or SYNC_OK

  // Direct replay needs no existing-image absence and no offscreen GPU submit.
  // A completed display-list record remains mandatory at publication.
  private const val DIRECT_SAFETY = ASYNC or ACTIVITY or NON_WINDOW_SOURCE or NO_SOURCE_CONSUMERS or
    NO_PROGRESSIVE or NO_PATCH or SOURCE_DRAWABLE
  fun allowsDirect(mask: Int): Boolean = (mask and DIRECT_SAFETY) == DIRECT_SAFETY
  fun allows(mask: Int): Boolean = (mask and REQUIRED) == REQUIRED
}

/** UI-thread state only. Clearing a borrowed node never closes or discards its display list. */
internal class RecordedBackdropBridge<T : Any> {
  internal data class Entry<T : Any>(
    val content: T,
    val geometry: RecordedBackdropGeometry,
    val pageEpoch: Long,
    val generation: Long,
    val serial: Long
  )

  private var directSerial = 0L

  /** Image tickets submitted before a direct publication can never replace it. */
  fun acceptsImage(serial: Long): Boolean = serial > directSerial

  var recordSerial = 0L
    private set
  var value: Entry<T>? = null
    private set

  fun clear(): Entry<T>? {
    val previous = value
    value = null
    return previous
  }

  /** A late failed ticket must not invalidate a later recording in the same renderer. */
  fun clearIfMatches(pageEpoch: Long, generation: Long, serial: Long): Entry<T>? {
    val candidate = value ?: return null
    if (candidate.pageEpoch != pageEpoch || candidate.generation != generation || candidate.serial != serial) return null
    return clear()
  }

  /** Must precede every mutation of a reused producer node, including same-page recording. */
  fun beginRecord(): Long {
    clear()
    recordSerial++
    return recordSerial
  }

  fun publish(content: T, geometry: RecordedBackdropGeometry, pageEpoch: Long, generation: Long,
    serial: Long, currentPageEpoch: Long, currentGeneration: Long, captureAllowed: Boolean,
    eligibilityMask: Int, direct: Boolean = false): Boolean {
    val eligible = if (direct) RecordedBackdropEligibility.allowsDirect(eligibilityMask) &&
      (eligibilityMask and RecordedBackdropEligibility.RECORDED) != 0 else RecordedBackdropEligibility.allows(eligibilityMask)
    if (!captureAllowed || !eligible || !geometry.isValid() ||
      serial <= 0L || serial != recordSerial || pageEpoch != currentPageEpoch || generation != currentGeneration) return false
    if (direct) directSerial = serial
    value = Entry(content, geometry, pageEpoch, generation, serial)
    return true
  }

  fun current(pageEpoch: Long, generation: Long, captureAllowed: Boolean): Entry<T>? {
    val candidate = value ?: return null
    return candidate.takeIf { captureAllowed && it.pageEpoch == pageEpoch &&
      it.generation == generation && it.serial == recordSerial }
  }
}
