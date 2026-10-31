import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isLocalSilenceUri, normalizeSilenceBounds, normalizeSilenceTrimPreferences,
  SILENCE_TRIM_DEFAULTS, SilenceTrimSession } from '../src/lib/silenceTrim';

const bounds = { fingerprint: 'file.v1', durationSec: 200, startSec: 2.4, endSec: 196.5, complete: true };
const clock = { positionSec: 0, durationSec: 200, playing: true, loaded: true, buffering: false };
const session = (allowLeading = true) => { const s = new SilenceTrimSession(); s.begin('one', allowLeading); s.accept('one', bounds); return s; };

test('edge trimming is opt-in, bounded, finite and accepts only explicit local media', () => {
  assert.equal(SILENCE_TRIM_DEFAULTS.enabled, false);
  assert.deepEqual(normalizeSilenceTrimPreferences({ enabled: 'true', thresholdDb: NaN, minimumSilenceMs: 0, scanSeconds: 100 }),
    { enabled: false, thresholdDb: -60, minimumSilenceMs: 250, scanSeconds: 20 });
  assert.equal(normalizeSilenceTrimPreferences({ thresholdDb: -10 }).thresholdDb, -35);
  for (const uri of [undefined, '', 'https://server/stream', 'content://cloud/audio', 'content://media.evil/file']) assert.equal(isLocalSilenceUri(uri), false);
  for (const uri of ['file:///app/downloads/song.m4a', 'content://media/external/audio/1']) assert.equal(isLocalSilenceUri(uri), true);
});

test('a paused, buffering or not-yet-loaded player cannot jump at a decoded boundary', () => {
  for (const change of [{ playing: false }, { buffering: true }, { loaded: false }, { positionSec: NaN }]) {
    const s = session(); assert.equal(s.action({ ...clock, ...change }), null);
    assert.deepEqual(s.action(clock), { kind: 'head', positionSec: 2.4 });
  }
});

test('leading skip is once-only, never backwards, and never rewrites the original timeline', () => {
  const s = session(); assert.deepEqual(s.action(clock), { kind: 'head', positionSec: 2.4 });
  assert.equal(s.action(clock), null);
  assert.equal(s.action({ ...clock, positionSec: 196.4 }), null);
  assert.deepEqual(s.action({ ...clock, positionSec: 196.5 }), { kind: 'tail' });
  assert.equal(s.action({ ...clock, positionSec: 199 }), null);
  assert.equal(s.effectiveEnd(200), 196.5);
  assert.equal(session().action({ ...clock, positionSec: 5 }), null, 'late analysis cannot seek backwards');
});

test('manual scrubbing and saved-position recovery win over a leading trim', () => {
  const scrub = session(); scrub.manualSeek();
  assert.equal(scrub.action(clock), null);
  assert.equal(scrub.action({ ...clock, positionSec: 199 }), null);
  assert.equal(scrub.effectiveEnd(200), 200);
  assert.equal(scrub.managesLoop(200), false);
  const resume = session(); resume.cancelLeading();
  assert.equal(resume.action(clock), null);
  assert.deepEqual(resume.action({ ...clock, positionSec: 199 }), { kind: 'tail' });
  assert.equal(session(false).action(clock), null, 'enabling the preference mid-song cannot jump the playhead');
});

test('repeats restart a fresh pass and an old analysis cannot seek a new track', () => {
  const s = session(); s.action(clock); s.begin('repeat', true);
  assert.equal(s.accept('one', bounds), false);
  assert.equal(s.action(clock), null);
  assert.equal(s.accept('repeat', bounds), true);
  assert.deepEqual(s.action(clock), { kind: 'head', positionSec: 2.4 });
  s.clear(); assert.equal(s.accept('repeat', bounds), false); assert.equal(s.action(clock), null);
});

test('a head-only result never guesses the tail, and cannot replace a final result', () => {
  const s = new SilenceTrimSession(); s.begin('one', true);
  assert.equal(s.accept('one', { ...bounds, endSec: 200, complete: false }), true);
  assert.equal(s.effectiveEnd(200), 200);
  assert.equal(s.action({ ...clock, positionSec: 199 }), null);
  assert.equal(s.accept('one', bounds), true);
  assert.equal(s.accept('one', { ...bounds, endSec: 200, complete: false }), false);
  assert.equal(s.effectiveEnd(200), 196.5);
});

test('invalid, mismatched and whole-file-removing results keep ordinary playback', () => {
  for (const invalid of [{ ...bounds, fingerprint: '' }, { ...bounds, startSec: -1 }, { ...bounds, endSec: 201 },
    { ...bounds, endSec: NaN }, { ...bounds, startSec: 199.5 }, { ...bounds, durationSec: Infinity }]) assert.equal(normalizeSilenceBounds(invalid), null);
  const s = session(); assert.equal(s.action({ ...clock, durationSec: 205 }), null);
  assert.equal(s.effectiveEnd(205), 205); assert.equal(s.managesLoop(205), false);
  const normal = new SilenceTrimSession(); normal.begin('one', true);
  normal.accept('one', { ...bounds, startSec: 0, endSec: 200 });
  assert.equal(normal.managesLoop(200), false); assert.equal(normal.action(clock), null);
});


test('a fade-owned end does not consume the incoming song’s future tail action', () => {
  const s = session(false);
  assert.equal(s.action({ ...clock, positionSec: 199 }, false), null);
  assert.deepEqual(s.action({ ...clock, positionSec: 199 }), { kind: 'tail' });
});
