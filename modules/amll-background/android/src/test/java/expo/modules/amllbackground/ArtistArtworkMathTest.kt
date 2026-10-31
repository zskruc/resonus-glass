package expo.modules.amllbackground

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

class ArtistArtworkMathTest {
  @Test fun `working images stay bounded and invalid native inputs are rejected`() {
    val typical = ArtistArtworkMath.geometry(1.0, 96.0 / 411.0)!!
    assertEquals(240, typical.width)
    assertEquals(240, typical.photoHeight)
    assertEquals(56, typical.extensionHeight)
    for (aspect in listOf(0.25, 0.5, 1.0, 2.0, 4.0)) for (extension in listOf(0.0, 0.25, 1.0)) {
      val geometry = ArtistArtworkMath.geometry(aspect, extension)!!
      assertTrue(geometry.width in 1..240)
      assertTrue(geometry.height <= 481)
    }
    for (invalid in listOf(Double.NaN, Double.POSITIVE_INFINITY, 0.0, -1.0, 20.0))
      assertNull(ArtistArtworkMath.geometry(invalid, 0.25))
    assertNull(ArtistArtworkMath.geometry(1.0, -1.0))
  }

  @Test fun `cover crop selects the center and tail repeats only the real last row`() {
    val source = IntArray(8 * 4) { index -> 0xff000000.toInt() or ((index % 8) shl 16) or (index / 8) }
    val crop = ArtistArtworkMath.coverCrop(source, 8, 4, 4, 4)
    assertEquals(source[2], crop[0])
    assertEquals(source[5], crop[3])
    val extended = ArtistArtworkMath.extendBottom(crop, 4, 4, 6)
    assertArrayEquals(crop, extended.copyOfRange(0, 16))
    for (row in 4 until 10) assertArrayEquals(crop.copyOfRange(12, 16), extended.copyOfRange(row * 4, row * 4 + 4))
    // This would fail if several bottom rows were magnified into the tail.
    assertNotEquals(crop[8], extended[4 * 4])
  }

  @Test fun `two dimensional blur spreads a feature equally across both axes`() {
    val width = 61
    val source = IntArray(width * width) { 0xff000000.toInt() }
    source[30 * width + 30] = -1
    val result = ArtistArtworkMath.gaussianApproximation(source, width, width, 4.5)
    for (distance in 1..10) {
      assertEquals(result[30 * width + 30 + distance], result[(30 + distance) * width + 30])
      assertEquals(result[30 * width + 30 + distance], result[30 * width + 30 - distance])
    }
    assertTrue((result[30 * width + 33] and 255) > 0)
  }

  @Test fun `the legacy fade helper remains continuous but is not applied to V3 fields`() {
    val geometry = ArtistArtworkMath.Geometry(100, 100, 25)
    assertEquals(1.0, ArtistArtworkMath.opacityAt(61, geometry), 0.00001)
    assertTrue(ArtistArtworkMath.opacityAt(100, geometry) in 0.2..0.4)
    assertTrue(ArtistArtworkMath.opacityAt(123, geometry) > 0.0)
    assertEquals(0.0, ArtistArtworkMath.opacityAt(124, geometry), 0.00001)
    for (row in 1 until geometry.height) {
      val before = ArtistArtworkMath.opacityAt(row - 1, geometry)
      val after = ArtistArtworkMath.opacityAt(row, geometry)
      assertTrue(after <= before)
      assertTrue(abs(before - after) < 0.05)
    }
  }

  @Test fun `raw lower color samples preserve bright center and independent side colors`() {
    val source = IntArray(100 * 100) { index ->
      val x = index % 100; val y = index / 100
      when { y < 80 -> 0xff000000.toInt(); x in 40..59 -> 0xffeeeeee.toInt(); else -> 0xff666666.toInt() }
    }
    val field = ArtistArtworkMath.prepare(source, 100, 100, ArtistArtworkMath.Geometry(100, 100, 25))
    assertEquals(0xff666666.toInt(), field.colors.lowerEdgeMean)
    assertEquals(0xffeeeeee.toInt(), field.colors.lowerCenterMean)
    assertEquals(0xff818181.toInt(), field.colors.lowerMean)
    assertEquals(0xff191919.toInt(), field.colors.average)
    // The field still has a brighter central region below the photo; it has
    // not collapsed to a flat palette color or darkened all the raw samples.
    val center = field.pixels[105 * 100 + 50]
    val edge = field.pixels[105 * 100 + 5]
    assertTrue((center and 255) > (edge and 255))
    assertTrue((center ushr 24) > 0)
    assertEquals(255, field.pixels.last() ushr 24)
  }

