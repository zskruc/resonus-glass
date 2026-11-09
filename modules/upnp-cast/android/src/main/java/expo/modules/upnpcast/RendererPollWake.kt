package expo.modules.upnpcast

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull

/** One coalesced native wake: interactions never sit behind a background delay. */
internal class RendererPollWake {
  private val channel = Channel<Unit>(Channel.CONFLATED)
  private val extras = AtomicBoolean(false)

  fun request(forceExtras: Boolean = true) {
    if (forceExtras) extras.set(true)
    channel.trySend(Unit)
  }

  fun takeExtras(): Boolean = extras.getAndSet(false)

  suspend fun await(waitMs: Long) {
    if (waitMs > 0) withTimeoutOrNull(waitMs) { channel.receive() }
  }

  fun reset() {
    while (channel.tryReceive().isSuccess) { /* A previous session cannot wake its replacement. */ }
    extras.set(false)
  }

  fun close() { channel.close() }
}
