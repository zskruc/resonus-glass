import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BackgroundWorkError, createBackgroundWorkCoordinator, type BackgroundWorkDriver } from '../src/lib/backgroundWorkControl';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function harness() {
  type Event = Parameters<Parameters<BackgroundWorkDriver['addInterruptionListener']>[0]>[0];
  const listeners = new Set<(event: Event) => void>();
  const starts: { owner: 'music' | 'media-cache'; runId: string; token: string; progress: unknown }[] = [];
  const stops: string[] = [], pendingStops: { owner: string; runId: string }[] = [],
    updates: { token: string; progress: any }[] = [], waits: number[] = [];
  let begin = async (token: string): ReturnType<BackgroundWorkDriver['startJob']> => ({ ok: true, token, headlessActive: true });
  let updating = async (): Promise<boolean> => true;
  let delaying = async () => {};
  const driver: BackgroundWorkDriver = {
    async startJob(owner, runId, progress) {
      const token = `native-${starts.length}`; starts.push({ owner, runId, token, progress }); return begin(token);
    },
    async updateJob(token, progress) { updates.push({ token, progress }); return updating(); },
    async stopJob(token) { stops.push(token); return true; },
    async stopPendingJob(owner, runId) { pendingStops.push({ owner, runId }); return true; },
    async delay(ms) { waits.push(ms); await delaying(); },
    addInterruptionListener(callback) { listeners.add(callback); return { remove() { listeners.delete(callback); } }; },
    drainInterruptions: async () => [],
  };
  const coordinator = createBackgroundWorkCoordinator({ driver, required: true, foreground: () => true,
    locale: () => 'zh-CN', nonce: () => 'session' });
  const emit = (index: number, reason: Event['reason'], token = starts[index].token) => {
    const { owner, runId } = starts[index];
    for (const listener of [...listeners]) listener({ id: 'stop', reason, leases: [{ owner, runId, token }] });
  };
  return { coordinator, starts, stops, pendingStops, updates, waits, listeners, emit,
    begin: (next: typeof begin) => { begin = next; }, update: (next: typeof updating) => { updating = next; },
    delay: (next: typeof delaying) => { delaying = next; } };
}
const initial = { completed: 0, total: 10 };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('background work is not acquired before native foreground and headless promotion completes', async () => {
  const h = harness(), pending = deferred<{ ok: true; token: string; headlessActive: boolean }>();
  h.begin(() => pending.promise);
  let ready = false;
  const acquiring = h.coordinator.acquire('music', initial, () => {}).then((lease) => { ready = true; return lease; });
  await flush(); assert.equal(ready, false);
  pending.resolve({ ok: true, token: 'native-0', headlessActive: true });
  const lease = await acquiring; assert.equal(lease.active(), true);
  await lease.release(); assert.equal(h.listeners.size, 0);
});

test('a foreground service without its timer keepalive is rejected and released', async () => {
  const h = harness(); h.begin(async (token) => ({ ok: true, token, headlessActive: false }));
  await assert.rejects(h.coordinator.acquire('media-cache', initial, () => {}), BackgroundWorkError);
  assert.deepEqual(h.stops, ['native-0']); assert.equal(h.listeners.size, 0);
});

test('pause/profile replacement while promotion is pending cannot start stale work or stop another owner', async () => {
  const h = harness(), pending = deferred<{ ok: true; token: string; headlessActive: boolean }>();
  h.begin(() => pending.promise); let current = true;
  const acquiring = h.coordinator.acquire('media-cache', initial, () => assert.fail('manual policy owns this stop'), () => current);
  current = false; pending.resolve({ ok: true, token: 'native-0', headlessActive: true });
  await assert.rejects(acquiring, BackgroundWorkError);
  h.begin(async (token) => ({ ok: true, token, headlessActive: true }));
  const music = await h.coordinator.acquire('music', initial, () => {});
  assert.deepEqual(h.stops, ['native-0']); assert.equal(music.active(), true);
  await music.release(); assert.deepEqual(h.stops, ['native-0', 'native-1']);
});

test('music and artwork own independent native tokens and release only their own work', async () => {
  const h = harness();
  const music = await h.coordinator.acquire('music', initial, () => {});
  const media = await h.coordinator.acquire('media-cache', initial, () => {});
  await music.release(); await music.release();
  assert.equal(music.active(), false); assert.equal(media.active(), true);
  assert.deepEqual(h.stops, ['native-0']); assert.equal(h.listeners.size, 1);
  await media.release(); assert.equal(h.listeners.size, 0);
});

test('native pause/cancel/timeout invalidates exactly matching leases and duplicate events are inert', async () => {
  for (const reason of ['pause', 'cancel', 'timeout', 'runtime-stopped']) {
    const h = harness(), seen: string[] = [];
    const lease = await h.coordinator.acquire('media-cache', initial, (value) => seen.push(value));
    h.emit(0, reason, 'stale-token'); assert.equal(lease.active(), true);
    h.emit(0, reason); h.emit(0, reason);
    assert.equal(lease.active(), false);
    assert.deepEqual(seen, [reason === 'runtime-stopped' ? 'service-destroyed' : reason]);
    await lease.release(); assert.deepEqual(h.stops, ['native-0']);
  }
});