  @Test fun `transparent white artwork remains white through blur without a dark fringe`() {
    val source = IntArray(50 * 50) { index -> if (index % 50 < 25) 0x00ffffff else -1 }
    val field = ArtistArtworkMath.prepare(source, 50, 50, ArtistArtworkMath.Geometry(50, 50, 15))
    for (pixel in field.pixels) if (pixel ushr 24 > 0) {
      assertEquals(255, (pixel ushr 16) and 255)
      assertEquals(255, (pixel ushr 8) and 255)
      assertEquals(255, pixel and 255)
    }
    assertEquals(-1, field.colors.lowerMean)
  }

  @Test fun `a constant source gains neither invented hue nor a photo edge seam`() {
    val color = 0xff6b706c.toInt()
    val field = ArtistArtworkMath.prepare(IntArray(40 * 60) { color }, 40, 60,
      ArtistArtworkMath.Geometry(40, 40, 10))
    assertEquals(color, field.colors.average)
    for (pixel in field.pixels) assertEquals(color, pixel)
    fun alpha(row: Int) = field.pixels[row * 40] ushr 24
    val slopeAbove = alpha(39) - alpha(38)
    val slopeBelow = alpha(40) - alpha(39)
    assertTrue(abs(slopeAbove - slopeBelow) <= 4)
  }

  @Test fun `source background stays independent of cropped central white and brown clothing`() {
    for ((background, clothing) in listOf(0xff0a0a08.toInt() to 0xffddddda.toInt(),
      0xfff8f9fd.toInt() to 0xff8d603c.toInt())) {
      val source = IntArray(120 * 80) { index ->
        val x = index % 120; val y = index / 120
        if (x in 24..95 && y >= 2) clothing else background
      }
      // Portrait center-cover removes the original side margins completely.
      // Page color must still come from the untouched source, not that crop.
      val field = ArtistArtworkMath.prepare(source, 120, 80, ArtistArtworkMath.Geometry(40, 80, 10))
      assertEquals(background, field.colors.sourceBackground)
      assertEquals(clothing, field.colors.lowerMean)
      assertNotEquals(field.colors.lowerMean, field.colors.sourceBackground)
    }
  }

  @Test fun `source corners reject small highlights and transparent borders without inventing a hue`() {
    val background = 0xff40516b.toInt()
    val source = IntArray(100 * 100) { index ->
      val x = index % 100; val y = index / 100
      when {
        x < 12 && y < 20 -> 0x00ffffff
        x >= 97 && y < 4 -> -1
        x in 15..85 -> 0xffb86825.toInt()
        else -> background
      }
    }
    assertEquals(background, ArtistArtworkMath.sourceBackground(source, 100, 100))
    assertEquals(0xff808080.toInt(), ArtistArtworkMath.sourceBackground(IntArray(1) { 0x00ffffff }, 1, 1))
    assertEquals(-1, ArtistArtworkMath.sourceBackground(IntArray(1) { -1 }, 1, 1))
  }

  @Test fun `opacity and blur have no old internal easing pauses or derivative steps for the real short tail`() {
    val geometry = ArtistArtworkMath.Geometry(240, 240, 26)
    val h = geometry.photoHeight.toDouble()
    val epsilon = h * 0.0001
    val opacity = { y: Double -> ArtistArtworkMath.opacityAt(y, geometry) }
    val sigma = { y: Double -> ArtistArtworkMath.sigmaAt(y, geometry) }
    fun slope(f: (Double) -> Double, y: Double) = (f(y + epsilon) - f(y - epsilon)) / (2 * epsilon) * h
    fun curvature(f: (Double) -> Double, y: Double) =
      (f(y + epsilon) - 2 * f(y) + f(y - epsilon)) / (epsilon * epsilon) * h * h
    for (fraction in listOf(0.7, 0.74, 0.8, 0.9, 1.0)) {
      val y = fraction * h
      assertTrue("opacity must keep fading through $fraction", slope(opacity, y) < -0.1)
      assertTrue("blur must keep growing through $fraction", slope(sigma, y) > 0.1)
      assertEquals(curvature(opacity, y - epsilon * 2), curvature(opacity, y + epsilon * 2), 0.2)
      assertEquals(curvature(sigma, y - epsilon * 2), curvature(sigma, y + epsilon * 2), 4.0)
    }
    for (row in 1 until geometry.height) {
      assertTrue(opacity(row.toDouble()) <= opacity(row - 1.0))
      assertTrue(sigma(row.toDouble()) >= sigma(row - 1.0))
    }
    assertEquals(0.0, slope(opacity, h * 0.62), 0.001)
    assertEquals(0.0, slope(sigma, h * 0.62), 0.001)
    assertTrue(opacity(geometry.height - 2.0) > 0)
    assertEquals(0.0, opacity(geometry.height - 1.0), 0.0)
  }

