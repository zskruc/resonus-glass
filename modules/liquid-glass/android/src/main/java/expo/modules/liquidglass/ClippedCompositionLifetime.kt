package expo.modules.liquidglass

/** A clipped RN child is detached, not destroyed. Actual React release is terminal. */
internal class ClippedCompositionLifetime<Owner : Any>(private val host: Host<Owner>) {
  interface Host<Owner : Any> {
    val attached: Boolean
    fun retainUntilDestroyed(owner: Owner)
    fun useDefaultDetachStrategy()
    fun useFinalDetachStrategy()
    fun dispose()
  }

  private var owner: Owner? = null
  private var destroyed = false
  val retaining: Boolean get() = owner != null

  fun update(eligible: Boolean, currentOwner: Owner?) {
    if (destroyed) return
    if (!eligible || currentOwner == null) {
      if (owner != null) {
        owner = null
        // Replacing the strategy first unregisters its old lifecycle observer.
        host.useDefaultDetachStrategy()
        if (!host.attached) host.dispose()
      }
      return
    }
    if (owner === currentOwner) return
    if (owner != null) {
      host.useFinalDetachStrategy()
      host.dispose() // A different Activity must not inherit the old composition.
    }
    owner = currentOwner
    host.retainUntilDestroyed(currentOwner)
  }

  fun destroy() {
    if (destroyed) return
    destroyed = true
    owner = null
    // Expo SDK 57: detach the Activity observer before releasing a composition.
    host.useFinalDetachStrategy()
    // Screens can still display an outgoing React view during its pop animation.
    // The final detach strategy disposes it when that actual animation ends.
    if (!host.attached) host.dispose()
  }
}
