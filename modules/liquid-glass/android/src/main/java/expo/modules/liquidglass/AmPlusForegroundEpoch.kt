package expo.modules.liquidglass

/** Refresh a real source row on entry/change, without requesting an idle animation. */
internal class AmPlusForegroundEpoch {
  private var wasEligible = false
  private var fingerprint = Long.MIN_VALUE

  fun needsRecord(eligible: Boolean, nextFingerprint: Long, dirty: Boolean): Boolean {
    if (!eligible) { wasEligible = false; return false }
    val changed = !wasEligible || nextFingerprint != fingerprint || dirty
    wasEligible = true
    if (changed) fingerprint = nextFingerprint
    return changed
  }

  fun invalidate() { wasEligible = false; fingerprint = Long.MIN_VALUE }
}
