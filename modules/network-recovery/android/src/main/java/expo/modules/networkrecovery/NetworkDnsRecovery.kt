package expo.modules.networkrecovery

import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

internal data class DnsNetwork<N>(val handle: Long, val network: N)
internal class DnsNetworkChanged : Exception()

/** Platform-independent policy: no address cache and no failed-result cache. */
internal class NetworkDnsRecovery<N>(
  private val systemLookup: (String) -> List<InetAddress>,
  private val activeNetwork: () -> DnsNetwork<N>?,
  private val queryAAAA: (DnsNetwork<N>, String, Long) -> List<InetAddress>,
  private val supported: Boolean,
  private val timeoutMs: Long = 3000,
) {
  private data class Key(val host: String, val network: Long)
  private val flights = ConcurrentHashMap<Key, CompletableFuture<List<InetAddress>>>()

  fun lookup(hostname: String): List<InetAddress> {
    val original: UnknownHostException
    try {
      return systemLookup(hostname)
    } catch (error: UnknownHostException) {
      original = error
    }
    if (!supported || !Regex("^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$").matches(hostname)) throw original
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    repeat(2) {
      val network = activeNetwork() ?: throw original
      try {
        val answer = singleFlight(network, hostname, deadline)
        if (activeNetwork()?.handle != network.handle) throw DnsNetworkChanged()
        if (answer.isEmpty() || answer.any { it !is Inet6Address }) throw original
        return answer
      } catch (_: DnsNetworkChanged) {
        // Cancelled by the platform adapter. Retry only on the latest network,
        // once and within this call's original deadline.
        if (System.nanoTime() >= deadline) throw original
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        throw original
      } catch (_: Exception) {
        throw original
      }
    }
    throw original
  }

  private fun singleFlight(network: DnsNetwork<N>, hostname: String, deadline: Long): List<InetAddress> {
    if (System.nanoTime() >= deadline) throw TimeoutException()
    val key = Key(hostname.lowercase(java.util.Locale.ROOT), network.handle)
    val created = CompletableFuture<List<InetAddress>>()
    val existing = flights.putIfAbsent(key, created)
    if (existing == null) {
      try {
        val answer = queryAAAA(network, hostname, deadline)
        if (activeNetwork()?.handle != network.handle) throw DnsNetworkChanged()
        created.complete(answer)
        return answer
      } catch (error: Exception) {
        created.completeExceptionally(error)
        throw error
      } finally {
        flights.remove(key, created)
      }
    }
    while (true) {
      if (activeNetwork()?.handle != network.handle) throw DnsNetworkChanged()
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) throw TimeoutException()
      try {
        return existing.get(minOf(remaining, TimeUnit.MILLISECONDS.toNanos(50)), TimeUnit.NANOSECONDS)
      } catch (_: TimeoutException) {
        // Recheck the current network without creating a second query.
      } catch (error: ExecutionException) {
        throw error.cause ?: error
      }
    }
  }
}
