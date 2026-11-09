@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package expo.modules.audio

import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import expo.modules.kotlin.AppContext
import java.lang.reflect.Proxy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain

private class NativePlayer {
  var playing = false
  var state = Player.STATE_IDLE
  var position = 0L
  var released = false
  val listeners = mutableListOf<Player.Listener>()
  val player = Proxy.newProxyInstance(ExoPlayer::class.java.classLoader, arrayOf(ExoPlayer::class.java)) { _, method, args ->
    when (method.name) {
      "addListener" -> { listeners.add(args!![0] as Player.Listener); null }
      "removeListener" -> { listeners.remove(args!![0]); null }
      "isPlaying" -> playing
      "getPlaybackState" -> state
      "getCurrentPosition" -> position
      "getDuration" -> 600_000L
      "getVolume" -> 1f
      "release" -> { released = true; null }
      "toString" -> "TestExoPlayer"
      "hashCode" -> System.identityHashCode(this)
      "equals" -> false
      else -> error("Unexpected ExoPlayer call: ${method.name}")
    }
  } as ExoPlayer

  fun playing(value: Boolean) { playing = value; listeners.toList().forEach { it.onIsPlayingChanged(value) } }
  fun state(value: Int) { state = value; listeners.toList().forEach { it.onPlaybackStateChanged(value) } }
}

private class Probe(native: NativePlayer, context: AppContext) : BaseAudioPlayer(native.player, context, 500.0, "status") {
  init { installPlayerListeners(); startUpdating() }
  override fun currentStatus(): Map<String, Any?> = mapOf("position" to ref.currentPosition)
  override fun setPlaybackRate(rate: Float) {}
  fun hasTicker() = hasPeriodicStatusUpdates
  fun policy(background: Boolean, precise: Boolean) {
    setStatusUpdateInterval(PlaybackPowerPolicy(background, precise).statusInterval(500L))
  }
}

fun main() {
  var checks = 0
  fun verified(message: String, block: () -> Unit) { block(); checks++; println("PASS $message") }
  verified("local/remote/unknown source classification and JS next-source fence") {
    val local = PlaybackPowerPolicy(networkRequired = false)
    check(local.wakeMode(listOf("file:///offline/song.m4a")) == PlaybackWakeMode.LOCAL)
    check(local.wakeMode(listOf("android.resource://app/raw/a", "asset:///next.mp3")) == PlaybackWakeMode.LOCAL)
    check(local.wakeMode(listOf("file:///a", "https://server/next")) == PlaybackWakeMode.NETWORK)
    check(local.wakeMode(listOf("https://server/current", "file:///next")) == PlaybackWakeMode.NETWORK)
    check(local.wakeMode(listOf("content://cloud/provider")) == PlaybackWakeMode.NETWORK)
    check(local.wakeMode(listOf(null)) == PlaybackWakeMode.NETWORK)
    check(local.wakeMode(emptyList()) == PlaybackWakeMode.NETWORK)
    check(PlaybackPowerPolicy().wakeMode(listOf("file:///a")) == PlaybackWakeMode.NETWORK)
  }
  verified("offload requires explicit single-item background permission and rejects gapless/repeat/effects") {
    val enabled = PlaybackPowerPolicy(background = true, precise = false, allowOffload = true)
    check(enabled.offloadAllowed(1, false, 1f, 1f, false))
    check(!enabled.offloadAllowed(2, false, 1f, 1f, false))
    check(!enabled.offloadAllowed(1, true, 1f, 1f, false))
    check(!enabled.offloadAllowed(1, false, 1.25f, 1f, false))
    check(!enabled.offloadAllowed(1, false, 1f, 0.9f, false))
    check(!enabled.offloadAllowed(1, false, 1f, 1f, true))
    check(!enabled.copy(precise = true).offloadAllowed(1, false, 1f, 1f, false))
    check(!enabled.copy(background = false).offloadAllowed(1, false, 1f, 1f, false))
    check(!enabled.copy(allowOffload = false).offloadAllowed(1, false, 1f, 1f, false))
  }
  val clock = TestCoroutineScheduler()
  val dispatcher = StandardTestDispatcher(clock)
  Dispatchers.setMain(dispatcher)
  try {
    val native = NativePlayer()
    val probe = Probe(native, AppContext(CoroutineScope(dispatcher)))
    verified("idle actual BaseAudioPlayer owns no polling job") {
      clock.runCurrent(); check(!probe.hasTicker())
      clock.advanceTimeBy(60_000); clock.runCurrent(); check(probe.emitted.isEmpty())
    }
    native.state(Player.STATE_READY); native.playing(true); clock.runCurrent()
    var start = probe.emitted.size
    verified("foreground actual ticker remains500ms") {
      clock.advanceTimeBy(2_000); clock.runCurrent(); check(probe.emitted.size - start == 4)
    }
    probe.policy(background = true, precise = false); clock.runCurrent(); start = probe.emitted.size
    verified("ordinary background actual ticker sends exactly2beats over10seconds") {
      clock.advanceTimeBy(10_000); clock.runCurrent(); check(probe.emitted.size - start == 2)
    }
    probe.policy(background = true, precise = true); clock.runCurrent(); start = probe.emitted.size
    verified("precision guard restores500ms even in background") {
      clock.advanceTimeBy(2_000); clock.runCurrent(); check(probe.emitted.size - start == 4)
    }
    verified("seek/loading/end and pause remain immediate; paused ticker stops") {
      start = probe.emitted.size
      native.listeners.single().onPositionDiscontinuity(Player.PositionInfo(Any(),0,null,Any(),0,0L,0L,0,0), Player.PositionInfo(Any(),0,null,Any(),0,0L,0L,0,0), Player.DISCONTINUITY_REASON_SEEK)
      check(probe.emitted.size == start + 1)
      native.listeners.single().onIsLoadingChanged(true); check(probe.emitted.size == start + 2)
      native.playing(false); check(probe.emitted.size == start + 3)
      clock.runCurrent(); check(!probe.hasTicker())
      val pausedCount = probe.emitted.size
      clock.advanceTimeBy(60_000); clock.runCurrent(); check(probe.emitted.size == pausedCount)
      native.state(Player.STATE_ENDED); check(probe.emitted.size == pausedCount + 1)
      val last = probe.emitted.last().second as Map<*, *>; check(last["didJustFinish"] == true)
    }
    native.state(Player.STATE_READY); native.playing(true); clock.runCurrent()
    verified("actual release cancels pending ticks and detaches native listener") {
      probe.sharedObjectDidRelease(); clock.runCurrent()
      val count = probe.emitted.size
      clock.advanceTimeBy(60_000); clock.runCurrent()
      check(probe.emitted.size == count); check(native.listeners.isEmpty()); check(native.released); check(!probe.hasTicker())
    }
  } finally { Dispatchers.resetMain() }
  println("Audio power: $checks production-policy/ticker checks passed")
}
