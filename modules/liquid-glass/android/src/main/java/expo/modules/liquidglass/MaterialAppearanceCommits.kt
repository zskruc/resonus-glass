package expo.modules.liquidglass

/** UI-thread post-commit redraw gate; owns one stable, cancellable frame callback. */
internal class MaterialAppearanceCommits(
  private val postFrame: (Runnable) -> Unit,
  private val cancelFrame: (Runnable) -> Unit,
  private val invalidate: () -> Unit
) {
  private var attached = false
  private var hasKey = false
  private var tint = 0
  private var opacityBits = 0
  private var dark = false
  private var pending = false
  private val frame = Runnable {
    if (attached && pending) {
      pending = false
      invalidate()
    }
  }

  fun attach() {
    attached = true
  }

  /** Called only after a successful Compose apply, never by native prop setters. */
  fun commit(nextTint: Int, nextOpacityBits: Int, nextDark: Boolean) {
    if (!attached || hasKey && tint == nextTint && opacityBits == nextOpacityBits && dark == nextDark) return
    hasKey = true
    tint = nextTint
    opacityBits = nextOpacityBits
    dark = nextDark
    if (!pending) {
      pending = true
      postFrame(frame)
    }
  }

  /** The host calls this before Android removes its old window attachment. */
  fun detach() {
    attached = false
    hasKey = false
    if (pending) {
      pending = false
      cancelFrame(frame)
    }
  }
}
