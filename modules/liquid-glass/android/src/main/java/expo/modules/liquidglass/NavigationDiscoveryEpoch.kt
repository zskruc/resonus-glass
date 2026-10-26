package expo.modules.liquidglass

/** Negative navigator discovery is cached across layouts of list contents. */
internal class NavigationDiscoveryEpoch {
  private var fingerprint: Long? = null

  fun needsSearch(ready: Boolean, structure: Long): Boolean {
    if (!ready || fingerprint == structure) return false
    fingerprint = structure
    return true
  }

  fun invalidate() { fingerprint = null }
}
