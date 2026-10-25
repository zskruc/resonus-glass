package expo.modules.highrefresh

/** Window attributes, kept independent of Android for lifecycle/ownership tests. */
internal data class RefreshPreferences(
  val refreshRate: Float,
  val displayModeId: Int,
  val balancedPowerSavings: Boolean?,
)

internal object HighRefreshPolicy {
  const val TARGET_HZ = 120f

  fun isEligible(resumedActivities: Int, attached: Boolean, visible: Boolean): Boolean =
    resumedActivities > 0 && attached && visible

  fun foreground(original: RefreshPreferences): RefreshPreferences = original.copy(
    refreshRate = TARGET_HZ,
    // A nonzero preferred mode takes precedence over preferredRefreshRate. Do
    // not pin a physical mode/resolution: let Android pick a compatible rate.
    displayModeId = 0,
    balancedPowerSavings = original.balancedPowerSavings?.let { false },
  )

  /** Release our own vote without overwriting a newer owner's changed fields. */
  fun restore(original: RefreshPreferences, current: RefreshPreferences): RefreshPreferences {
    val requested = foreground(original)
    return current.copy(
      refreshRate = if (current.refreshRate == requested.refreshRate) original.refreshRate else current.refreshRate,
      displayModeId = if (current.displayModeId == requested.displayModeId) original.displayModeId else current.displayModeId,
      balancedPowerSavings = if (current.balancedPowerSavings == requested.balancedPowerSavings) {
        original.balancedPowerSavings
      } else current.balancedPowerSavings,
    )
  }
}
