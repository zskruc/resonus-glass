package expo.modules.liquidglass

import org.junit.Assert.assertEquals
import org.junit.Test

class MaterialTuningMaskTest {
  @Test fun tintEditsRetainTheSizeBoundedSearchLens() {
    val edge = AmPlusDockGeometry.edgeLens(43f, 43f, 24f)
    assertEquals(16.125f, edge, 0f)
    assertEquals(edge, MaterialTuningMask.lensAmount(edge, 24f, MaterialTuningMask.TINT_ALPHA), 0f)
    assertEquals(edge, MaterialTuningMask.lensHeight(edge, 24f, MaterialTuningMask.TINT_ALPHA), 0f)
  }

  @Test fun editingEitherLensAxisDoesNotReplaceTheOtherDefaultAxis() {
    val edge = 16.125f
    assertEquals(38f, MaterialTuningMask.lensAmount(edge, 38f, MaterialTuningMask.REFRACTION), 0f)
    assertEquals(edge, MaterialTuningMask.lensHeight(edge, 24f, MaterialTuningMask.REFRACTION), 0f)
    assertEquals(edge, MaterialTuningMask.lensAmount(edge, 24f, MaterialTuningMask.REFRACTION_HEIGHT), 0f)
    assertEquals(9f, MaterialTuningMask.lensHeight(edge, 9f, MaterialTuningMask.REFRACTION_HEIGHT), 0f)
  }

  @Test fun explicitZeroDisablesThatLensAxisAndResetRestoresThePreset() {
    val both = MaterialTuningMask.REFRACTION or MaterialTuningMask.REFRACTION_HEIGHT
    assertEquals(0f, MaterialTuningMask.lensAmount(16.125f, 0f, both), 0f)
    assertEquals(0f, MaterialTuningMask.lensHeight(16.125f, 0f, both), 0f)
    assertEquals(16.125f, MaterialTuningMask.lensAmount(16.125f, 48f, 0), 0f)
    assertEquals(16.125f, MaterialTuningMask.lensHeight(16.125f, 48f, 0), 0f)
  }
}
