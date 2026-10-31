import assert from 'node:assert/strict';
import { test } from 'node:test';
import { posterLines, selectedPosterLines, shareCapturedPoster, validPosterPng } from '@/lib/lyricPoster';

test('poster selection preserves source order, repeats are independent and export text is bounded', () => {
  const source = { synced: false, lines: [{ value: 'same' }, { value: ' ' }, { value: 'middle\u0000' }, { value: 'same' }] };
  const lines = posterLines(source);
  assert.deepEqual(lines, ['same', 'middle', 'same']);
  assert.deepEqual(selectedPosterLines(lines, [2, 0, 0, -1, 1.5, 99]), ['same', 'same']);
  assert.deepEqual(selectedPosterLines(Array(7).fill('line'), [0, 1, 2, 3, 4, 5, 6]), []);
  assert.deepEqual(selectedPosterLines(['a'.repeat(421)], [0]), []);
  assert.deepEqual(selectedPosterLines(['a'.repeat(420)], [0]), ['a'.repeat(420)]);
  assert.equal(source.lines[2].value, 'middle\u0000');
});

test('poster capture header must have a PNG signature, non-empty size and bounded dimensions', () => {
  const head = new Uint8Array(24);
  head.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  head.set([73, 72, 68, 82], 12);
  const dimensions = new DataView(head.buffer); dimensions.setUint32(16, 1080); dimensions.setUint32(20, 1620);
  assert.equal(validPosterPng(head, 50_000), true);
  assert.equal(validPosterPng(head, 24), false);
  dimensions.setUint32(20, 0); assert.equal(validPosterPng(head, 50000), false);
  dimensions.setUint32(20, 100000); assert.equal(validPosterPng(head, 50000), false);
  head[0] = 0; assert.equal(validPosterPng(head, 50000), false);
});

function harness() {
  const calls: string[] = [];
  const h = { active: true, available: true, calls,
    capture: async () => { calls.push('capture'); return 'file:///capture.png'; },
    materialize: async (_uri: string) => { calls.push('copy'); return { uri: 'file:///cache/lyric-posters/safe.png', discard: () => { calls.push('discard'); } }; },
    share: async (uri: string) => { calls.push(`share:${uri}`); },
  };
  const deps = () => ({ current: () => h.active, available: async () => h.available,
    capture: h.capture, materialize: h.materialize, share: h.share,
    release: (uri: string) => { calls.push(`release:${uri}`); },
  });
  return { h, deps };
}

test('successful sharing passes only a PNG copy and keeps it available after the share sheet returns', async () => {
  const { h, deps } = harness();
  assert.equal(await shareCapturedPoster(deps()), 'shared');
  assert.deepEqual(h.calls, ['capture', 'copy', 'share:file:///cache/lyric-posters/safe.png', 'release:file:///capture.png']);
  assert.equal(h.calls.includes('discard'), false, 'receiver may still be reading the copied cache file');
});

test('leaving the account during capture or file materialization cannot open a stale share sheet', async () => {
  for (const stage of ['capture', 'copy']) {
    const { h, deps } = harness();
    if (stage === 'capture') h.capture = async () => { h.active = false; h.calls.push('capture'); return 'file:///capture.png'; };
    else h.materialize = async () => { h.active = false; h.calls.push('copy'); return { uri: 'file:///copy.png', discard: () => { h.calls.push('discard'); } }; };
    assert.equal(await shareCapturedPoster(deps()), 'cancelled');
    assert.equal(h.calls.some((entry) => entry.startsWith('share:')), false);
    assert.equal(h.calls.at(-1), 'release:file:///capture.png');
    assert.equal(h.calls.includes('discard'), stage === 'copy');
  }
});

test('unavailable sharing and failed capture/validation never share an empty file', async () => {
  const unavailable = harness(); unavailable.h.available = false;
  assert.equal(await shareCapturedPoster(unavailable.deps()), 'unavailable');
  assert.deepEqual(unavailable.h.calls, []);
  const failed = harness(); failed.h.materialize = async () => { throw new Error('bad PNG'); };
  await assert.rejects(shareCapturedPoster(failed.deps()), /bad PNG/);
  assert.deepEqual(failed.h.calls, ['capture', 'release:file:///capture.png']);
  const rejected = harness(); rejected.h.capture = async () => { throw new Error('capture failed'); };
  await assert.rejects(shareCapturedPoster(rejected.deps()), /capture failed/);
  assert.deepEqual(rejected.h.calls, []);
});
