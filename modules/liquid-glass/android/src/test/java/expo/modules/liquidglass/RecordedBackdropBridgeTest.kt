package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordedBackdropBridgeTest {
  private val geometry = RecordedBackdropGeometry(.5f, 64, 1536, 480, 256)

  private class BorrowedNode : AutoCloseable {
    var closed = false
    override fun close() { closed = true }
  }

  private fun RecordedBackdropBridge<BorrowedNode>.publishValid(
    node: BorrowedNode = BorrowedNode(),
    shape: RecordedBackdropGeometry = geometry,
    pageEpoch: Long = 3,
    generation: Long = 8,
    serial: Long = recordSerial,
    currentPageEpoch: Long = pageEpoch,
    currentGeneration: Long = generation,
    captureAllowed: Boolean = true,
    mask: Int = RecordedBackdropEligibility.REQUIRED
  ) = publish(node, shape, pageEpoch, generation, serial, currentPageEpoch,
    currentGeneration, captureAllowed, mask)

  @Test fun frozenRoiCoordinatesMapSamplePixelsIntoTheCurrentMaterialOrigin() {
    assertTrue(geometry.isValid())
    assertEquals(2f, geometry.inverseScale, 0f)
    assertEquals(-36f, geometry.localX(0f, 100), 0f)
    assertEquals(-64f, geometry.localY(0f, 1600), 0f)
    assertEquals(164f, geometry.localX(100f, 100), 0f)
    assertEquals(64f, geometry.localY(64f, 1600), 0f)
    // Quantized physical backing can be larger than the requested ROI. Its
    // complete declared extent must keep the same pixel-to-screen transform.
    assertEquals(924f, geometry.localX(480f, 100), 0f)
    assertEquals(448f, geometry.localY(256f, 1600), 0f)
  }

  @Test fun coordinateSubtractionDoesNotOverflowSignedIntegerOrigins() {
    val extreme = RecordedBackdropGeometry(1f, Int.MAX_VALUE, Int.MIN_VALUE, 1, 1)
    assertTrue(extreme.localX(0f, Int.MIN_VALUE) > 0f)
    assertTrue(extreme.localY(0f, Int.MAX_VALUE) < 0f)
  }

  @Test fun invalidScaleCapacityOrPhysicalExtentCannotEnterTheBridge() {
    val invalid = listOf(
      geometry.copy(scale = 0f), geometry.copy(scale = -.5f),
      geometry.copy(scale = Float.NaN), geometry.copy(scale = Float.POSITIVE_INFINITY),
      geometry.copy(scale = Float.MIN_VALUE), geometry.copy(pixelWidth = 0),
      geometry.copy(pixelHeight = -1), geometry.copy(scale = 1e-30f, pixelWidth = Int.MAX_VALUE)
    )
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    bridge.beginRecord()
    for (shape in invalid) {
      assertFalse(shape.isValid())
      assertFalse(bridge.publishValid(shape = shape))
      assertNull(bridge.value)
    }
  }

  @Test fun everyMissingSafetyConditionRejectsReplayIncludingInvisibleRegisteredConsumers() {
    val conditions = listOf(
      RecordedBackdropEligibility.ASYNC, RecordedBackdropEligibility.ACTIVITY,
      RecordedBackdropEligibility.NON_WINDOW_SOURCE, RecordedBackdropEligibility.NO_SOURCE_CONSUMERS,
      RecordedBackdropEligibility.NO_PROGRESSIVE, RecordedBackdropEligibility.NO_PATCH,
      RecordedBackdropEligibility.NO_IMAGE, RecordedBackdropEligibility.SOURCE_DRAWABLE,
      RecordedBackdropEligibility.RECORDED, RecordedBackdropEligibility.SYNC_OK
    )
    assertTrue(RecordedBackdropEligibility.allows(RecordedBackdropEligibility.REQUIRED))
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    bridge.beginRecord()
    for (condition in conditions) {
      val missing = RecordedBackdropEligibility.REQUIRED and condition.inv()
      assertFalse(RecordedBackdropEligibility.allows(missing))
      assertFalse(bridge.publishValid(mask = missing))
      assertNull(bridge.value)
    }
    // Visibility is deliberately not a bypass. A hidden attached consumer
    // removes NO_SOURCE_CONSUMERS just like a visible one.
    assertFalse(bridge.publishValid(mask = RecordedBackdropEligibility.REQUIRED and
      RecordedBackdropEligibility.NO_SOURCE_CONSUMERS.inv()))
  }

  @Test fun aNodeRequiresACompletedRecordBeforeItCanBePublished() {
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    assertFalse(bridge.publishValid())
    assertEquals(1L, bridge.beginRecord())
    val node = BorrowedNode()
    assertTrue(bridge.publishValid(node))
    assertSame(node, bridge.current(3, 8, true)?.content)
  }

  @Test fun sameNodeRerecordInvalidatesItsOldCoordinateMetadataBeforeMutation() {
    val node = BorrowedNode()
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    val firstSerial = bridge.beginRecord()
    assertTrue(bridge.publishValid(node))
    val nextSerial = bridge.beginRecord()
    assertEquals(firstSerial + 1L, nextSerial)
    assertNull(bridge.value)
    assertNull(bridge.current(3, 8, true))
    assertFalse(bridge.publishValid(node, serial = firstSerial))
    val nextShape = geometry.copy(screenY = 1792)
    assertTrue(bridge.publishValid(node, shape = nextShape))
    assertSame(node, bridge.current(3, 8, true)?.content)
    assertEquals(1792, bridge.current(3, 8, true)?.geometry?.screenY)
    assertFalse(node.closed)
  }

  @Test fun pageEpochRendererGenerationAndDrawableReadinessAreCheckedAgainOnRead() {
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    bridge.beginRecord()
    assertTrue(bridge.publishValid())
    assertNull(bridge.current(4, 8, true))
    assertNull(bridge.current(3, 9, true))
    assertNull(bridge.current(3, 8, false))
    assertTrue("the caller still owns explicit clear/logging", bridge.value != null)
  }

  @Test fun lateOldPageOrRendererTicketsCannotOverwriteAnAlreadyFreshBridge() {
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    bridge.beginRecord()
    assertTrue(bridge.publishValid())
    val accepted = bridge.value
    // A previous page's asynchronous ticket can arrive after the new page has
    // already recorded a valid bridge in the SAME renderer generation. Hold
    // serial constant so this assertion specifically exercises the epoch gate.
    assertFalse(bridge.publishValid(pageEpoch = 2, generation = 8,
      currentPageEpoch = 3, currentGeneration = 8))
    assertSame(accepted, bridge.value)
    // A resized/dropped renderer's late ticket must preserve the fresh entry too.
    assertFalse(bridge.publishValid(pageEpoch = 3, generation = 7,
      currentPageEpoch = 3, currentGeneration = 8))
    assertSame(accepted, bridge.value)
    assertFalse(bridge.publishValid(serial = bridge.recordSerial - 1))
    assertFalse(bridge.publishValid(captureAllowed = false))
    assertFalse(bridge.publishValid(mask = 0))
    assertFalse(bridge.publishValid(shape = geometry.copy(pixelHeight = 0)))
    assertSame(accepted, bridge.value)
  }

  @Test fun clearAndReleaseOnlyForgetBorrowedContentWithoutDisposingTheProducerNode() {
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    val node = BorrowedNode()
    bridge.beginRecord()
    assertTrue(bridge.publishValid(node))
    val previous = bridge.value
    assertSame(previous, bridge.clear())
    assertNull(bridge.value)
    assertNull(bridge.clear())
    assertFalse(node.closed)
    // Renderer release advances its generation; an old borrowed record cannot
    // be reintroduced merely because its display list still exists.
    assertFalse(bridge.publishValid(node, generation = 8, currentGeneration = 9))
    assertFalse(node.closed)
  }

  @Test fun anOlderFailedDeliveryCannotClearANewerRecordInTheSamePageAndRenderer() {
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    val node = BorrowedNode()
    val oldSerial = bridge.beginRecord()
    assertTrue(bridge.publishValid(node))
    val currentSerial = bridge.beginRecord()
    assertTrue(bridge.publishValid(node))
    val fresh = bridge.value
    assertNull(bridge.clearIfMatches(3, 8, oldSerial))
    assertSame(fresh, bridge.value)
    assertNull(bridge.clearIfMatches(2, 8, currentSerial))
    assertSame(fresh, bridge.value)
    assertNull(bridge.clearIfMatches(3, 7, currentSerial))
    assertSame(fresh, bridge.value)
    assertSame(fresh, bridge.clearIfMatches(3, 8, currentSerial))
    assertNull(bridge.value)
    assertFalse(node.closed)
  }

  @Test fun directReplayKeepsEverySourceSafetyGateWithoutRequiringAnOffscreenSubmit() {
    val safety = listOf(RecordedBackdropEligibility.ASYNC, RecordedBackdropEligibility.ACTIVITY,
      RecordedBackdropEligibility.NON_WINDOW_SOURCE, RecordedBackdropEligibility.NO_SOURCE_CONSUMERS,
      RecordedBackdropEligibility.NO_PROGRESSIVE, RecordedBackdropEligibility.NO_PATCH,
      RecordedBackdropEligibility.SOURCE_DRAWABLE)
    val mask = RecordedBackdropEligibility.REQUIRED and
      (RecordedBackdropEligibility.NO_IMAGE or RecordedBackdropEligibility.SYNC_OK).inv()
    assertTrue(RecordedBackdropEligibility.allowsDirect(mask))
    assertFalse(RecordedBackdropEligibility.allows(mask))
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    val serial = bridge.beginRecord()
    for (gate in safety) {
      val missing = mask and gate.inv()
      assertFalse(RecordedBackdropEligibility.allowsDirect(missing))
      assertFalse(bridge.publish(BorrowedNode(), geometry, 3, 8, serial, 3, 8, true, missing, direct = true))
      assertNull(bridge.value)
    }
    // Even a fully safe source cannot publish until begin/endRecording completed.
    assertFalse(bridge.publish(BorrowedNode(), geometry, 3, 8, serial, 3, 8, true,
      mask and RecordedBackdropEligibility.RECORDED.inv(), direct = true))
    assertTrue(bridge.publish(BorrowedNode(), geometry, 3, 8, serial, 3, 8, true, mask, direct = true))
    assertTrue(bridge.current(3, 8, true) != null)
  }

  @Test fun directPublicationRetiresOldImagesAcrossClearAndAllowsOnlySubsequentImageRecords() {
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    val imageSerial = bridge.beginRecord()
    assertTrue(bridge.acceptsImage(imageSerial))
    val directSerial = bridge.beginRecord()
    assertTrue(bridge.publish(BorrowedNode(), geometry, 3, 8, directSerial, 3, 8, true,
      RecordedBackdropEligibility.REQUIRED, direct = true))
    assertFalse(bridge.acceptsImage(imageSerial))
    assertFalse(bridge.acceptsImage(directSerial))
    bridge.clear() // unsafe page/shape must not revive an old queued ImageReader result
    assertFalse(bridge.acceptsImage(imageSerial))
    val nextImageSerial = bridge.beginRecord()
    assertTrue(bridge.acceptsImage(nextImageSerial))
    assertFalse(bridge.acceptsImage(directSerial))
  }

  @Test fun rejectedDirectPublicationsCannotRetireNewerImageOwnership() {
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    val serial = bridge.beginRecord()
    for ((epoch, generation, allowed) in listOf(Triple(2L, 8L, true), Triple(3L, 7L, true),
      Triple(3L, 8L, false))) {
      assertFalse(bridge.publish(BorrowedNode(), geometry, epoch, generation, serial, 3, 8, allowed,
        RecordedBackdropEligibility.REQUIRED, direct = true))
      assertTrue(bridge.acceptsImage(serial))
    }
    assertFalse(bridge.publish(BorrowedNode(), geometry.copy(scale = 0f), 3, 8, serial, 3, 8, true,
      RecordedBackdropEligibility.REQUIRED, direct = true))
    assertTrue(bridge.acceptsImage(serial))
  }

  @Test fun directNodeIsReusedButAnOldPageOrSerialCanNeverReintroduceItsCoordinates() {
    val bridge = RecordedBackdropBridge<BorrowedNode>()
    val node = BorrowedNode()
    val first = bridge.beginRecord()
    assertTrue(bridge.publish(node, geometry, 3, 8, first, 3, 8, true,
      RecordedBackdropEligibility.REQUIRED, direct = true))
    val second = bridge.beginRecord()
    assertNull(bridge.value) // withdrawn before the shared display list is mutated
    assertFalse(bridge.publish(node, geometry, 3, 8, first, 4, 8, true,
      RecordedBackdropEligibility.REQUIRED, direct = true))
    val nextGeometry = geometry.copy(screenY = 1700)
    assertTrue(bridge.publish(node, nextGeometry, 4, 8, second, 4, 8, true,
      RecordedBackdropEligibility.REQUIRED, direct = true))
    assertSame(node, bridge.current(4, 8, true)?.content)
    assertEquals(1700, bridge.current(4, 8, true)?.geometry?.screenY)
    assertNull(bridge.current(3, 8, true))
    assertNull(bridge.current(4, 8, false))
    assertFalse(node.closed)
  }

}
