package expo.modules.networkrecovery

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class NetworkDnsRecoveryTest {
  private val ipv6 = InetAddress.getByAddress(ByteArray(16).also { it[0] = 0x20; it[1] = 0x01; it[15] = 1 })
  private val ipv4 = InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))
  private val original = UnknownHostException("original")
  private val network = DnsNetwork(1L, "network-one")

  @Test fun systemSuccessDoesNotQueryFallback() {
    val recovery = NetworkDnsRecovery({ listOf(ipv4) }, { fail("Network should not be read"); null },
      { _: DnsNetwork<String>, _: String, _: Long -> fail("No fallback"); emptyList() }, true)
    assertEquals(listOf(ipv4), recovery.lookup("example.test"))
  }

  @Test fun onlyUnknownHostTriggersFallback() {
    val failure = IllegalStateException()
    val recovery = NetworkDnsRecovery<String>({ throw failure }, { network }, { _, _, _ -> fail("No fallback"); emptyList() }, true)
    try { recovery.lookup("example.test"); fail("Expected original failure") }
    catch (error: IllegalStateException) { assertSame(failure, error) }
  }

  @Test fun unsupportedUnavailableAndUnsafeHostKeepOriginalFailure() {
    for ((supported, active, host) in listOf(Triple(false, network, "example.test"),
      Triple(true, null, "example.test"), Triple(true, network, "user@example.test/path"))) {
      val recovery = NetworkDnsRecovery({ throw original }, { active },
        { _: DnsNetwork<String>, _: String, _: Long -> fail("No fallback"); emptyList() }, supported)
      assertOriginal { recovery.lookup(host) }
    }
  }

  @Test fun acceptsOnlyNonemptyIPv6AndDoesNotCacheResults() {
    for (answer in listOf(emptyList(), listOf(ipv4), listOf(ipv4, ipv6))) {
      val recovery = NetworkDnsRecovery({ throw original }, { network }, { _, _, _ -> answer }, true)
      assertOriginal { recovery.lookup("example.test") }
    }
    val calls = AtomicInteger()
    val recovery = NetworkDnsRecovery({ throw original }, { network }, { _, _, _ -> calls.incrementAndGet(); listOf(ipv6) }, true)
    repeat(2) { assertEquals(listOf(ipv6), recovery.lookup("example.test")) }
    assertEquals(2, calls.get())
  }

  @Test fun doesNotCacheFailure() {
    var calls = 0
    val recovery = NetworkDnsRecovery({ throw original }, { network }, { _, _, _ ->
      if (++calls == 1) throw UnknownHostException()
      listOf(ipv6)
    }, true)
    assertOriginal { recovery.lookup("example.test") }
    assertEquals(listOf(ipv6), recovery.lookup("example.test"))
    assertEquals(2, calls)
  }

  @Test fun changedNetworkRetriesOnceWithoutReturningOldAddresses() {
    var active = network
    val visited = mutableListOf<Long>()
    val recovery = NetworkDnsRecovery({ throw original }, { active }, { requested, _, _ ->
      visited.add(requested.handle)
      if (requested.handle == 1L) active = DnsNetwork(2L, "network-two")
      listOf(ipv6)
    }, true)
    assertEquals(listOf(ipv6), recovery.lookup("example.test"))
    assertEquals(listOf(1L, 2L), visited)

    var calls = 0
    val unstable = NetworkDnsRecovery({ throw original }, { active }, { _, _, _ ->
      calls++; active = DnsNetwork(active.handle + 1, "changed"); throw DnsNetworkChanged()
    }, true)
    assertOriginal { unstable.lookup("example.test") }
    assertEquals(2, calls)
  }

  @Test fun concurrentHostAndNetworkShareOnlyCurrentFlight() {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val calls = AtomicInteger()
    val failures = mutableListOf<Throwable>()
    val recovery = NetworkDnsRecovery({ throw original }, { network }, { _, _, _ ->
      calls.incrementAndGet(); entered.countDown(); check(release.await(2, TimeUnit.SECONDS)); listOf(ipv6)
    }, true)
    fun worker() = Thread {
      try { assertEquals(listOf(ipv6), recovery.lookup("example.test")) }
      catch (error: Throwable) { synchronized(failures) { failures.add(error) } }
    }
    val first = worker(); val second = worker()
    try {
      first.start(); assertTrue(entered.await(1, TimeUnit.SECONDS)); second.start()
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
      while (second.state != Thread.State.TIMED_WAITING && System.nanoTime() < deadline) Thread.yield()
      assertEquals(Thread.State.TIMED_WAITING, second.state)
      assertEquals(1, calls.get())
    } finally {
      release.countDown(); first.join(2000); second.join(2000)
    }
    assertFalse(first.isAlive); assertFalse(second.isAlive); assertTrue(failures.toString(), failures.isEmpty())
    assertEquals(1, calls.get())
    recovery.lookup("example.test")
    assertEquals(2, calls.get())
  }

  private fun assertOriginal(block: () -> Unit) {
    try { block(); fail("Expected original UnknownHostException") }
    catch (error: UnknownHostException) { assertSame(original, error) }
  }
}
