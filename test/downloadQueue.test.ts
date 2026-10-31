import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDownloadQueue, type DownloadContext, type DownloadQueueItem } from '../src/lib/downloadQueue';
import type { Song, SubsonicAuth } from '../src/api/subsonic';

const tick = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const auth = (username: string) => ({ username, serverUrl: 'https://test' }) as SubsonicAuth;
const song = (id: string): Song => ({ id, title: id, duration: 100 });
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function harness() {
  const state = { auth: auth('A') as SubsonicAuth | null, allowed: true, limit: 1 };
  let items: DownloadQueueItem[] = [], paused = false;
  const queue = createDownloadQueue({ owner: () => state.auth, profile: (value) => value.username,
    allowed: () => state.allowed, limit: () => state.limit, update: (next, value) => { items = next; paused = value; } });
  return { state, queue, items: () => items, paused: () => paused };
}

test('one per-profile song serves overlapping groups, while cancelling one group keeps the other owner', async () => {
  const h = harness(), finish = deferred<void>(); let runs = 0;
  const run = async () => { runs++; await finish.promise; };
  const one = h.queue.add(song('one'), 'playlist:a', run, true);
  const two = h.queue.add(song('one'), 'playlist:b', run, true); h.queue.sync(); await tick();
  assert.equal(runs, 1); assert.equal(h.items().length, 1);
  h.queue.cancelGroup('playlist:a'); assert.deepEqual(h.items()[0].groups, ['playlist:b']);
  finish.resolve(); assert.equal(await two, 'completed'); assert.equal(await one, 'completed');
  await tick(); assert.equal(h.items()[0].status, 'completed');
  await h.queue.cancelAll(); assert.equal(h.items()[0].status, 'completed', 'global cancel keeps completed files');
});

test('a genuine pause keeps the in-flight item and resumes its work without resolving it as cancellation', async () => {
  const h = harness(); let runs = 0, pauses = 0, completed = false;
  let end = deferred<void>();
  const work = h.queue.add(song('one'), 'song:one', async (context) => {
    runs++; const current = end;
    context.transfer({ pause: async () => { pauses++; current.resolve(); }, cancel: async () => current.resolve() });
    context.progress(runs === 1 ? 40 : 100, 100);
    await current.promise; context.check();
  });
  void work.then(() => { completed = true; }); await tick();
  await h.queue.pauseAll(); await tick();
  assert.equal(pauses, 1); assert.equal(completed, false); assert.equal(h.paused(), true);
  assert.equal(h.items()[0].status, 'paused'); assert.equal(h.items()[0].bytesWritten, 40);
  end = deferred<void>(); await h.queue.resumeAll(); await tick();
  assert.equal(runs, 2); assert.equal(h.items()[0].status, 'downloading');
  end.resolve(); assert.equal(await work, 'completed'); await tick();
  assert.equal(h.items()[0].bytesWritten, 100);
});

test('late progress from a previous run remains inert after the same entry resumes', async () => {
  const h = harness(); let previous!: DownloadContext, current!: DownloadContext;
  let runs = 0, end = deferred<void>();
  const work = h.queue.add(song('one'), 'one', async (context) => {
    const gate = end; if (++runs === 1) previous = context; else current = context;
    context.transfer({ pause: async () => gate.resolve(), cancel: async () => gate.resolve() });
    await gate.promise; context.check();
  });
  await tick(); await h.queue.pauseAll(); await tick(); end = deferred<void>(); await h.queue.resumeAll(); await tick();
  current.progress(50, 100); previous.progress(99, 100); h.queue.sync();
  assert.equal(h.items()[0].bytesWritten, 50); end.resolve(); await work; await tick();
});

test('resuming waits for an asynchronous native pause snapshot, and paused cancellation calls cleanup', async () => {
  const h = harness(), snapshot = deferred<void>(); let runs = 0, disposed = 0;
  const first = deferred<void>(), second = deferred<void>();
  const work = h.queue.add(song('one'), 'one', async (context) => {
    const gate = ++runs === 1 ? first : second;
    context.transfer({ pause: async () => { first.resolve(); await snapshot.promise; }, cancel: async () => gate.resolve() });
    await gate.promise; context.check();
  }, false, async () => { disposed++; });
  await tick(); const pause = h.queue.pauseAll(); await tick();
  await h.queue.resumeAll(); await tick(); assert.equal(runs, 1, 'no second native request before pause snapshot settles');
  snapshot.resolve(); await pause; await tick(); assert.equal(runs, 2);
  second.resolve(); await work; await tick();
  assert.equal(disposed, 0, 'completed media is not disposed by cancellation');
});

