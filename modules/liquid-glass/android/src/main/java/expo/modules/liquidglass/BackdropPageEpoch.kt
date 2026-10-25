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
  private var childPage: Any? = null
  var epoch = 0L
    private set
  var captureAllowed = false
    private set

  /** True only at a page boundary or a change in its drawable availability. */
  fun observe(nextPage: Any?, ready: Boolean, nextChildPage: Any? = null): Boolean {
    val allowed = nextPage != null && ready
    // Tab screens share their outer Stack screen. Keep both identities so a
    // new tab invalidates tickets without changing which opaque outer page draws.
    val identityChanged = !initialized || page !== nextPage || childPage !== nextChildPage
    val availabilityChanged = captureAllowed != allowed
    if (identityChanged || (captureAllowed && !allowed)) epoch++
    initialized = true
    page = nextPage
    childPage = nextChildPage
    captureAllowed = allowed
    return identityChanged || availabilityChanged
  }

  fun accepts(submittedEpoch: Long): Boolean = captureAllowed && submittedEpoch == epoch

  /** Animated and transparent pages still need the existing whole-scene composition. */
  fun allowsIsolatedSource(opaquePush: Boolean, noTransition: Boolean): Boolean =
    captureAllowed && opaquePush && noTransition
}
