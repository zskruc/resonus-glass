package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class MaterialAppearanceCommitsTest {
  private class Host {
    val queued = ArrayList<Runnable>()
    val posted = ArrayList<Runnable>()
    var cancellations = 0
    var invalidations = 0
    val commits = MaterialAppearanceCommits(
      postFrame = { queued.add(it); posted.add(it) },
      cancelFrame = { action -> queued.removeAll { it === action }; cancellations++ },
      invalidate = { invalidations++ }
    )
    fun frame() {
      val callbacks = queued.toList()
      queued.clear()
      callbacks.forEach { it.run() }
    }
    fun light(opacity: Float = .55f) = commits.commit(0xfffafafa.toInt(), opacity.toRawBits(), false)
    fun dark() = commits.commit(0xff121212.toInt(), .55f.toRawBits(), true)
  }

  @Test fun settledAppearanceDoesNotScheduleMoreFrames() {
    val host = Host()
    host.commits.attach()
    host.light()
    host.frame()
    repeat(1_000) { host.light(); host.frame() }
    assertEquals(1, host.posted.size)
    assertEquals(1, host.invalidations)
    assertTrue(host.queued.isEmpty())
  }

  @Test fun consecutiveCommitsCoalesceIntoOneStableFrameCallback() {
    val host = Host()
    host.commits.attach()
    host.light()
    host.dark()
    host.light()
    assertEquals(1, host.queued.size)
    assertEquals(0, host.invalidations)
    host.frame()
    assertEquals(1, host.invalidations)
    host.light()
    assertEquals(1, host.posted.size)
    host.dark()
    assertEquals(2, host.posted.size)
    assertSame(host.posted[0], host.posted[1])
    host.frame()
    assertEquals(2, host.invalidations)
  }

  @Test fun alternatingThemesRequestOneFrameAfterEachSuccessfulCommit() {
    val host = Host()
    host.commits.attach()
    repeat(8) { index ->
      if (index % 2 == 0) host.light() else host.dark()
      assertEquals(index + 1, host.posted.size)
      assertEquals(index, host.invalidations)
      host.frame()
      assertEquals(index + 1, host.invalidations)
    }
  }

  @Test fun everyAppearanceKeyParticipatesWithoutSchedulingForUnchangedValues() {
    val host = Host()
    host.commits.attach()
    host.light()
    host.frame()
    host.light(.30f)
    host.light(.30f)
    host.frame()
    assertEquals(2, host.invalidations)
    host.commits.commit(0xfffafafa.toInt(), .30f.toRawBits(), true)
    host.frame()
    assertEquals(3, host.invalidations)
    host.commits.commit(0xff121212.toInt(), .30f.toRawBits(), true)
    host.frame()
    assertEquals(4, host.invalidations)
    assertEquals(4, host.posted.size)
  }

  @Test fun detachmentCancelsOldWindowWorkAndReattachmentNeedsANewCommit() {
    val host = Host()
    host.commits.attach()
    host.light()
    host.commits.detach()
    assertEquals(1, host.cancellations)
    assertTrue(host.queued.isEmpty())
    host.frame()
    host.dark()
    assertEquals(1, host.posted.size)
    assertEquals(0, host.invalidations)
    host.commits.attach()
    assertTrue(host.queued.isEmpty())
    host.light()
    assertEquals(2, host.posted.size)
    assertSame(host.posted[0], host.posted[1])
    host.frame()
    assertEquals(1, host.invalidations)
  }

  @Test fun preAttachmentCommitsDoNotConsumeTheFirstAttachedAppearance() {
    val host = Host()
    host.light()
    assertTrue(host.posted.isEmpty())
    host.commits.attach()
    host.light()
    assertEquals(1, host.queued.size)
    host.frame()
    assertEquals(1, host.invalidations)
    host.commits.detach()
    host.commits.detach()
    assertEquals(0, host.cancellations)
  }
}
