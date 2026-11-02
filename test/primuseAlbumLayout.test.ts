import assert from 'node:assert/strict';
import { test } from 'node:test';
import { primuseAlbumFade, primuseAlbumLayout, primuseAlbumWindow } from '../src/lib/primuseAlbumLayout';

test('the centred portrait cover fits the album column below Android navigation', () => {
  for (const width of [320, 360, 412, 480]) {
    const layout = primuseAlbumLayout(width, 900, 24, 16);
    assert.equal(layout.coverSide, 190);
    assert.equal(layout.coverCenterX, width / 2);
    assert.equal(layout.topPadding, 76);
    assert.ok(layout.coverCenterX - layout.coverSide / 2 >= 20);
    assert.ok(layout.blurRatio > 0 && layout.blurRatio < .1);
  }
});

test('landscape uses a small side cover while accessibility text restores a stacked identity', () => {
  const compact = primuseAlbumLayout(900, 412, 0, 90);
  assert.equal(compact.coverSide, 88);
  assert.equal(compact.stacked, false);
  assert.equal(compact.topPadding, 60);
  assert.equal(compact.coverCenterX, 90 + 4 + 44);
  const accessible = primuseAlbumLayout(900, 412, 0, 90, 2);
  assert.equal(accessible.stacked, true);
  assert.equal(accessible.coverCenterX, 450);
});

test('the full blur fade always reaches transparency inside the measured header', () => {
  for (const height of [120, 260, 500, 700]) {
    const stops = primuseAlbumFade(height, 290);
    assert.equal(stops[0], 0);
    assert.ok(stops.every((stop, index) => stop >= 0 && stop <= 1 && (index === 0 || stop > stops[index - 1])));
    assert.ok(stops[3] * height <= height);
  }
});

test('revealing search extends the same blur upward without moving the cover or its lower fade', () => {
  for (const height of [260, 500, 700]) {
    const original = primuseAlbumWindow(height, 290);
    for (const extension of [72, 166, 208]) {
      const expanded = primuseAlbumWindow(height, 290, extension);
      // With its parent translated by the search height, the expanded window
      // still reaches the screen top. The image remains centred on the cover.
      assert.equal(extension + expanded.top, 0);
      assert.equal(expanded.top + expanded.contentTop + 190, 190);
      for (let index = 1; index < 4; index++) {
        assert.ok(Math.abs(expanded.top + expanded.fade[index] * expanded.height
          - original.fade[index] * original.height) < 1e-9, 'the lower gradient cannot jump on reveal');
      }
      assert.ok(expanded.fade.every((stop, index) => stop >= 0 && stop <= 1 && (index === 0 || stop > expanded.fade[index - 1])));
    }
    assert.deepEqual(original.fade, primuseAlbumFade(height, 290));
  }
});
