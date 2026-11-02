package expo.modules.upnpcast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GenericQueueProgressionTest {
  @Test fun repeatModesChooseExpectedIndex() {
    assertEquals(1, GenericQueueProgression.nextIndex(3, 0, "NORMAL"))
    assertNull(GenericQueueProgression.nextIndex(3, 2, "NORMAL"))
    assertEquals(0, GenericQueueProgression.nextIndex(3, 2, "REPEAT_ALL"))
    assertEquals(2, GenericQueueProgression.nextIndex(3, 2, "REPEAT_ONE"))
  }

  @Test fun nearEndIsMeasuredAgainstTheShorterLength() {
    assertTrue(GenericQueueProgression.isNearEnd(5_000, 6_000, 0))
    assertTrue(GenericQueueProgression.isNearEnd(17_000, 19_000, 0))
    assertFalse(GenericQueueProgression.isNearEnd(2_000, 60_000, 0))
    // A renderer guessing a transcoded stream at 300 s that runs out at 240 s.
    assertTrue(GenericQueueProgression.isNearEnd(239_000, 300_000, 240_000))
    assertFalse(GenericQueueProgression.isNearEnd(100_000, 300_000, 240_000))
  }

  @Test fun unknownLengthIsAnEndOnlyWhenAsked() {
    assertTrue(GenericQueueProgression.isNearEnd(1_000, 0, 0))
    assertFalse(GenericQueueProgression.isNearEnd(1_000, 0, 0, unknownIsEnd = false))
  }

  @Test fun addressesCompareAsRenderersHandThemBack() {
    val url = "http://nas:4533/rest/stream.view?id=a%2Fb&u=me&t=x+y"
    assertTrue(GenericQueueProgression.sameUri(url, url))
    assertTrue(GenericQueueProgression.sameUri(url, url.replace("&", "&amp;")))
    assertTrue(GenericQueueProgression.sameUri(url, "http://nas:4533/rest/stream.view?id=a/b&u=me&t=x+y"))
    assertTrue(GenericQueueProgression.sameUri(" $url ", url))
    assertFalse(GenericQueueProgression.sameUri(url, url.replace("id=a", "id=c")))
    assertFalse(GenericQueueProgression.sameUri(url, ""))
    assertFalse(GenericQueueProgression.sameUri(null, url))
  }
}
