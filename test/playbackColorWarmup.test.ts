import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Song } from '@/api/subsonic';
import {
  canWarmPlaybackArtwork, createPlaybackColorWarmup, playbackColorWarmupIndices,
  type PlaybackColorWarmupItem,
} from '@/lib/playbackColorWarmup';

const queue = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id })) as Song[];
const item = (uri: string, mode: 'light' | 'dark' = 'light'): PlaybackColorWarmupItem => ({ uri, mode });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
  const calls: PlaybackColorWarmupItem[] = [];
  const pending: { resolve: () => void; reject: () => void }[] = [];
  const worker = createPlaybackColorWarmup(async (request) => {
    calls.push(request);
    await new Promise<void>((resolve, reject) => pending.push({ resolve, reject: () => reject(new Error('missing artwork')) }));
  });
  return { calls, pending, worker };
}

test('plans current, actual next playable and previous in already-shuffled queue order', () => {
  assert.deepEqual(playbackColorWarmupIndices(queue, 1, 'off', () => true), [1, 2, 0]);
  assert.deepEqual(playbackColorWarmupIndices(queue, 1, 'off', (song) => song.id !== 'c'), [1, 3, 0]);
  assert.deepEqual(playbackColorWarmupIndices(queue, 3, 'all', () => true), [3, 0, 2]);
  assert.deepEqual(playbackColorWarmupIndices(queue, 0, 'off', () => true), [0, 1]);
  assert.deepEqual(playbackColorWarmupIndices(queue, 0, 'off', () => false), [0]);
  assert.deepEqual(playbackColorWarmupIndices([], 0, 'all', () => true), []);
});

test('offline artwork never starts remote podcast/radio URLs or cache-only references', () => {
  for (const uri of ['https://cover/image', 'HTTP://cover/image', 'cached-cover:https://cover/image', undefined]) {
    assert.equal(canWarmPlaybackArtwork(uri, true, 'cached-cover:'), false);
  }
  assert.equal(canWarmPlaybackArtwork('cached-cover:https://cover/image', false, 'cached-cover:'), false);
  for (const uri of ['file:///private/cover.jpg', 'content://library/cover']) {
    assert.equal(canWarmPlaybackArtwork(uri, true, 'cached-cover:'), true);
  }
  assert.equal(canWarmPlaybackArtwork('https://cover/image', false, 'cached-cover:'), true);
});

test('one serial load survives plan replacement while obsolete queued items are discarded', async () => {
  const h = harness();
  h.worker.update([item('a'), item('b'), item('c')], true);
  assert.deepEqual(h.calls, [item('a')]);
  h.worker.update([item('x', 'dark'), item('y', 'dark')], true);
  assert.equal(h.calls.length, 1);
  h.pending[0].resolve(); await settle();
  assert.deepEqual(h.calls, [item('a'), item('x', 'dark')]);
  h.pending[1].resolve(); await settle();
  assert.deepEqual(h.calls, [item('a'), item('x', 'dark'), item('y', 'dark')]);
  h.pending[2].resolve(); await settle();
  h.worker.dispose();
});

test('plans are bounded and deduplicated, including a replacement retaining an in-flight artwork', async () => {
  const h = harness();
  h.worker.update([item('a'), item('a'), item('b'), item('c'), item('d')], true);
  h.worker.update([item('a'), item('b'), item('c')], true);
  h.pending[0].resolve(); await settle();
  assert.deepEqual(h.calls, [item('a'), item('b')]);
  h.pending[1].resolve(); await settle();
  assert.deepEqual(h.calls, [item('a'), item('b'), item('c')]);
  h.pending[2].resolve(); await settle();
  h.worker.update([item('a'), item('b'), item('c')], true); await settle();
  assert.equal(h.calls.length, 3); // Unchanged plan does not reread every position heartbeat.
  h.worker.dispose();
});

test('background/profile pause drops queued work and resume waits for the same running load', async () => {
  const h = harness();
  h.worker.update([item('a'), item('b')], true);
  h.worker.update([], false);
  h.worker.update([item('new-profile')], true);
  assert.deepEqual(h.calls, [item('a')]);
  h.pending[0].resolve(); await settle();
  assert.deepEqual(h.calls, [item('a'), item('new-profile')]);
  h.worker.update([], false);
  h.pending[1].resolve(); await settle();
  assert.equal(h.calls.length, 2);
  h.worker.dispose();
});

test('failed artwork does not block the latest plan and disposal stops subsequent starts', async () => {
  const h = harness();
  h.worker.update([item('a'), item('b'), item('c')], true);
  h.pending[0].reject(); await settle();
  assert.deepEqual(h.calls, [item('a'), item('b')]);
  h.worker.dispose();
  h.pending[1].resolve(); await settle();
  h.worker.update([item('ignored')], true);
  assert.equal(h.calls.length, 2);
});
