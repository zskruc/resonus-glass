package expo.modules.liquidglass

/** Keep transitions inside the complete Stack, but never record its sibling chrome. */
internal fun <T : Any> selectBackdropCaptureSource(
  window: T,
  activityWindow: Boolean,
  isolatedPage: T?,
  stackContent: T?
): T = if (activityWindow) isolatedPage ?: stackContent ?: window else window

/** A modal records its own window plus the Activity behind it, as before. */
internal fun backdropSourceContainsSurface(
  fullWindow: Boolean,
  insideSource: Boolean,
  insideActivity: Boolean
): Boolean = insideSource || (fullWindow && insideActivity)

/** Keep the old host envelope throughout motion, including source spring overshoot. */
internal fun retainBackdropHostBounds(hasDock: Boolean, progress: Float, pressed: Boolean): Boolean =
  pressed || (hasDock && progress != 0f && progress != 1f)

/** Mutable padded union: one instance per window, no Rect/array allocation per material/frame. */
internal class BackdropCaptureRegion {
  var left = 0
    private set
  var top = 0
    private set
  var right = 0
    private set
  var bottom = 0
    private set
  var empty = true
    private set

  fun clear() { empty = true; left = 0; top = 0; right = 0; bottom = 0 }

  fun include(l: Int, t: Int, r: Int, b: Int, padding: Int) {
    if (l >= r || t >= b) return
    val guard = padding.coerceAtLeast(0)
    if (empty) {
      left = l - guard; top = t - guard; right = r + guard; bottom = b + guard
      empty = false
    } else {
      left = minOf(left, l - guard); top = minOf(top, t - guard)
      right = maxOf(right, r + guard); bottom = maxOf(bottom, b + guard)
    }
  }
}
