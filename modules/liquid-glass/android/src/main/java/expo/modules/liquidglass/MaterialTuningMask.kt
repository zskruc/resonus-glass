package expo.modules.liquidglass

/** Explicit optics edits retain AM++ geometry/motion and every untouched preset rule. */
internal object MaterialTuningMask {
  const val REFRACTION = 1
  const val REFRACTION_HEIGHT = 2
  const val HIGHLIGHT_WIDTH = 4
  const val HIGHLIGHT_ALPHA = 8
  const val CHROMATIC = 16
  const val TINT_ALPHA = 32

  fun has(mask: Int, field: Int): Boolean = (mask and field) != 0
  fun lensHeight(edge: Float, height: Float, mask: Int): Float =
    if (has(mask, REFRACTION_HEIGHT)) height else edge
  fun lensAmount(edge: Float, amount: Float, mask: Int): Float =
    if (has(mask, REFRACTION)) amount else edge
}