test('progress preserves unchanged row identities and clear fences reject additions until disk cleanup ends', async () => {
  const h = harness(); h.state.limit = 2;
  let context!: DownloadContext; const finish = deferred<void>();
  const a = h.queue.add(song('a'), 'batch', async (value) => { context = value; await finish.promise; value.check(); }, true);
  const b = h.queue.add(song('b'), 'batch', async () => finish.promise, true); h.queue.sync(); await tick();
  const before = h.items(); context.progress(20, 100); h.queue.sync();
  assert.equal(h.items()[1], before[1]); assert.notEqual(h.items()[0], before[0]);
  const disk = deferred<void>(); const clear = h.queue.drainAndClear(async () => disk.promise);
  finish.resolve(); await tick(); let starts = 0;
  assert.equal(await h.queue.add(song('new'), 'new', async () => { starts++; }), 'cancelled');
  assert.equal(starts, 0); disk.resolve(); await clear; await Promise.all([a, b]);
  assert.equal(await h.queue.add(song('new'), 'new', async () => { starts++; }), 'completed'); await tick(); assert.equal(starts, 1);
});

test('runtime concurrency increases start waiting work and decreases stop new starts until below the limit', async () => {
  const h = harness(), gates = Array.from({ length: 6 }, () => deferred<void>());
  const started: number[] = [];
  const jobs = gates.map((gate, index) => h.queue.add(song(String(index)), 'batch', async () => {
    started.push(index); await gate.promise;
  }, true));
  h.queue.sync(); await tick(); assert.deepEqual(started, [0]);
  h.state.limit = 3; h.queue.sync(); await tick(); assert.deepEqual(started, [0, 1, 2]);
  h.state.limit = 1; h.queue.sync(); gates[0].resolve(); await tick();
  assert.equal(started.length, 3); gates[1].resolve(); await tick(); assert.equal(started.length, 3);
  gates[2].resolve(); await tick(); assert.deepEqual(started, [0, 1, 2, 3]);
  for (const gate of gates) gate.resolve(); await Promise.all(jobs); await tick();
  assert.equal(h.items().filter((item) => item.status === 'completed').length, 6);
});

test('a deleted task keeps its file lease until the retired run ends, and the global ceiling is twenty', async () => {
  const h = harness(); h.state.limit = 99;
  const gate = deferred<void>(); let starts = 0;
  const old = h.queue.add(song('same'), 'old', async (context) => { await gate.promise; context.check(); }); await tick();
  h.queue.forget(['same']);
  const replacement = h.queue.add(song('same'), 'new', async () => { starts++; }); await tick();
  assert.equal(starts, 0); gate.resolve(); await old; await replacement; await tick(); assert.equal(starts, 1);
  const all = deferred<void>(); let peak = 0, active = 0;
  const jobs = Array.from({ length: 25 }, (_, index) => h.queue.add(song(String(index)), 'batch', async () => {
    peak = Math.max(peak, ++active); await all.promise; active--;
  }, true));
  h.queue.sync(); await tick(); assert.equal(peak, 20); all.resolve(); await Promise.all(jobs); await tick();
});

test('file leases pass through multiple cancelled replacement generations of the same song', async () => {
  const h = harness(); h.state.limit = 3;
  const gate = deferred<void>(); const started: string[] = [];
  const a = h.queue.add(song('same'), 'A', async (context) => { started.push('A'); await gate.promise; context.check(); });
  await tick(); await h.queue.cancelAll();
  const b = h.queue.add(song('same'), 'B', async () => { started.push('B'); });
  await tick(); await h.queue.cancelAll();
  const c = h.queue.add(song('same'), 'C', async () => { started.push('C'); }); await tick();
  assert.deepEqual(started, ['A'], 'C must inherit the oldest still-running file lease through B');
  gate.resolve(); assert.equal(await a, 'cancelled'); assert.equal(await b, 'cancelled'); assert.equal(await c, 'completed');
  await tick(); assert.deepEqual(started, ['A', 'C']);
});

test('clear, account removal and forget all wait for inherited retired file commits', async () => {
  for (const action of ['clear', 'remove', 'forget'] as const) {
    const h = harness(); h.state.limit = 3;
    const gate = deferred<void>(); let started = 0, settled = false;
    const a = h.queue.add(song('same'), 'A', async (context) => { await gate.promise; context.check(); });
    await tick(); await h.queue.cancelAll();
    const b = h.queue.add(song('same'), 'B', async () => { started++; }); await tick();
    let work: Promise<unknown>;
    if (action === 'clear') work = h.queue.drainAndClear(async () => { settled = true; });
    else if (action === 'remove') work = h.queue.removeProfile('A').then(() => { settled = true; });
    else {
      h.queue.forget(['same']); await tick();
      work = h.queue.add(song('same'), 'C', async () => { started++; settled = true; });
    }
    await tick(); assert.equal(settled, false, `${action} cannot cross a still-running retired ancestor`);
    assert.equal(started, 0); gate.resolve(); await Promise.all([a, b, work]); await tick();
    assert.equal(settled, true); assert.equal(started, action === 'forget' ? 1 : 0);
  }
});

