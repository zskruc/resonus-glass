package expo.modules.liquidglass

/** Only the extra outer clip layer changes; all optical/decorator layers stay intact. */
internal fun canUseStaticDecorationAutoClip(staticColor: Int?, enabled: Boolean,
  preset: String, tintOpacity: Float, tabsCount: Int, dockCompactWidth: Float,
  progressiveBlur: Boolean): Boolean =
  staticColor != null && staticColor ushr 24 == 0xff && enabled && preset == "button" &&
    tintOpacity == 0f && tabsCount == 0 && dockCompactWidth == 0f && !progressiveBlur
