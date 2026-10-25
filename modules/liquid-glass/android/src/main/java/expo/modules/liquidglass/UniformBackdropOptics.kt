package expo.modules.liquidglass

/**
 * Backdrop 1.0.0's non-dispersive lens only samples a displaced coordinate;
 * it does not shade/tint. Clamp blur and that lens preserve an opaque uniform
 * source. Keep vibrancy and every shape/highlight/shadow/surface pass intact.
 *
 * Restrict this to the stock button path with zero final effect padding:
 * blur can add its radius, and an API33+ enabled lens subtracts its height.
 * Special materials and padding/alpha edge cases retain the full pipeline.
 */
internal fun canFoldUniformButtonOptics(staticColor: Int?, preset: String,
  depth: Boolean, chromatic: Boolean, sdk: Int, blur: Float,
  refractionHeight: Float, refractionAmount: Float): Boolean =
  staticColor != null && staticColor ushr 24 == 0xff && preset == "button" &&
    !depth && !chromatic && sdk >= 33 && blur.isFinite() && blur >= 0f &&
    refractionHeight.isFinite() && refractionHeight > 0f && refractionHeight >= blur &&
    refractionAmount.isFinite() && refractionAmount > 0f
