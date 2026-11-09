package expo.modules.upnpcast

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

class RendererPollWakeTest {
  @Test fun interactionOrForegroundWakeInterruptsTheActualBackgroundWait() = runBlocking {
    val wake = RendererPollWake()
    val waiting = async(start = CoroutineStart.UNDISPATCHED) { wake.await(RendererPollTiming.BACKGROUND_INTERVAL_MS) }
    assertFalse(waiting.isCompleted)
    wake.request()
    withTimeout(1_000) { waiting.await() }
    assertTrue(wake.takeExtras())
    assertFalse(wake.takeExtras())
    wake.close()
  }

  @Test fun manyInteractionRequestsCoalesceIntoOneImmediateWake() = runBlocking {
    val wake = RendererPollWake()
    repeat(30) { wake.request() }
    withTimeout(1_000) { wake.await(RendererPollTiming.BACKGROUND_INTERVAL_MS) }
    val second = async(start = CoroutineStart.UNDISPATCHED) { wake.await(RendererPollTiming.BACKGROUND_INTERVAL_MS) }
    assertFalse(second.isCompleted)
    wake.request(forceExtras = false)
    withTimeout(1_000) { second.await() }
    assertTrue("a non-forcing visibility change must not erase an interaction's extras request", wake.takeExtras())
    wake.close()
  }

  @Test fun reconnectDiscardsOldWakeAndExtrasRatherThanLeakingThemToTheNewSession() = runBlocking {
    val wake = RendererPollWake()
    wake.request(); wake.reset()
    assertFalse(wake.takeExtras())
    val waiting = async(start = CoroutineStart.UNDISPATCHED) { wake.await(RendererPollTiming.BACKGROUND_INTERVAL_MS) }
    assertFalse(waiting.isCompleted)
    wake.request(forceExtras = false)
    withTimeout(1_000) { waiting.await() }
    assertFalse(wake.takeExtras())
    wake.close()
  }
}
