import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMinidiscAlbumPalette, minidiscAlbumCoverSize } from '../src/lib/minidiscAlbumPalette';
import { paletteContrast } from '../src/lib/playerPalette';

test('album text remains readable on both ends of chromatic and neutral gradients', () => {
  for (const dark of [true, false]) {
    for (const seed of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFE15A', '#774D67', '#A1A1A1']) {
      const palette = buildMinidiscAlbumPalette(seed, dark);
      for (const background of [palette.backgroundTop, palette.background]) {
        assert.ok(paletteContrast(palette.text, background) >= 4.5, `${seed}, ${dark}: title`);
        assert.ok(paletteContrast(palette.textSecondary, background) >= 4.5, `${seed}, ${dark}: metadata`);
      }
      assert.ok(paletteContrast(palette.playLabel, '#FFFFFF') >= 4.5, `${seed}: play button`);
    }
  }
});

test('an appearance change recomputes raw artwork without keeping previous-theme color roles', () => {
  const dark = buildMinidiscAlbumPalette('#FAAE20', true);
  const light = buildMinidiscAlbumPalette('#FAAE20', false);
  assert.notEqual(dark.background, light.background);
  assert.deepEqual(buildMinidiscAlbumPalette('#FAAE20', true), dark);
  assert.equal(buildMinidiscAlbumPalette('transparent', false).background, '#FFFFFF');
  assert.equal(buildMinidiscAlbumPalette(undefined, true).background, '#141619');
});

test('album art uses source side margins while fitting small, wide and landscape screens', () => {
  assert.equal(minidiscAlbumCoverSize(480, 1000), 340);
  assert.equal(minidiscAlbumCoverSize(320, 700), 192);
  assert.equal(minidiscAlbumCoverSize(900, 400), 168);
  assert.equal(minidiscAlbumCoverSize(1024, 1366), 340);
});
