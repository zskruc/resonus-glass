import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withSpeculativeSlot } from '../src/lib/netBudget';
import { createSlots } from '../src/lib/slots';

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

test('mirror and warming work share four slots, with FIFO handoff and no leaked permits', async () => {
  const slots = createSlots(4);
  const gates = Array.from({ length: 5 }, () => deferred<void>());
  const started: number[] = [];
  let active = 0, peak = 0;
  const work = gates.map((gate, index) => withSpeculativeSlot(() => true, async () => {
    started.push(index); active++; peak = Math.max(peak, active);
    try { await gate.promise; } finally { active--; }
  }, slots));
  await tick();
  assert.deepEqual(started, [0, 1, 2, 3]);
  gates[0].resolve(); await tick();
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.equal(peak, 4);
  for (const gate of gates) gate.resolve();
  await Promise.all(work);
  await withSpeculativeSlot(() => true, async () => { assert.equal(active, 0); }, slots);
});

test('a policy change during the wait skips HTTP and returns its unused slot', async () => {
  const slots = createSlots(1);
  await slots.take();
  let allowed = true, requests = 0;
  const pending = withSpeculativeSlot(() => allowed, async () => { requests++; }, slots);
  await tick(); allowed = false; slots.release();
  await pending;
  assert.equal(requests, 0);
  await withSpeculativeSlot(() => true, async () => { requests++; }, slots);
  assert.equal(requests, 1);
});

test('an HTTP failure releases its slot without blocking the next request', async () => {
  const slots = createSlots(1);
  const first = withSpeculativeSlot(() => true, async () => { throw new Error('HTTP refused'); }, slots);
  const second = withSpeculativeSlot(() => true, async () => 'ready', slots);
  await assert.rejects(first, /HTTP refused/);
  assert.equal(await second, 'ready');
});
