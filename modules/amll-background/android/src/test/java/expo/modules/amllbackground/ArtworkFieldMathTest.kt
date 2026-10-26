package expo.modules.amllbackground

import org.junit.Assert.*
import org.junit.Test

class ArtworkFieldMathTest {
  @Test fun `neutral and monochrome art never acquire an invented hue`() {
    for (value in 0..255) {
      val color = ArtworkFieldMath.shapeColor((255 shl 24) or (value shl 16) or (value shl 8) or value)
      assertEquals(255, color ushr 24)
      assertEquals((color ushr 16) and 255, (color ushr 8) and 255)
      assertEquals((color ushr 8) and 255, color and 255)
    }
    assertEquals(0xff1f1f1f.toInt(), ArtworkFieldMath.shapeColor(0xff000000.toInt()))
    assertEquals(0xffa1a1a1.toInt(), ArtworkFieldMath.shapeColor(0xffffffff.toInt()))
    assertEquals(ArtworkFieldMath.shapeColor(0), ArtworkFieldMath.shapeColor(0x00ffffff))
  }

  @Test fun `softening preserves constant fields and blends adjacent color regions`() {
    val flat = IntArray(32 * 32) { 0xff58749a.toInt() }
    ArtworkFieldMath.soften(flat, 32, 32)
    assertTrue(flat.all { it == 0xff58749a.toInt() })
    val split = IntArray(32 * 32) { if (it % 32 < 16) 0xffff0000.toInt() else 0xff0000ff.toInt() }
    ArtworkFieldMath.soften(split, 32, 32)
    val boundary = split[16 * 32 + 15]
    assertTrue((boundary and 255) > 0)
    assertTrue(((boundary ushr 16) and 255) > 0)
    assertEquals(0xffff0000.toInt(), split[0])
    assertEquals(0xff0000ff.toInt(), split[31])
  }

  @Test fun `every screen uses a bounded offscreen buffer including landscape and zero size`() {
    assertEquals(1 to 1, ArtworkFieldMath.bufferSize(0, 0))
    assertEquals(118 to 256, ArtworkFieldMath.bufferSize(1440, 3120))
    assertEquals(256 to 118, ArtworkFieldMath.bufferSize(3120, 1440))
    for ((w, h) in listOf(1440 to 3120, 3120 to 1440, 2560 to 2560, 80 to 180)) {
      val (bw, bh) = ArtworkFieldMath.bufferSize(w, h)
      assertTrue(bw in 1..256 && bh in 1..256)
      assertEquals(w.toDouble() / h, bw.toDouble() / bh, 0.01)
    }
  }

  @Test fun `flow stays continuous covers all four edges and never folds cells`() {
    val side = ArtworkFieldMath.MESH_SIZE + 1
    val vertices = FloatArray(side * side * 2)
    for (time in listOf(0.0, 0.1, 10.0, 50.0, 100.0, 500.0, 5000.0)) {
      ArtworkFieldMath.fillVertices(vertices, 118, 256, time)
      assertTrue(vertices.all { it.isFinite() })
      for (i in 0 until side) {
        assertTrue(vertices[i * 2 + 1] < 0f)
        assertTrue(vertices[((side - 1) * side + i) * 2 + 1] > 256f)
        assertTrue(vertices[(i * side) * 2] < 0f)
        assertTrue(vertices[(i * side + side - 1) * 2] > 118f)
      }
      for (row in 0 until side - 1) for (column in 0 until side - 1) {
        val a = (row * side + column) * 2
        val b = a + 2
        val c = a + side * 2
        val d = c + 2
        fun cross(p: Int, q: Int, r: Int) =
          (vertices[q] - vertices[p]) * (vertices[r + 1] - vertices[p + 1]) -
            (vertices[q + 1] - vertices[p + 1]) * (vertices[r] - vertices[p])
        assertTrue(cross(a, b, c) > 0f)
        assertTrue(cross(b, d, c) > 0f)
      }
    }
    ArtworkFieldMath.fillVertices(vertices, 118, 256, 100.0)
    val next = vertices.copyOf()
    ArtworkFieldMath.fillVertices(next, 118, 256, 100.0 + 1.0 / 60.0)
    assertTrue(vertices.indices.all { kotlin.math.abs(next[it] - vertices[it]) < 0.1f })
  }

  @Test fun `background caps its work without forcing a 120 Hz UI down to 60 Hz`() {
    val clock = BackgroundFrameClock()
    var renders = 0
    for (frame in 0..120) {
      if (clock.advance(1_000_000_000L + frame * 8_333_333L)) renders++
    }
    assertEquals(61, renders)
    assertEquals(1.0, clock.seconds, 0.0001)
    clock.stop()
    assertTrue(clock.advance(90_000_000_000L))
    assertEquals(1.0, clock.seconds, 0.0001)
    clock.advance(90_016_666_667L)
    assertEquals(1.0 + 1.0 / 60.0, clock.seconds, 0.0001)
  }

  @Test fun `old async decodes cannot win after source replacement or detach`() {
    val generation = ArtworkGeneration()
    val first = generation.next()
    assertTrue(generation.accepts(first))
    val replacement = generation.next()
    assertFalse(generation.accepts(first))
    assertTrue(generation.accepts(replacement))
    generation.next()
    assertFalse(generation.accepts(replacement))
  }
}
