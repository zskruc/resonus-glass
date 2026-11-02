package expo.modules.amllbackground

import org.junit.Assert.*
import org.junit.Test

class PrimuseAlbumArtworkMathTest {
  @Test fun `achromatic artwork has no invented accent including transparent colored pixels`() {
    for (color in listOf(0xffffffff.toInt(), 0xff000000.toInt(), 0xff808080.toInt(), 0xff808183.toInt(), 0x00ff0000)) {
      assertNull(PrimuseAlbumArtworkMath.primary(IntArray(1600) { color }))
    }
  }

  @Test fun `small visible color marks on white survive while dark noise and three pixels do not`() {
    fun marked(color: Int, count: Int) = IntArray(1600) { if (it < count) color else 0xffffffff.toInt() }
    assertNull(PrimuseAlbumArtworkMath.primary(marked(0xffff0000.toInt(), 3)))
    assertEquals(0xffd91111.toInt(), PrimuseAlbumArtworkMath.primary(marked(0xffff0000.toInt(), 4)))
    assertNull(PrimuseAlbumArtworkMath.primary(marked(0xff330000.toInt(), 4)))
    assertNotNull(PrimuseAlbumArtworkMath.primary(marked(0xff330000.toInt(), 8)))
  }

  @Test fun `large pastel areas participate only after vivid candidates and marks are exhausted`() {
    val pastel = 0xffc8f0c8.toInt()
    val little = IntArray(1600) { if (it < 319) pastel else 0xffffffff.toInt() }
    assertNull(PrimuseAlbumArtworkMath.primary(little))
    little[319] = pastel
    assertEquals(0xff8dd98d.toInt(), PrimuseAlbumArtworkMath.primary(little))
    repeat(4) { little[1000 + it] = 0xffff0000.toInt() }
    assertEquals(0xffd91111.toInt(), PrimuseAlbumArtworkMath.primary(little))
  }

  @Test fun `saturation weighted buckets keep a smaller distinctive color over abundant beige`() {
    val sample = IntArray(1600) { when {
      it < 640 -> 0xffccad99.toInt()
      it < 704 -> 0xff0000cc.toInt()
      else -> 0xffcccccc.toInt()
    } }
    assertEquals(0xff1010cc.toInt(), PrimuseAlbumArtworkMath.primary(sample))
    val wrappedRed = IntArray(1600) { when {
      it < 5 -> 0xffff0010.toInt()
      it < 10 -> 0xffff1000.toInt()
      else -> 0xffffffff.toInt()
    } }
    val color = PrimuseAlbumArtworkMath.primary(wrappedRed)!!
    assertTrue(((color ushr 16) and 255) > 200)
    assertTrue(((color ushr 8) and 255) < 30)
    assertTrue((color and 255) < 30)
  }

  @Test fun `static field preserves a constant gray and softens both spatial directions`() {
    val size = 32
    val gray = PrimuseAlbumArtworkMath.texture(IntArray(size * size) { 0xff808080.toInt() }, size, size, 3.0)
    assertTrue(gray.all { it == 0xff404040.toInt() })
    val corner = IntArray(size * size) { if (it % size < 16 && it / size < 16) 0xffff0000.toInt() else 0xff0000ff.toInt() }
    val softened = PrimuseAlbumArtworkMath.texture(corner, size, size, 3.0)
    for (index in listOf(15 * size + 10, 10 * size + 15)) {
      val color = softened[index]
      assertTrue(((color ushr 16) and 255) > 0)
      assertTrue((color and 255) > 0)
    }
  }

  @Test fun `transparent edges stay premultiplied through blur without dark fringes`() {
    val size = 32
    val pixels = IntArray(size * size) { if (it % size in 10..21 && it / size in 10..21) 0xffffffff.toInt() else 0x00ffffff }
    val softened = PrimuseAlbumArtworkMath.texture(pixels, size, size, 3.0)
    assertTrue(softened.any { it ushr 24 in 1..254 })
    for (color in softened) if (color ushr 24 > 0) {
      assertEquals(128, (color ushr 16) and 255)
      assertEquals(128, (color ushr 8) and 255)
      assertEquals(128, color and 255)
    }
  }

  @Test fun `opaque core has a transparent blur halo without moving its center`() {
    val core = 32; val sigma = 3.0
    val geometry = PrimuseAlbumArtworkMath.textureGeometry(core, sigma)
    val source = IntArray(core * core) { 0xff808080.toInt() }
    val result = PrimuseAlbumArtworkMath.paddedTexture(source, core, sigma)
    assertEquals(54, geometry.side)
    assertEquals(11, geometry.padding)
    assertEquals(54.0 / 32, geometry.scale, 0.0)
    assertEquals(0xff404040.toInt(), result[(geometry.padding + core / 2) * geometry.side + geometry.padding + core / 2])
    for (coordinate in 0 until geometry.side) {
      assertEquals(0, result[coordinate] ushr 24)
      assertEquals(0, result[(geometry.side - 1) * geometry.side + coordinate] ushr 24)
      assertEquals(0, result[coordinate * geometry.side] ushr 24)
      assertEquals(0, result[coordinate * geometry.side + geometry.side - 1] ushr 24)
    }
    assertTrue(result[geometry.padding * geometry.side + geometry.side / 2] ushr 24 in 1..254)
    // Pixel symmetry proves padding is centered, rather than shifting the
    // visible artwork when the renderer expands the texture around its center.
    for (y in 0 until geometry.side) for (x in 0 until geometry.side) {
      assertEquals(result[y * geometry.side + x], result[y * geometry.side + geometry.side - x - 1])
      assertEquals(result[y * geometry.side + x], result[(geometry.side - y - 1) * geometry.side + x])
    }
  }

  @Test fun `blur geometry is finite bounded and cache quantization is stable`() {
    for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, -0.1, 0.25001)) {
      assertNull(PrimuseAlbumArtworkMath.normalizedBlurRatio(value))
    }
    assertEquals(0.0351, PrimuseAlbumArtworkMath.normalizedBlurRatio(20.0 / 570.0)!!, 0.0000001)
    assertEquals(0.0, PrimuseAlbumArtworkMath.normalizedBlurRatio(0.0)!!, 0.0)
  }
}
