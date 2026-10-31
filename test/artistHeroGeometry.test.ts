import assert from 'node:assert/strict';
import { test } from 'node:test';

import { artistHeroGeometry, artistHeroOpacity } from '../src/lib/artistHeroGeometry';

test('artist photos keep their square frame instead of enlarging into the controls', () => {
  for (const width of [320, 411, 480, 520]) {
    const geometry = artistHeroGeometry(width, 96);
    assert.equal(geometry.photoHeight, width);
    assert.equal(geometry.totalHeight, width * 1.35);
    assert.ok(geometry.totalHeight >= width + 96, 'the independent backdrop covers all controls');
    assert.equal(geometry.photoHeight + geometry.extensionHeight, geometry.totalHeight);
    assert.equal(geometry.fadeStart * geometry.totalHeight, width * 0.52);
  }
});

test('one mask stays opaque before the reference start and finishes at the backdrop bottom', () => {
  const { totalHeight, fadeStart } = artistHeroGeometry(411, 96);
  const start = fadeStart * totalHeight;
  assert.equal(artistHeroOpacity(-20, 411, 96), 1);
  assert.equal(artistHeroOpacity(0, 411, 96), 1);
  assert.equal(artistHeroOpacity(start, 411, 96), 1);
  assert.ok(artistHeroOpacity(totalHeight - 1, 411, 96) > 0);
  assert.equal(artistHeroOpacity(totalHeight, 411, 96), 0);
  assert.equal(artistHeroOpacity(totalHeight + 100, 411, 96), 0);
  let previous = 1;
  for (let y = 0; y <= Math.ceil(totalHeight); y++) {
    const opacity = artistHeroOpacity(y, 411, 96);
    assert.ok(opacity >= 0 && opacity <= previous);
    previous = opacity;
  }
  const steps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  for (const progress of steps) {
    const y = start + (totalHeight - start) * progress;
    assert.ok(Math.abs(artistHeroOpacity(y, 411, 96) - (1 - progress)) < 1e-12);
  }
});

test('scene opacity follows the measured Apple Music Ayano margins without the compressed S-shaped band', () => {
  // Actual 1440x3120 reference screenshot, left margin x=4..32. Opacity is
  // recovered against the same raw photo's wall and the reference body color.
  // JPEG interpolation and progressively blurred edge pixels allow 0.04 error.
  const samples = [
    [750, 0.999], [850, 0.938], [950, 0.848], [1050, 0.767], [1150, 0.669],
    [1250, 0.584], [1350, 0.492], [1450, 0.433], [1550, 0.358], [1650, 0.272],
    [1750, 0.175], [1850, 0.066], [1950, 0],
  ];
  for (const [y, opacity] of samples) {
    assert.ok(Math.abs(artistHeroOpacity(y, 1440, 336) - opacity) <= 0.04,
      `reference alpha at y=${y}`);
  }
  assert.ok(artistHeroOpacity(1050, 1440, 336) < 0.8, 'fade cannot wait until the old 1050px plateau');
  assert.ok(artistHeroOpacity(1750, 1440, 336) > 0.1, 'the extension must not flatten at the old 1730px edge');
});

test('short landscape headers retain the full action height while keeping the photo independent', () => {
  const short = artistHeroGeometry(180, 96);
  assert.equal(short.photoHeight, 180);
  assert.equal(short.totalHeight, 276);
  assert.equal(short.extensionHeight, 96, 'short headers still cover the same controls');
  assert.ok(short.totalHeight < 300, 'the backdrop does not inherit a portrait-sized allocation');
  const tallActions = artistHeroGeometry(180, 120);
  assert.equal(tallActions.photoHeight, short.photoHeight, 'action area changes never zoom the photo');
  assert.equal(tallActions.totalHeight - short.totalHeight, 24);
  assert.equal(artistHeroOpacity(tallActions.totalHeight, 180, 120), 0);
});
