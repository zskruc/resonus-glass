package expo.modules.networkrecovery

import android.content.Context
import android.net.ConnectivityManager
import android.net.DnsResolver
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.CancellationSignal
import okhttp3.Dns
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Uses the caller UID's current default network, including an active VPN. */
class ResonusDns(context: Context) : Dns {
  private val manager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val recovery = NetworkDnsRecovery(
    systemLookup = { Dns.SYSTEM.lookup(it) },
    activeNetwork = { currentNetwork() },
    queryAAAA = { network, host, deadline -> queryCurrent(network, host, deadline) },
    supported = Build.VERSION.SDK_INT >= 29,
  )

  override fun lookup(hostname: String): List<InetAddress> = recovery.lookup(hostname)

  private fun currentNetwork(): DnsNetwork<Network>? = try {
    val network = manager.activeNetwork
    if (network == null || manager.getNetworkCapabilities(network)
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) != true) null
    else DnsNetwork(network.networkHandle, network)
  } catch (_: Exception) { null }

  private fun queryCurrent(network: DnsNetwork<Network>, host: String, deadline: Long): List<InetAddress> {
    if (Build.VERSION.SDK_INT < 29) throw UnknownHostException()
    val executor = Executors.newSingleThreadExecutor { task ->
      Thread(task, "resonus-dns-recovery").apply { isDaemon = true }
    }
    val callbacks = Executor { task ->
      try { executor.execute(task) } catch (_: RejectedExecutionException) { }
    }
    val cancellation = CancellationSignal()
    val completed = CountDownLatch(1)
    val addresses = AtomicReference<List<InetAddress>?>()
    try {
      if (currentNetwork()?.handle != network.handle) throw DnsNetworkChanged()
      DnsResolver.getInstance().query(network.network, host, DnsResolver.TYPE_AAAA,
        DnsResolver.FLAG_EMPTY, callbacks, cancellation,
        object : DnsResolver.Callback<List<InetAddress>> {
          override fun onAnswer(answer: List<InetAddress>, rcode: Int) {
            if (rcode == 0 && answer.isNotEmpty() && answer.all { it is Inet6Address }) {
              addresses.set(answer)
            }
            completed.countDown()
          }

          override fun onError(error: DnsResolver.DnsException) {
            completed.countDown()
          }
        })
      while (true) {
        if (currentNetwork()?.handle != network.handle) throw DnsNetworkChanged()
        val remaining = deadline - System.nanoTime()
        if (remaining <= 0) throw UnknownHostException()
        if (completed.await(minOf(remaining, TimeUnit.MILLISECONDS.toNanos(50)), TimeUnit.NANOSECONDS)) break
      }
      if (currentNetwork()?.handle != network.handle) throw DnsNetworkChanged()
      return addresses.get() ?: throw UnknownHostException()
    } finally {
      runCatching { cancellation.cancel() }
      executor.shutdownNow()
    }
  }
}
