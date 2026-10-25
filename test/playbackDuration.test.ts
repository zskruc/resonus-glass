import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plausibleDuration } from '../src/lib/playbackDuration';

test('a transcode with an empty header keeps the song length and seek range', () => {
  assert.equal(plausibleDuration(0.026, 240, 240), 240);
  assert.equal(plausibleDuration(110, 240, 240), 240);
});

test('a valid local or renderer duration keeps its precise length', () => {
  assert.equal(plausibleDuration(239.812, 240, 240), 239.812);
  assert.equal(plausibleDuration(120, 240, 240), 120);
  assert.equal(plausibleDuration(300, 240, 240), 300);
});

test('unknown native length keeps the previously known length', () => {
  for (const duration of [undefined, 0, -1, NaN, Infinity]) {
    assert.equal(plausibleDuration(duration, 240, 240), 240);
  }
});

test('streams with no known song length accept a positive native length', () => {
  assert.equal(plausibleDuration(5.75, 0), 5.75);
  assert.equal(plausibleDuration(5.75, 0, 0), 5.75);
});