test('an explicit limit of twenty starts only twenty of twenty-four queued songs', async () => {
  const h = harness(); h.state.limit = 20;
  const gate = deferred<void>(); let started = 0;
  const jobs = Array.from({ length: 24 }, (_, index) => h.queue.add(song(String(index)), 'batch', async () => {
    started++; await gate.promise;
  }, true));
  h.queue.sync(); await tick();
  assert.equal(started, 20); assert.equal(h.items().filter((item) => item.status === 'queued').length, 4);
  gate.resolve(); await Promise.all(jobs); await tick(); assert.equal(started, 24);
});

test('old profile progress/finally cannot overwrite new profile tasks, and returning requires explicit resume', async () => {
  const h = harness(), old = deferred<void>(), next = deferred<void>(); let oldContext!: DownloadContext;
  h.state.limit = 2;
  const a = h.queue.add(song('same'), 'A', async (context) => { oldContext = context; await old.promise; context.check(); });
  await tick(); h.state.auth = auth('B'); h.queue.sync();
  const b = h.queue.add(song('same'), 'B', async () => next.promise); await tick();
  oldContext.progress(99, 100); assert.equal(h.items()[0].bytesWritten, 0); assert.equal(h.items()[0].groups[0], 'B');
  old.resolve(); await tick(); assert.equal(h.items()[0].status, 'downloading');
  next.resolve(); assert.equal(await b, 'completed'); await tick();
  h.state.auth = auth('A'); h.queue.sync(); await tick();
  assert.equal(h.paused(), true); assert.equal(h.items()[0].status, 'paused');
  await h.queue.resumeAll(); assert.equal(await a, 'completed'); await tick();
});

test('cancelled old instances cannot affect immediately re-added songs; failed jobs retry only on explicit resume', async () => {
  const h = harness(), old = deferred<void>();
  const first = h.queue.add(song('one'), 'old', async () => old.promise); await tick();
  await h.queue.cancelAll(); assert.equal(await first, 'cancelled');
  let tries = 0;
  const fresh = h.queue.add(song('one'), 'new', async () => { if (++tries === 1) throw new Error('HTTP failure'); });
  old.resolve(); await tick(); assert.equal(await fresh, 'failed');
  await tick(); assert.equal(h.items()[0].status, 'failed'); assert.equal(tries, 1);
  await h.queue.resumeAll(); await tick(); assert.equal(h.items()[0].status, 'completed'); assert.equal(tries, 2);
});

test('offline and policy changes pause work without dispatching the next song', async () => {
  const h = harness(), gate = deferred<void>(); let started = 0;
  const a = h.queue.add(song('a'), 'batch', async (context) => { started++; await gate.promise; context.check(); });
  const b = h.queue.add(song('b'), 'batch', async () => { started++; }); await tick();
  h.state.allowed = false; h.queue.sync(); gate.resolve(); await tick();
  assert.equal(started, 1); assert.ok(h.items().every((item) => item.status === 'paused'));
  await h.queue.resumeAll(); assert.equal(started, 1);
  h.state.allowed = true; await h.queue.resumeAll(); await Promise.all([a, b]); await tick();
  assert.equal(h.items().filter((item) => item.status === 'completed').length, 2);
});

test('an idle offline session cannot leave the first explicit online download paused', async () => {
  const h = harness(); let starts = 0;
  h.state.allowed = false; h.queue.sync();
  assert.equal(h.items().length, 0);
  h.state.allowed = true; h.queue.sync();
  const work = h.queue.add(song('new'), 'song:new', async () => { starts++; }); await tick();
  assert.equal(starts, 1, 'an explicit new online task must not inherit an empty offline pause marker');
  assert.equal(await work, 'completed'); await tick();
  assert.equal(h.paused(), false);
});

test('adding a new song preserves a real paused batch and does not resume it automatically', async () => {
  const h = harness(), gate = deferred<void>(); let starts = 0;
  const first = h.queue.add(song('old'), 'batch', async (context) => {
    starts++; context.transfer({ pause: async () => gate.resolve(), cancel: async () => gate.resolve() });
    await gate.promise; context.check();
  }); await tick();
  await h.queue.pauseAll(); await tick();
  h.state.allowed = false; h.queue.sync(); h.state.allowed = true; h.queue.sync();
  const next = h.queue.add(song('new'), 'song:new', async () => { starts++; }); await tick();
  assert.equal(starts, 1); assert.equal(h.paused(), true);
  assert.ok(h.items().every((item) => item.status === 'paused'));
  await h.queue.resumeAll(); await Promise.all([first, next]); await tick();
  assert.equal(h.items().filter((item) => item.status === 'completed').length, 2);
});
