package expo.modules.liquidglass

import org.junit.Assert.*
import org.junit.Test

class ClippedCompositionLifetimeTest {
  private class Host : ClippedCompositionLifetime.Host<Any> {
    override var attached = true
    var observer: Any? = null
    var strategy = "default"
    var disposals = 0
    val events = mutableListOf<String>()
    override fun retainUntilDestroyed(owner: Any) { observer = owner; strategy = "retained"; events += "retain" }
    override fun useDefaultDetachStrategy() { observer = null; strategy = "default"; events += "default" }
    override fun useFinalDetachStrategy() { observer = null; strategy = "final"; events += "final" }
    override fun dispose() { disposals++; events += "dispose" }
    fun detach() { attached = false; if (strategy != "retained") dispose() }
  }

  @Test fun temporaryClipDetachRetainsOneCompositionWithoutReinstallingObserver() {
    val host = Host(); val lifetime = ClippedCompositionLifetime(host); val activity = Any()
    lifetime.update(true, activity)
    repeat(30) { host.detach(); host.attached = true; lifetime.update(true, activity) }
    assertEquals(listOf("retain"), host.events); assertEquals(0, host.disposals); assertSame(activity, host.observer)
  }

  @Test fun attachedReactPopUnregistersObserverBeforeDeferringDisposalToActualDetach() {
    val host = Host(); val lifetime = ClippedCompositionLifetime(host); val activity = Any()
    lifetime.update(true, activity); lifetime.destroy()
    assertNull(host.observer); assertEquals(listOf("retain", "final"), host.events); assertEquals(0, host.disposals)
    lifetime.update(true, activity); lifetime.update(true, Any()); lifetime.destroy()
    assertEquals("A late attach/prop update cannot revive a dropped React view", listOf("retain", "final"), host.events)
    host.detach(); assertEquals(1, host.disposals)
  }

  @Test fun droppedClippedViewDisposesImmediatelyAndOnlyAfterRemovingObserver() {
    val host = Host(); val lifetime = ClippedCompositionLifetime(host)
    lifetime.update(true, Any()); host.detach(); lifetime.destroy(); lifetime.destroy()
    assertEquals(listOf("retain", "final", "dispose"), host.events); assertNull(host.observer)
  }

  @Test fun optOutWhileClippedDisposesAndALaterOptInInstallsCurrentOwner() {
    val host = Host(); val lifetime = ClippedCompositionLifetime(host); val first = Any(); val second = Any()
    lifetime.update(true, first); host.detach(); lifetime.update(false, first)
    assertEquals(listOf("retain", "default", "dispose"), host.events); assertNull(host.observer)
    lifetime.update(true, second); assertSame(second, host.observer); assertEquals(1, host.disposals)
  }

  @Test fun optOutWhileVisiblePreservesItsExitFrameThenUsesTheOriginalDetachBehavior() {
    val host = Host(); val lifetime = ClippedCompositionLifetime(host)
    lifetime.update(true, Any()); lifetime.update(false, null)
    assertEquals(0, host.disposals); assertNull(host.observer); host.detach(); assertEquals(1, host.disposals)
  }

  @Test fun activityReplacementCannotKeepAnOldCompositionOrLifecycleObserver() {
    val host = Host(); val lifetime = ClippedCompositionLifetime(host); val second = Any()
    lifetime.update(true, Any()); lifetime.update(true, second)
    assertEquals(listOf("retain", "final", "dispose", "retain"), host.events); assertSame(second, host.observer)
  }

  @Test fun defaultAndMissingActivityNeverInstallRetainedObservers() {
    val host = Host(); val lifetime = ClippedCompositionLifetime(host)
    lifetime.update(false, Any()); lifetime.update(true, null)
    assertTrue(host.events.isEmpty()); host.detach(); assertEquals(1, host.disposals)
  }
}
