package expo.modules.liquidglass

import org.junit.Assert.*
import org.junit.Test

class StaticRasterBudgetTest {
  @Test fun sevenVisibleCardsShareOnePairAndOneReservation() {
    val cache = StaticRasterBudget<String, Any>(100)
    val leases = List(7) { cache.acquire("material", 80)!! }
    val producer = cache.claim(leases.first())!!
    assertTrue(leases.drop(1).all { cache.claim(it) == null })
    val pair = Any()
    assertTrue(cache.complete(producer, pair, 75))
    assertTrue(leases.all { cache.value(it) === pair })
    assertEquals(75L, cache.stats().bytes)
    assertEquals(7, cache.stats().users)
    assertEquals(1, cache.stats().entries)
  }

  @Test fun anotherThemeCannotEvictMaterialStillDrawnByVisibleCards() {
    val cache = StaticRasterBudget<String, Any>(100)
    val active = cache.acquire("light", 80)!!
    val value = Any()
    assertTrue(cache.complete(cache.claim(active)!!, value, 75))
    assertNull(cache.acquire("dark", 80))
    cache.trimUnused()
    assertSame(value, cache.value(active))
    cache.release(active)
    assertNotNull(cache.acquire("dark", 80))
    assertEquals(80L, cache.stats().bytes)
  }

  @Test fun lastOldThemeOwnerPublishesAdmissionAvailabilityToWaitingTheme() {
    val cache = StaticRasterBudget<String, Any>(100)
    val old = cache.acquire("light", 80)!!
    assertTrue(cache.complete(cache.claim(old)!!, Any(), 80))
    assertNull(cache.acquire("dark", 80))
    val deniedRevision = cache.revision
    cache.release(old)
    assertTrue(cache.revision > deniedRevision)
    val next = cache.acquire("dark", 80)!!
    assertNotNull(cache.claim(next))
    assertEquals(80L, cache.stats().bytes)
    assertEquals(1, cache.stats().entries)
  }

  @Test fun clippedProducerCanBeReplacedWithoutAnOldCaptureWinning() {
    val cache = StaticRasterBudget<String, Any>(100)
    val first = cache.acquire("same", 80)!!
    val survivor = cache.acquire("same", 80)!!
    val stale = cache.claim(first)!!
    val revision = cache.revision
    cache.release(first)
    assertTrue(cache.revision > revision)
    val replacement = cache.claim(survivor)!!
    val current = Any()
    assertFalse(cache.complete(stale, Any(), 80))
    assertTrue(cache.complete(replacement, current, 80))
    assertSame(current, cache.value(survivor))
  }

  @Test fun leavingAndReenteringSameKeyRejectsAbaAndDoubleRelease() {
    val cache = StaticRasterBudget<String, Any>(100)
    val old = cache.acquire("A", 80)!!
    val stale = cache.claim(old)!!
    cache.release(old)
    val current = cache.acquire("A", 80)!!
    val producer = cache.claim(current)!!
    assertFalse(cache.complete(stale, Any(), 80))
    assertTrue(cache.complete(producer, Any(), 80))
    cache.release(old)
    cache.release(old)
    assertEquals(1, cache.stats().users)
    assertEquals(80L, cache.stats().bytes)
    assertNull(cache.value(old))
  }

  @Test fun onlyOneSnapshotCanBeInFlightAcrossDifferentSizes() {
    val cache = StaticRasterBudget<String, Any>(100)
    val a = cache.acquire("wide", 50)!!
    val b = cache.acquire("narrow", 50)!!
    val producer = cache.claim(a)!!
    assertNull(cache.claim(b))
    assertTrue(cache.complete(producer, Any(), 50))
    assertNotNull(cache.claim(b))
    assertEquals(100L, cache.stats().bytes)
  }

  @Test fun unrelatedCachePublicationDoesNotCancelOrStrandCurrentLeader() {
    val cache = StaticRasterBudget<String, Any>(100)
    val leader = cache.acquire("current", 80)!!
    val follower = cache.acquire("current", 80)!!
    val ticket = cache.claim(leader)!!
    val revision = cache.revision
    cache.trimUnused()
    assertTrue(cache.revision > revision)
    repeat(20) {
      assertSame(ticket, cache.claim(leader))
      assertNull(cache.claim(follower))
    }
    val value = Any()
    assertTrue(cache.complete(ticket, value, 80))
    assertSame(value, cache.value(follower))
    assertNull(cache.claim(leader))
    assertFalse(cache.stats().producing)
  }

  @Test fun failedCaptureFallsBackWithoutAFrameByFrameRetryLoop() {
    val cache = StaticRasterBudget<String, Any>(100)
    val a = cache.acquire("failed", 80)!!
    val producer = cache.claim(a)!!
    cache.fail(producer)
    val b = cache.acquire("failed", 80)!!
    repeat(30) { assertNull(cache.claim(a)); assertNull(cache.claim(b)) }
    assertNull(cache.value(a))
    assertEquals(0L, cache.stats().bytes)
    assertFalse(cache.stats().producing)
    cache.release(a)
    cache.release(b)
    assertNotNull(cache.claim(cache.acquire("failed", 80)))
  }

  @Test fun actualAllocationCanEvictUnusedEntryButCannotExceedBudget() {
    val cache = StaticRasterBudget<String, Any>(100)
    val a = cache.acquire("unused", 50)!!
    assertTrue(cache.complete(cache.claim(a)!!, Any(), 40))
    cache.release(a)
    val b = cache.acquire("current", 50)!!
    assertTrue(cache.complete(cache.claim(b)!!, Any(), 80))
    assertEquals(80L, cache.stats().bytes)
    assertEquals(1, cache.stats().entries)
    val c = cache.acquire("overflow", 20)!!
    assertFalse(cache.complete(cache.claim(c)!!, Any(), 101))
    assertEquals(80L, cache.stats().bytes)
    assertFalse(cache.stats().producing)
  }

  @Test fun trimDropsOnlyUnusedReferencesAndInvalidAdmissionKeepsBudgetIntact() {
    val cache = StaticRasterBudget<String, Any>(100)
    assertNull(cache.acquire("zero", 0))
    assertNull(cache.acquire("negative", -1))
    assertNull(cache.acquire("huge", Long.MAX_VALUE))
    val active = cache.acquire("active", 80)!!
    val value = Any()
    assertTrue(cache.complete(cache.claim(active)!!, value, 60))
    cache.trimUnused()
    assertSame(value, cache.value(active))
    cache.release(active)
    cache.trimUnused()
    assertEquals(0L, cache.stats().bytes)
    assertEquals(0, cache.stats().entries)
    assertEquals(0, cache.stats().users)
  }
}
