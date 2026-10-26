package expo.modules.liquidglass

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class BoundedRetirementQueueTest {
  @Test fun thousandsOfFramesRetireInOrderWithoutHoldingOldResources() {
    val queue = BoundedRetirementQueue<Any>(8)
    repeat(10_000) {
      val image = Any()
      assertTrue(queue.offer(image))
      assertSame(image, queue.poll())
      assertNull(queue.poll())
      assertEquals(0, queue.size)
    }
  }

  @Test fun workerDrainsRetirementBeforeAcquireKeepingSixReaderSlotsAvailable() {
    val queue = BoundedRetirementQueue<Any>(8)
    val displayed = ArrayDeque<Any>()
    var acquired = 0
    repeat(1_000) {
      // The real consumer drains before acquireNextImage, independently of
      // whether the posted drain message has reached the head of the looper.
      while (queue.poll() != null) acquired--
      repeat(2) {
        acquired++
        assertTrue(acquired <= 6)
        displayed.addLast(Any())
        if (displayed.size > 2) assertTrue(queue.offer(displayed.removeFirst()))
      }
      assertEquals(2, displayed.size)
      assertTrue(acquired <= 4)
    }
    displayed.forEach { assertTrue(queue.offer(it)) }
    displayed.clear()
    while (queue.poll() != null) acquired--
    assertEquals(0, acquired)
  }

  @Test fun backlogIsBoundedAndOverflowOwnershipRemainsWithTheCaller() {
    val queue = BoundedRetirementQueue<Any>(8)
    val images = List(8) { Any() }
    images.forEach { assertTrue(queue.offer(it)) }
    assertEquals(8, queue.size)
    assertTrue(queue.offer(images[0])) // Duplicate does not consume another slot.
    assertFalse(queue.offer(Any())) // Caller must synchronously clean this rare overflow.
    images.forEach { assertSame(it, queue.poll()) }
    assertEquals(0, queue.size)
  }

  @Test fun readerCloseBarrierCanDrainBothOldAndNewGenerationRetirement() {
    data class Image(val generation: Int, val index: Int)
    val queue = BoundedRetirementQueue<Image>(8)
    val released = mutableListOf<Image>()
    val old = Image(1, 0)
    val staleResult = Image(1, 1)
    val current = Image(2, 0)
    assertTrue(queue.offer(old))
    assertTrue(queue.offer(staleResult))
    assertTrue(queue.offer(current))
    // The reader-close message drains before closing the retired reader. A
    // generation rejection uses this same queue, never a UI-thread native call.
    while (true) released.add(queue.poll() ?: break)
    assertEquals(listOf(old, staleResult, current), released)
    assertEquals(0, queue.size)
  }

  @Test fun slowNativeReleaseDoesNotHoldTheQueueMonitorAndBlockTheUiPublisher() {
    val queue = BoundedRetirementQueue<Any>(8)
    val image = Any()
    val nativeReleaseStarted = CountDownLatch(1)
    val finishNativeRelease = CountDownLatch(1)
    val worker = Thread {
      assertSame(image, queue.poll())
      nativeReleaseStarted.countDown()
      assertTrue(finishNativeRelease.await(2, TimeUnit.SECONDS))
    }
    assertTrue(queue.offer(image))
    worker.start()
    try {
      assertTrue(nativeReleaseStarted.await(2, TimeUnit.SECONDS))
      val next = Any()
      assertTrue(queue.offer(next))
      assertSame(next, queue.poll())
    } finally {
      finishNativeRelease.countDown()
      worker.join(2_000)
    }
    assertFalse(worker.isAlive)
    assertEquals(0, queue.size)
  }
}