  @Test fun `V3 preserves opaque coverage for the renderer single fade mask`() {
    val field = ArtistArtworkMath.prepare(IntArray(64 * 64) { 0xffdad6c4.toInt() }, 64, 64,
      ArtistArtworkMath.Geometry(64, 64, 22))
    assertEquals(64 * 86, field.pixels.size)
    for (pixel in field.pixels) assertEquals(255, pixel ushr 24)
    assertEquals(0xffdad6c4.toInt(), field.pixels.last())
    val transparent = ArtistArtworkMath.prepare(IntArray(8 * 8) { 0x00ffffff }, 8, 8,
      ArtistArtworkMath.Geometry(16, 16, 6))
    for (pixel in transparent.pixels) assertEquals(0, pixel)
  }

  @Test fun `blur preserves instrument detail before easing through the long tail`() {
    val geometry = ArtistArtworkMath.Geometry(240, 240, 84)
    assertEquals(0.0, ArtistArtworkMath.sigmaAt(240 * 0.62, geometry), 0.0)
    assertTrue(ArtistArtworkMath.sigmaAt(240 * 0.80, geometry) in 0.7..1.0)
    assertTrue(ArtistArtworkMath.sigmaAt(240 * 0.85, geometry) in 1.0..2.0)
    assertEquals(8.0, ArtistArtworkMath.sigmaAt(240 * 1.35, geometry), 0.00001)
    assertTrue(ArtistArtworkMath.sigmaAt(323, geometry) > 7.99)
    for (row in 1 until geometry.height) {
      assertTrue(ArtistArtworkMath.sigmaAt(row, geometry) >= ArtistArtworkMath.sigmaAt(row - 1, geometry))
      assertTrue(ArtistArtworkMath.sigmaAt(row, geometry) <= 8.0)
    }
  }

  @Test fun `raw source fingerprint is deterministic and independent from cover crop and extension`() {
    val source = IntArray(64 * 32) { index ->
      val x = index % 64; val y = index / 64
      0xff000000.toInt() or ((x * 3) shl 16) or ((y * 5) shl 8) or ((x + y) * 2)
    }
    val fingerprint = ArtistArtworkMath.sourceFingerprint(source, 64, 32)
    assertEquals(1536, fingerprint.length)
    assertTrue(fingerprint.matches(Regex("[0-9a-f]{1536}")))
    assertEquals(fingerprint, ArtistArtworkMath.sourceFingerprint(source, 64, 32))
    val square = ArtistArtworkMath.prepare(source, 64, 32, ArtistArtworkMath.Geometry(32, 32, 0))
    val portrait = ArtistArtworkMath.prepare(source, 64, 32, ArtistArtworkMath.Geometry(24, 48, 24))
    assertEquals(fingerprint, square.sourceFingerprint)
    assertEquals(fingerprint, portrait.sourceFingerprint)
    assertNotEquals(fingerprint, ArtistArtworkMath.sourceFingerprint(source.reversedArray(), 64, 32))
    val doubled = IntArray(128 * 64) { index -> source[(index / 128 / 2) * 64 + (index % 128 / 2)] }
    assertEquals(fingerprint, ArtistArtworkMath.sourceFingerprint(doubled, 128, 64))
  }

  @Test fun `source fingerprint handles tiny images and alpha without hidden RGB or crop colors`() {
    assertEquals("123456".repeat(256), ArtistArtworkMath.sourceFingerprint(intArrayOf(0xff123456.toInt()), 1, 1))
    assertEquals("000000".repeat(256), ArtistArtworkMath.sourceFingerprint(intArrayOf(0x00fffeef), 1, 1))
    val weighted = IntArray(32 * 16) { index -> if (index % 32 % 2 == 0) 0x80ff0000.toInt() else 0xff0000ff.toInt() }
    assertEquals("5500aa".repeat(256), ArtistArtworkMath.sourceFingerprint(weighted, 32, 16))
    for (aspect in listOf(0.25, 0.5, 1.0, 2.0, 4.0)) {
      val geometry = ArtistArtworkMath.geometry(aspect, 0.35)!!
      val field = ArtistArtworkMath.prepare(intArrayOf(0xff123456.toInt()), 1, 1, geometry)
      assertTrue(field.pixels.size <= 240 * 481)
      assertEquals(1536, field.sourceFingerprint.length)
    }
  }
}
