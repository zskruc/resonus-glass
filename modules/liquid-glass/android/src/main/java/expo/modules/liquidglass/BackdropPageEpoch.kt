package expo.modules.liquidglass

/**
 * Page identity is separate from GPU reader generation and scroll revisions.
 * Returning to the same native screen is a new visit, so a delayed frame from
 * its previous visit must still be rejected. No Android objects are needed by
 * this policy; callers only supply identity and whether it is drawable yet.
 */
internal class BackdropPageEpoch {
  private var initialized = false
  private var page: Any? = null
  var epoch = 0L
    private set
  var captureAllowed = false
    private set

  /** True only at a page boundary or a change in its drawable availability. */
  fun observe(nextPage: Any?, ready: Boolean): Boolean {
    val allowed = nextPage != null && ready
    val identityChanged = !initialized || page !== nextPage
    val availabilityChanged = captureAllowed != allowed
    if (identityChanged || (captureAllowed && !allowed)) epoch++
    initialized = true
    page = nextPage
    captureAllowed = allowed
    return identityChanged || availabilityChanged
  }

  fun accepts(submittedEpoch: Long): Boolean = captureAllowed && submittedEpoch == epoch

  /** Animated and transparent pages still need the existing whole-scene composition. */
  fun allowsIsolatedSource(opaquePush: Boolean, noTransition: Boolean): Boolean =
    captureAllowed && opaquePush && noTransition
}
