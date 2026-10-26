import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lyricClockPlan, retainedLyricFocus } from '@/lib/lyricLifecycle';

describe('retained lyric view lifetime', () => {
  const lines = [{ start: 1000 }, { start: 4000 }, { start: 8000 }];

  it('keeps the committed lyric line while inactive even as audio advances or seeks', () => {
    const committed = retainedLyricFocus(lines, 4, false, true, -1);
    assert.equal(committed, 1);
    for (const position of [0, 2, 8, 100]) {
      assert.equal(retainedLyricFocus(lines, position, false, false, committed), committed);
    }
  });

  it('resumes against the latest position and preserves existing word and line pre-roll', () => {
    assert.equal(retainedLyricFocus(lines, 8, true, true, 1), 2);
    assert.equal(retainedLyricFocus(lines, 0.8, false, true, -1), 0);
    assert.equal(retainedLyricFocus(lines, 0.8, true, true, -1), -1);
    assert.equal(retainedLyricFocus(lines, 0.9, true, true, -1), 0);
  });

  it('cancels without resetting an in-progress sweep or bounce to a new audio timestamp', () => {
    for (const position of [0, 4.5, 80]) for (const playing of [true, false]) {
      const plan = lyricClockPlan(position, playing, 1.5, false);
      assert.equal(plan, null);
    }
  });

  it('restarts a visible playing clock from current audio time and stops a paused clock exactly there', () => {
    assert.deepEqual(lyricClockPlan(80, true, 1.5, true),
      { startMs: 80000, targetMs: 81800, durationMs: 1200 });
    assert.deepEqual(lyricClockPlan(81, false, 1.5, true),
      { startMs: 81000, targetMs: 81000, durationMs: 0 });
    assert.deepEqual(lyricClockPlan(4, true, 1),
      { startMs: 4000, targetMs: 5200, durationMs: 1200 });
  });

  it('never sends a negative or invalid playback clock into native animation', () => {
    assert.deepEqual(lyricClockPlan(Number.NaN, true, Number.NaN),
      { startMs: 0, targetMs: 1200, durationMs: 1200 });
    assert.deepEqual(lyricClockPlan(-5, true, 0),
      { startMs: 0, targetMs: 1200, durationMs: 1200 });
  });
});
