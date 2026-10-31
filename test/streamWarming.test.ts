import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSlots } from '../src/lib/slots';
import { StreamWarming } from '../src/lib/streamWarming';

const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(timeoutMs = 120_000) {
  const owner = {};
  const state = { owner, online: true, enabled: true, upcoming: new Set(['a', 'b']) };
  const slots = createSlots(1);
  const requests: { url: string; signal: AbortSignal; result: ReturnType<typeof deferred<unknown>> }[] = [];
  const events: string[] = [];
  const warmer = new StreamWarming({
    slots, timeoutMs,
    canRequest: (value, id) => state.online && state.enabled && value === state.owner && state.upcoming.has(id),
    request: (url, signal) => {
      const result = deferred<unknown>();
      requests.push({ url, signal, result });
      signal.addEventListener('abort', () => result.reject(new Error('aborted')), { once: true });
      return result.promise;
    },
    onEvent: (event) => events.push(event),
  });
  return { owner, state, slots, requests, events, warmer };
}

test('warming is serial and deduplicated, and stops reading after response headers', async (t) => {
  const h = harness(); t.after(() => h.warmer.reset());
  h.warmer.enqueue('a', 'url-a', h.owner);
  h.warmer.enqueue('b', 'url-b', h.owner);
  h.warmer.enqueue('a', 'duplicate-a', h.owner);
  await tick();
  assert.deepEqual(h.requests.map((value) => value.url), ['url-a']);
  h.requests[0].result.resolve({ headers: true }); await tick();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.deepEqual(h.requests.map((value) => value.url), ['url-a', 'url-b']);
  h.requests[1].result.resolve({ headers: true }); await tick();
  h.warmer.enqueue('a', 'duplicate-a', h.owner); await tick();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.events, ['asked', 'ready', 'asked', 'ready']);
});

test('only the latest tapped queue may release its warming hold', async (t) => {
  const h = harness(); t.after(() => h.warmer.reset());
  const a = h.warmer.beginQueue();
  const b = h.warmer.beginQueue();
  assert.equal(h.warmer.release(a), false);
  assert.equal(h.warmer.owns(a), false);
  assert.equal(h.warmer.held, true);
  h.warmer.enqueue('b', 'url-b', h.owner); await tick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.warmer.release(b), true);
  h.warmer.enqueue('b', 'url-b', h.owner); await tick();
  assert.equal(h.requests.length, 1);
  h.requests[0].result.resolve(null); await tick();
});

test('offline, account, removed-song and replaced-queue changes while waiting issue no HTTP', async (t) => {
  for (const change of ['offline', 'account', 'removed', 'queue'] as const) {
    const h = harness(); t.after(() => h.warmer.reset());
    await h.slots.take();
    h.warmer.enqueue('a', 'old-a', h.owner); await tick();
    if (change === 'offline') h.state.online = false;
    if (change === 'account') h.state.owner = {};
    if (change === 'removed') h.state.upcoming.delete('a');
    if (change === 'queue') h.warmer.reset();
    h.slots.release(); await tick();
    assert.equal(h.requests.length, 0, change);
    h.state.online = true; h.state.owner = h.owner; h.state.upcoming.add('a');
    h.warmer.enqueue('a', 'new-a', h.owner); await tick();
    assert.equal(h.requests.length, 1, `${change}: stale task returned its slot and marker`);
    h.requests[0].result.resolve(null); await tick();
  }
});

test('an obsolete failure cannot remove the same song marker from a new queue', async (t) => {
  const owner = {};
  const calls: ReturnType<typeof deferred<void>>[] = [];
  const signals: AbortSignal[] = [];
  // Leave cancellation pending until explicitly rejected to model a delayed
  // native completion after the next queue has already claimed the same ID.
  const warmer = new StreamWarming({ timeoutMs: 120_000, slots: createSlots(1), canRequest: () => true,
    request: (_url, signal) => { const result = deferred<void>(); calls.push(result); signals.push(signal); return result.promise; } });
  t.after(() => warmer.reset());
  warmer.enqueue('same', 'old', owner); await tick();
  warmer.reset();
  assert.equal(signals[0].aborted, true);
  warmer.enqueue('same', 'new', owner);
  calls[0].reject(new Error('old callback')); await tick();
  assert.equal(calls.length, 2);
  warmer.enqueue('same', 'duplicate-new', owner);
  calls[1].resolve(); await tick();
  warmer.enqueue('same', 'duplicate-finished', owner); await tick();
  assert.equal(calls.length, 2);
});

test('a failed warm can retry and does not poison requests behind it', async (t) => {
  const h = harness(); t.after(() => h.warmer.reset());
  h.warmer.enqueue('a', 'a', h.owner); h.warmer.enqueue('b', 'b', h.owner); await tick();
  h.requests[0].result.reject(new Error('server failed')); await tick();
  assert.equal(h.requests[1].url, 'b');
  h.requests[1].result.resolve(null); await tick();
  h.warmer.enqueue('a', 'retry-a', h.owner); await tick();
  assert.equal(h.requests[2].url, 'retry-a');
  h.requests[2].result.resolve(null); await tick();
});

test('network and opt-in changes cancel active work without releasing the current tap', async (t) => {
  const h = harness(); t.after(() => h.warmer.reset());
  h.warmer.enqueue('a', 'a', h.owner); await tick();
  h.state.online = false; h.warmer.invalidate(); await tick();
  assert.equal(h.requests[0].signal.aborted, true);
  const intent = h.warmer.beginQueue();
  h.state.online = true; h.state.enabled = false; h.warmer.invalidate();
  h.warmer.enqueue('a', 'off', h.owner); await tick();
  assert.equal(h.requests.length, 1);
  h.state.enabled = true; h.warmer.invalidate();
  h.warmer.enqueue('a', 'held', h.owner); await tick();
  assert.equal(h.warmer.held, true);
  assert.equal(h.requests.length, 1);
  h.warmer.release(intent); h.warmer.enqueue('a', 'allowed', h.owner); await tick();
  assert.equal(h.requests.length, 2);
  h.requests[1].result.resolve(null); await tick();
});

test('the request deadline aborts and returns the shared slot for later work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(100); t.after(() => h.warmer.reset());
  h.warmer.enqueue('a', 'a', h.owner); h.warmer.enqueue('b', 'b', h.owner); await tick();
  t.mock.timers.tick(101); await tick();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests[1].url, 'b');
  assert.deepEqual(h.events, ['asked', 'failed', 'asked']);
  h.requests[1].result.resolve(null); await tick();
});
