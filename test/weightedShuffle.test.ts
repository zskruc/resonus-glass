import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recommendationRandom } from '../src/lib/dailyRecommendations';
import { normalizeShuffleMode, SHUFFLE_MODES, shufflePlayCount, weightedShuffle } from '../src/lib/weightedShuffle';

test('every mode returns a permutation without changing the input or collapsing duplicate occurrences', () => {
  const first = { id: 'duplicate', title: 'First occurrence', artistId: 'a' };
  const second = { id: 'duplicate', title: 'Second occurrence', artistId: 'a' };
  const source = [first, second, { id: 'other', title: 'Other', artistId: 'b' }];
  for (const mode of SHUFFLE_MODES) {
    const output = weightedShuffle(source, mode, { duplicate: 100 }, recommendationRandom(mode));
    assert.notEqual(output, source); assert.equal(output.length, source.length);
    assert.equal(new Set(output).size, 3); assert.ok(output.includes(first) && output.includes(second));
  }
  assert.equal(source[0], first); assert.equal(source[1], second);
  assert.equal(normalizeShuffleMode('future-mode'), 'uniform');
});

test('frequent and rare song policies bias order in opposite directions while every song remains eligible', () => {
  const tracks = [{ id: 'known', playCount: 10 }, { id: 'new-a' }, { id: 'new-b' }];
  const trials = 10_000;
  const firstCount = (mode: typeof SHUFFLE_MODES[number]) => {
    const random = recommendationRandom(`trials-${mode}`);
    let first = 0;
    for (let index = 0; index < trials; index++) if (weightedShuffle(tracks, mode, { known: 1000 }, random)[0].id === 'known') first++;
    return first / trials;
  };
  assert.ok(firstCount('frequentSongs') > 0.7);
  assert.ok(firstCount('rareSongs') < 0.1);
  const uniform = firstCount('uniform'); assert.ok(uniform > 0.3 && uniform < 0.37);
  assert.equal(shufflePlayCount(tracks[0], { known: 20 }), 20, 'local and server counts overlap; do not add them');
  assert.equal(shufflePlayCount({ id: 'x', playCount: Infinity }, { x: -10 }), 0);
});

test('artist policies use candidate listening totals without letting a large catalogue artist dominate by row count', () => {
  const tracks = [...Array.from({ length: 10 }, (_, index) => ({ id: `a${index}`, artistId: 'a', playCount: 0 })),
    { id: 'b', artistId: 'b', playCount: 100 }];
  for (const mode of ['frequentArtists', 'rareArtists'] as const) {
    const random = recommendationRandom(mode); let b = 0;
    for (let index = 0; index < 10_000; index++) if (weightedShuffle(tracks, mode, {}, random)[0].artistId === 'b') b++;
    assert.ok(mode === 'frequentArtists' ? b > 7500 : b < 2500);
  }
});

test('large queues remain bounded by one priority per occurrence and malformed RNG values stay safe', () => {
  const source = Array.from({ length: 20_000 }, (_, index) => ({ id: String(index), artistId: String(index % 40), playCount: index % 200 }));
  let calls = 0;
  const result = weightedShuffle(source, 'frequentArtists', {}, () => { calls++; return calls % 2 ? Number.NaN : 1; });
  assert.equal(calls, source.length); assert.equal(result.length, source.length);
  assert.equal(new Set(result.map((song) => song.id)).size, source.length);
  assert.deepEqual(weightedShuffle([], 'rareSongs'), []);
});
