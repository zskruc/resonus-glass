import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLyricOffset, savedLyricOffsets, shiftSongLyrics } from '@/lib/lyricTiming';
import type { SongLyrics } from '@/api/subsonic';

test('per-song timing shifts main/overlapping/word end timestamps without touching source or repeated offsets', () => {
  const source: SongLyrics = Object.freeze({ synced: true, lines: Object.freeze([
    Object.freeze({ start: 1000, end: 2000, value: 'main', words: Object.freeze([
      Object.freeze({ start: 1000, end: 1300, value: 'ma' }), Object.freeze({ start: 1300, end: 2000, value: 'in' }),
    ]) }),
    Object.freeze({ start: 1100, value: '(harmony)', words: Object.freeze([{ start: 1100, end: 1900, value: '(harmony)' }]) }),
    Object.freeze({ start: 3000, value: 'next' }),
  ]) }) as unknown as SongLyrics;
  const shifted = shiftSongLyrics(source, 500)!;
  assert.deepEqual(shifted.lines.map((line) => line.start), [1500, 1600, 3500]);
  assert.equal((shifted.lines[0] as { end?: number }).end, 2500);
  assert.deepEqual(shifted.lines[0].words?.map((word) => [word.start, word.end]), [[1500, 1800], [1800, 2500]]);
  assert.equal(source.lines[0].start, 1000);
  assert.equal(shiftSongLyrics(source, 100)!.lines[0].start, 1100, 'derived again from the unmodified original, not cumulative');
  assert.deepEqual(shiftSongLyrics(source, -1800)!.lines[0].words?.map((word) => [word.start, word.end]), [[0, 0], [0, 200]]);
  assert.equal(shiftSongLyrics(source, 0), source);
});

test('plain/missing lyrics are unchanged and saved offsets reject malformed values', () => {
  const plain: SongLyrics = { synced: false, lines: [{ value: 'no clock' }] };
  assert.equal(shiftSongLyrics(plain, 200), plain);
  assert.equal(shiftSongLyrics(null, 200), null);
  assert.equal(normalizeLyricOffset(NaN), 0);
  assert.equal(normalizeLyricOffset(Infinity), 0);
  assert.equal(normalizeLyricOffset('200'), 0);
  assert.equal(normalizeLyricOffset(100_000), 15_000);
  assert.equal(normalizeLyricOffset(-100_000), -15_000);
  assert.equal(normalizeLyricOffset(116), 120);
  assert.deepEqual(savedLyricOffsets({ one: 200, bad: '200', empty: 0 }), { one: 200 });
  assert.deepEqual(savedLyricOffsets([100]), {});
});
