import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seekAndPlayAmllLyricLine, type AmllLyricPlaybackSnapshot } from '@/lib/amllLyricPlayback';

const current = (isPlaying: boolean): AmllLyricPlaybackSnapshot => ({
  songId: 'current', isPlaying, active: true, foreground: true,
});

test('tapping a paused current lyric seeks before resuming playback', () => {
  const calls: unknown[] = [];
  assert.equal(seekAndPlayAmllLyricLine('current', 28.5, {
    read: () => current(false), seekTo: (seconds) => calls.push(['seek', seconds]), resume: () => calls.push('play'),
  }), true);
  assert.deepEqual(calls, [['seek', 28.5], 'play']);
});

test('tapping an already playing lyric only seeks and never toggles playback into pause', () => {
  const calls: unknown[] = [];
  seekAndPlayAmllLyricLine('current', 0, {
    read: () => current(true), seekTo: (seconds) => calls.push(['seek', seconds]), resume: () => calls.push('play'),
  });
  assert.deepEqual(calls, [['seek', 0]]);
});

test('late lyric callbacks cannot seek another song or a hidden/backgrounded player', () => {
  let calls = 0;
  for (const snapshot of [
    { ...current(false), songId: 'next' }, { ...current(false), songId: undefined },
    { ...current(false), active: false }, { ...current(false), foreground: false },
  ]) {
    assert.equal(seekAndPlayAmllLyricLine('current', 12, {
      read: () => snapshot, seekTo: () => calls++, resume: () => calls++,
    }), false);
  }
  assert.equal(calls, 0);
});

test('a source/visibility/playback handoff during seek cannot resume a different or already playing source', () => {
  for (const after of [
    { ...current(false), songId: 'next' }, { ...current(false), active: false },
    { ...current(false), foreground: false }, current(true),
  ]) {
    let snapshot = current(false);
    let resumed = false;
    assert.equal(seekAndPlayAmllLyricLine('current', 12, {
      read: () => snapshot, seekTo: () => { snapshot = after; }, resume: () => { resumed = true; },
    }), true);
    assert.equal(resumed, false);
  }
});

test('malformed lyric times and missing song ownership are ignored', () => {
  let calls = 0;
  for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.equal(seekAndPlayAmllLyricLine('current', seconds, {
      read: () => current(false), seekTo: () => calls++, resume: () => calls++,
    }), false);
  }
  assert.equal(seekAndPlayAmllLyricLine(undefined, 10, {
    read: () => current(false), seekTo: () => calls++, resume: () => calls++,
  }), false);
  assert.equal(calls, 0);
});
