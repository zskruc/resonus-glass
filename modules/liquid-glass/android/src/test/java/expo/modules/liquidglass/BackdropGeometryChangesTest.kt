package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class BackdropGeometryChangesTest {
  // Equal-looking replacements must still have distinct native identities.
  private data class Surface(var bounds: Long = 10L, var transform: Long = 1L,
    val isolated: Boolean = false)

  private class Scene : BackdropGeometryChanges.Observer<Surface> {
    val tracker = BackdropGeometryChanges<Surface>()
    val redraws = ArrayList<Surface>()
    val commits = ArrayList<List<Surface>>()
    private val pending = ArrayList<Surface>()
    var gpuBusy = false
    var notifiedWhileBusy = false
    override fun fingerprint(surface: Surface): Long = surface.bounds * 31L + surface.transform
    override fun changed(surface: Surface) {
      redraws.add(surface)
      pending.add(surface)
      if (gpuBusy) notifiedWhileBusy = true
    }
    override fun commitChanges() {
      commits.add(pending.toList())
      pending.clear()
    }
    fun update(vararg surfaces: Surface): Boolean = tracker.update(surfaces.asList(), this)
    fun settle(vararg surfaces: Surface) {
      update(*surfaces)
      redraws.clear()
      commits.clear()
    }
  }

  @Test fun nonIsolatedMovingMaterialRedrawsWithoutAScrim() {
    val scene = Scene()
    val surface = Surface(isolated = false)
    scene.settle(surface)
    surface.bounds++
    assertTrue(scene.update(surface))
    assertEquals(1, scene.redraws.size)
    assertSame(surface, scene.redraws.single())
  }

  @Test fun onlyTheChangedMaterialRedrawsInASharedWindow() {
    val scene = Scene()
    val first = Surface()
    val second = Surface()
    val third = Surface()
    scene.settle(first, second, third)
    second.bounds++
    assertTrue(scene.update(first, second, third))
    assertEquals(1, scene.redraws.size)
    assertSame(second, scene.redraws.single())
  }

  @Test fun busyCaptureDoesNotDelayTheDrawingNotification() {
    val scene = Scene()
    val surface = Surface()
    scene.settle(surface)
    scene.gpuBusy = true
    surface.bounds++
    assertTrue(scene.update(surface))
    // No image publication or free capture slot is needed by this observer.
    assertTrue(scene.notifiedWhileBusy)
    assertSame(surface, scene.redraws.single())
  }

  @Test fun stableGeometryDoesNotRepeatInvalidation() {
    val scene = Scene()
    val surface = Surface()
    scene.settle(surface)
    repeat(1_000) { assertFalse(scene.update(surface)) }
    assertTrue(scene.redraws.isEmpty())
  }

  @Test fun transformChangeRedrawsEvenWhenRoundedBoundsStayFixed() {
    val scene = Scene()
    val surface = Surface()
    scene.settle(surface)
    surface.transform++
    assertTrue(scene.update(surface))
    assertSame(surface, scene.redraws.single())
  }

  @Test fun hidingOneMaterialDoesNotInvalidateTheRemainingMaterial() {
    val scene = Scene()
    val first = Surface()
    val second = Surface()
    scene.settle(first, second)
    assertTrue(scene.update(first))
    assertTrue(scene.redraws.isEmpty())
    assertFalse(scene.update(first))
    assertTrue(scene.redraws.isEmpty())
  }

  @Test fun restoredVisibilityRefreshesTheCachedBackdropAtUnchangedBounds() {
    val scene = Scene()
    val first = Surface()
    val second = Surface()
    scene.settle(first, second)
    scene.update(first)
    scene.redraws.clear()
    assertTrue(scene.update(first, second))
    assertEquals(1, scene.redraws.size)
    assertSame(second, scene.redraws.single())
  }

  @Test fun equalLookingReplacementHasItsOwnDrawingObserver() {
    val scene = Scene()
    val old = Surface()
    val replacement = Surface()
    assertEquals(old, replacement)
    scene.settle(old)
    assertTrue(scene.update(replacement))
    assertEquals(1, scene.redraws.size)
    assertSame(replacement, scene.redraws.single())
  }

  @Test fun reorderingVisibleMembersDoesNotInvalidateThem() {
    val scene = Scene()
    val first = Surface()
    val second = Surface()
    scene.settle(first, second)
    assertFalse(scene.update(second, first))
    assertTrue(scene.redraws.isEmpty())
  }

  @Test fun detachedAndReattachedMaterialStartsAFreshObservation() {
    val scene = Scene()
    val surface = Surface()
    scene.settle(surface)
    scene.tracker.forget(surface)
    assertTrue(scene.update(surface))
    assertSame(surface, scene.redraws.single())
  }

  @Test fun emptySceneStopsReportingChangesAfterItsFirstRemoval() {
    val scene = Scene()
    scene.settle(Surface())
    assertTrue(scene.update())
    repeat(100) { assertFalse(scene.update()) }
    assertTrue(scene.redraws.isEmpty())
  }

  @Test fun clearingAClosedWindowDropsItsPriorGeometry() {
    val scene = Scene()
    val surface = Surface()
    scene.settle(surface)
    scene.tracker.clear()
    assertTrue(scene.update(surface))
    assertSame(surface, scene.redraws.single())
  }

  @Test fun aScrollingWindowCommitsAllMovedButtonsInOneSameFrameBatch() {
    val scene = Scene()
    val buttons = Array(20) { Surface(bounds = it.toLong()) }
    scene.settle(*buttons)
    scene.gpuBusy = true
    buttons.forEach { it.bounds += 5 }
    assertTrue(scene.update(*buttons))
    // All targets have been updated before one observer apply, even with both
    // image slots busy. No later image callback or VSync is needed.
    assertEquals(1, scene.commits.size)
    assertEquals(buttons.size, scene.commits.single().size)
    buttons.forEachIndexed { index, button -> assertSame(button, scene.commits.single()[index]) }
    assertTrue(scene.notifiedWhileBusy)
    scene.redraws.clear()
    scene.commits.clear()
    repeat(100) { assertFalse(scene.update(*buttons)) }
    assertTrue(scene.redraws.isEmpty())
    assertTrue(scene.commits.isEmpty())
  }

  @Test fun disappearanceAloneDoesNotApplyAndRestoredFirstGeometryIsCommittedImmediately() {
    val scene = Scene()
    val first = Surface()
    val second = Surface()
    scene.settle(first, second)
    assertTrue(scene.update(first))
    assertTrue(scene.commits.isEmpty())
    assertTrue(scene.update(first, second))
    assertEquals(1, scene.commits.size)
    assertEquals(1, scene.commits.single().size)
    assertSame(second, scene.commits.single().single())
  }

}