test('notification cancellation between native start and Promise delivery cannot resurrect a worker', async () => {
  const h = harness(), pending = deferred<{ ok: true; token: string; headlessActive: boolean }>();
  const seen: string[] = []; h.begin(() => pending.promise);
  const acquiring = h.coordinator.acquire('media-cache', initial, (reason) => seen.push(reason));
  h.emit(0, 'cancel'); pending.resolve({ ok: true, token: 'native-0', headlessActive: true });
  await assert.rejects(acquiring, BackgroundWorkError); assert.deepEqual(seen, ['cancel']);
  assert.deepEqual(h.stops, ['native-0']); assert.equal(h.listeners.size, 0);
});

test('native yields continue independently of JS timers and reject after cancellation', async () => {
  const h = harness(), pending = deferred<void>(); h.delay(() => pending.promise);
  const lease = await h.coordinator.acquire('media-cache', initial, () => {});
  const waiting = lease.wait(30); assert.deepEqual(h.waits, [30]);
  await lease.release(); pending.resolve(); await assert.rejects(waiting, BackgroundWorkError);
});

test('a pending native start reports pause/cancel before its delayed interruption event', async () => {
  for (const reason of ['pause', 'cancel', 'timeout'] as const) {
    const h = harness(), pending = deferred<{ ok: false; reason: string }>(), seen: string[] = [];
    h.begin(() => pending.promise);
    const acquiring = h.coordinator.acquire('media-cache', initial, (value) => seen.push(value));
    pending.resolve({ ok: false, reason });
    await assert.rejects(acquiring, BackgroundWorkError);
    h.emit(0, reason);
    assert.deepEqual(seen, [reason]);
    assert.equal(h.listeners.size, 0);
  }
});

test('cancelling a UIDT waiting for network rejects promptly and disposes only its late native token', async () => {
  const h = harness(), pending = deferred<{ ok: true; token: string; headlessActive: boolean }>();
  h.begin(() => pending.promise);
  const controller = new AbortController();
  const acquiring = h.coordinator.acquire('media-cache', initial, () => assert.fail('manual cancellation owns its state'),
    () => !controller.signal.aborted, controller.signal);
  controller.abort();
  await assert.rejects(acquiring, BackgroundWorkError);
  assert.deepEqual(h.pendingStops, [{ owner: 'media-cache', runId: 'session-1' }]);
  assert.equal(h.listeners.size, 0);
  pending.resolve({ ok: true, token: 'native-0', headlessActive: true }); await flush();
  assert.deepEqual(h.stops, ['native-0']);
});

test('progress updates coalesce behind native acknowledgements and a missing token stops its worker', async () => {
  const h = harness(), pending = deferred<boolean>(), seen: string[] = []; h.update(() => pending.promise);
  const lease = await h.coordinator.acquire('music', initial, (reason) => seen.push(reason));
  lease.update({ completed: 1, total: 10 }); lease.update({ completed: 2, total: 10 }); lease.update({ completed: 3, total: 10 });
  assert.equal(h.updates.length, 1); pending.resolve(true); await flush();
  assert.deepEqual(h.updates.map((entry) => entry.progress.completed), [1, 3]);
  assert.equal(h.updates[0].progress.locale, 'zh');
  h.update(async () => false); lease.update({ completed: 4, total: 10 }); await flush();
  assert.equal(lease.active(), false); assert.deepEqual(seen, ['service-destroyed']);
});

test('nonfinite/inconsistent counters do not produce broken native progress', async () => {
  const h = harness(); const lease = await h.coordinator.acquire('music', { completed: 3.9, total: -1, failed: 20, bytesDone: NaN }, () => {});
  assert.deepEqual(h.starts[0].progress, { completed: 3, total: 3, failed: 3, bytesDone: 0, bytesTotal: 0, locale: 'zh' });
  await lease.release();
});

test('Android missing-module failure stays explicit while other platforms keep foreground-only behavior', async () => {
  const android = createBackgroundWorkCoordinator({ required: true, locale: () => 'en', foreground: () => true });
  await assert.rejects(android.acquire('music', initial, () => {}), BackgroundWorkError);
  let foreground = true, delayed = 0;
  const fallback = createBackgroundWorkCoordinator({ required: false, locale: () => 'en', foreground: () => foreground,
    delay: async (ms) => { delayed += ms; } });
  const lease = await fallback.acquire('media-cache', initial, () => {});
  assert.equal(lease.active(), false); await lease.wait(30); assert.equal(delayed, 30);
  foreground = false; await assert.rejects(lease.wait(30), BackgroundWorkError);
  await lease.release();
});
