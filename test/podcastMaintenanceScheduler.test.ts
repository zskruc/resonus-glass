import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPodcastMaintenanceScheduler } from '../src/lib/podcastMaintenanceScheduler';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  let now = 1000, active = true, sequence = 0;
  const timers = new Map<number, { work: () => void; delay: number }>(), runs: AbortSignal[] = [];
  let task: Promise<unknown> = Promise.resolve();
  const scheduler = createPodcastMaintenanceScheduler({ foreground: () => active, now: () => now,
    run: async (signal) => { runs.push(signal); return task; },
    schedule: (work, delay) => { const id = ++sequence; timers.set(id, { work, delay }); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: (id) => { timers.delete(id as unknown as number); },
  });
  return { scheduler, timers, runs, active: (value: boolean) => { active = value; }, advance: (ms: number) => { now += ms; },
    task: (value: Promise<unknown>) => { task = value; },
    async fire() { const next = timers.entries().next().value; if (next) { timers.delete(next[0]); next[1].work(); } await turn(); },
  };
}

test('foreground admission waits for navigation to settle, coalesces events, and runs at most once per 24 hours', async () => {
  const h = harness();
  try {
    h.scheduler.foreground(); h.scheduler.foreground();
    assert.equal(h.runs.length, 0); assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].delay, 5000);
    await h.fire(); assert.equal(h.runs.length, 1);
    for (let i = 0; i < 20; i++) { h.scheduler.background(); h.scheduler.foreground(); }
    assert.equal(h.timers.size, 0); assert.equal(h.runs.length, 1);
    h.advance(24 * 60 * 60_000 - 1); h.scheduler.foreground(); assert.equal(h.timers.size, 0);
    h.advance(1); h.scheduler.foreground(); await h.fire(); assert.equal(h.runs.length, 2);
  } finally { h.scheduler.dispose(); }
});

test('background and disposal cancel pending startup work without running a scan', async () => {
  const h = harness();
  h.active(false); h.scheduler.foreground(); assert.equal(h.timers.size, 0);
  h.active(true); h.scheduler.foreground(); h.active(false); h.scheduler.background();
  await h.fire(); assert.equal(h.runs.length, 0);
  h.active(true); h.scheduler.foreground(); h.scheduler.dispose();
  await h.fire(); assert.equal(h.runs.length, 0); assert.equal(h.timers.size, 0);
});

test('a request already admitted is aborted when going away and does not overlap a quick return', async () => {
  const h = harness(); let finish!: () => void;
  h.task(new Promise<void>((resolve) => { finish = resolve; }));
  try {
    h.scheduler.foreground(); await h.fire(); assert.equal(h.runs.length, 1);
    h.active(false); h.scheduler.background(); assert.equal(h.runs[0].aborted, true);
    h.active(true); h.scheduler.foreground(); assert.equal(h.timers.size, 0);
    finish(); await turn(); h.scheduler.foreground();
    assert.equal(h.timers.size, 0, 'a canceled daily admission is not a foreground retry loop');
  } finally { h.scheduler.dispose(); finish(); }
});

test('a hidden app or disposed scheduler cannot start even a timer callback already delivered to the event loop', async () => {
  const h = harness(); h.scheduler.foreground();
  const stale = [...h.timers.values()][0].work;
  h.active(false); h.scheduler.background(); stale(); await turn();
  assert.equal(h.runs.length, 0);
  h.active(true); h.scheduler.dispose(); stale(); await turn();
  assert.equal(h.runs.length, 0);
});
