import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { artistPhotoFingerprintMetrics, artistPhotoFingerprintsMatch, isArtistPhotoFingerprint } from '../src/lib/artistPhotoFingerprint';

const pixels = Array.from({ length: 256 }, (_, i) => {
  const x = i % 16; const y = Math.floor(i / 16);
  return [25 + x * 10 + y, 15 + y * 11 + x * 2, 20 + x * 6 + y * 7];
});
const fingerprint = (cells: number[][]) => cells.flat().map((value) => Math.max(0, Math.min(255, Math.round(value)))
  .toString(16).padStart(2, '0')).join('');
const source = fingerprint(pixels);

describe('bounded artist photograph content verification', () => {
  it('accepts real Navidrome 300 and 1200 WebP renditions against official 600px JPEG while rejecting cross-artist photos', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/apple-artist-photo-fingerprints.json', import.meta.url), 'utf8')).samples;
    for (const name of ['taylor', 'eason']) for (const rendition of ['served-verified', 'served-1200']) {
      const current = fixture[`${name}-${rendition}`];
      assert.equal(artistPhotoFingerprintsMatch(current, fixture[`${name}-candidate600`]), true);
      const other = name === 'taylor' ? 'eason' : 'taylor';
      assert.equal(artistPhotoFingerprintsMatch(current, fixture[`${other}-candidate600`]), false);
    }
  });

  it('accepts the same structured photograph and small resize/JPEG channel noise', () => {
    assert.equal(isArtistPhotoFingerprint(source), true);
    assert.equal(artistPhotoFingerprintsMatch(source, source), true);
    const compressed = fingerprint(pixels.map((pixel, i) => pixel.map((value, c) => value + (i * 3 + c) % 5 - 2)));
    assert.equal(artistPhotoFingerprintsMatch(source, compressed), true);
    assert.ok(artistPhotoFingerprintMetrics(source, compressed)!.correlation > .995);
  });

  it('rejects different composition, a changed face region, exposure changes and same-histogram shuffled content', () => {
    const shifted = fingerprint(pixels.map((_, i) => pixels[Math.floor(i / 16) * 16 + (i + 1) % 16]));
    const region = fingerprint(pixels.map((pixel, i) => i === 87 ? pixel.map((value) => value + 65) : pixel));
    const exposure = fingerprint(pixels.map((pixel) => pixel.map((value) => value + 20)));
    const reversed = fingerprint([...pixels].reverse());
    for (const different of [shifted, region, exposure, reversed]) assert.equal(artistPhotoFingerprintsMatch(source, different), false);
  });

  it('does not identify blank/near-uniform placeholders or malformed data as the same artist', () => {
    const flat = '101010'.repeat(256);
    const nearFlat = fingerprint(pixels.map((_, i) => [16 + i % 3, 16, 16]));
    for (const value of [flat, nearFlat]) assert.equal(artistPhotoFingerprintsMatch(value, value), false);
    for (const value of ['', source.slice(0, -1), 'g'.repeat(1536), '00'.repeat(16)]) {
      assert.equal(isArtistPhotoFingerprint(value), false); assert.equal(artistPhotoFingerprintsMatch(source, value), false);
    }
  });
});
