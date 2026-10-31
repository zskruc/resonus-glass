import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaCacheStopped, runBulkMediaWorker, type MediaCacheRepository } from '../src/lib/bulkMediaWorker';
import { emptyMediaCacheStats, newMediaCacheJob, type MediaCacheKind, type MediaCacheOutcome, type MediaCacheTask } from '../src/lib/mediaCacheTypes';

const item = (id: number, kind: MediaCacheKind = 'lyrics'): MediaCacheTask => ({ kind, id: String(id), data: { id } });
function repository() {
  const rows = new Map<string, { task: MediaCacheTask; result: MediaCacheOutcome | 'pending' }>();
  const checkpoints: number[] = [];
  let recounts = 0;
  const repo: MediaCacheRepository = {
    saveJob: async (job) => { checkpoints.push(job.cursors.lyrics.offset); },
    addPage: async (tasks) => { let added = 0; for (const task of tasks) {
      const key = `${task.kind}|${task.id}`;
      if (!rows.has(key)) { rows.set(key, { task, result: 'pending' }); added++; }
    } return added; },
    next: async (selected) => [...rows.values()].find((row) => row.result === 'pending' && selected.includes(row.task.kind))?.task,
    finish: async (task, result) => { rows.get(`${task.kind}|${task.id}`)!.result = result; },
    stats: async () => { recounts++; const stats = emptyMediaCacheStats(); for (const { task, result } of rows.values()) {
      stats[task.kind].total++; stats[task.kind][result]++;
    } return stats; },
  };
  return { rows, checkpoints, repo, recounts: () => recounts };
}
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }

test('bulk discovery exhausts short server pages beyond 500, deduplicates IDs, and stays sequential', async () => {
  const h = repository(), job = newMediaCacheJob(['lyrics']);
  const source = [...Array.from({ length: 737 }, (_, index) => item(index)), item(0)];
  const offsets: number[] = []; let active = 0, peak = 0;
  await runBulkMediaWorker({ job, repository: h.repo, signal: new AbortController().signal, policy: () => null,
    page: async (_kind, offset) => { offsets.push(offset); return source.slice(offset, offset + 73); },
    process: async () => { peak = Math.max(peak, ++active); await Promise.resolve(); active--; return 'success'; },
    update: () => {}, yield: async () => {},
  });
  assert.equal(h.rows.size, 737); assert.equal(peak, 1);
  assert.equal(offsets.at(-1), 738, 'an empty final page, not a short page, ends the scan');
  assert.equal(job.status, 'completed');
  assert.equal(h.recounts(), 1, 'progress must not rescan every persistent row after every item');
  assert.equal((await h.repo.stats()).lyrics.success, 737);
});

test('checkpoint replay is safe, while a server that ignores offset stops visibly', async () => {
  const h = repository(); await h.repo.addPage([item(0), item(1)]);
  const job = newMediaCacheJob(['lyrics']);
  await runBulkMediaWorker({ job, repository: h.repo, signal: new AbortController().signal, policy: () => null,
    page: async (_kind, offset) => offset === 0 ? [item(0), item(1)] : [],
    process: async () => 'cached', update: () => {}, yield: async () => {},
  });
  assert.equal(h.rows.size, 2); assert.equal((await h.repo.stats()).lyrics.cached, 2);
  const bad = repository();
  await assert.rejects(runBulkMediaWorker({ job: newMediaCacheJob(['lyrics']), repository: bad.repo,
    signal: new AbortController().signal, policy: () => null, page: async () => [item(0), item(1)],
    process: async () => 'success', update: () => {}, yield: async () => {},
  }), /pagination did not advance/);
  assert.equal((await bad.repo.stats()).lyrics.pending, 2);
});

test('offline, profile changes and cancellation after awaited work never complete stale items', async () => {
  for (const reason of ['offline', 'profile', 'user'] as const) {
    const h = repository(), job = newMediaCacheJob(['lyrics']);
    await h.repo.addPage([item(1)]); job.cursors.lyrics.complete = true;
    const gate = deferred<MediaCacheOutcome>(), entered = deferred<void>(), control = new AbortController();
    let policy: 'offline' | 'profile' | null = null;
    const work = runBulkMediaWorker({ job, repository: h.repo, signal: control.signal, policy: () => policy,
      page: async () => { throw new Error('resuming must not rediscover'); },
      process: async (_task, context) => { assert.ok(context.current()); entered.resolve(); return gate.promise; },
      update: () => {}, yield: async () => {},
    });
    await entered.promise;
    if (reason === 'user') control.abort(); else policy = reason;
    gate.resolve('success');
    await assert.rejects(work, (error: unknown) => error instanceof MediaCacheStopped && error.reason === reason);
    assert.equal((await h.repo.stats()).lyrics.pending, 1);
  }
});

test('network and disk failures are failed rather than missing, with bounded retries and explicit resume', async () => {
  const h = repository(), job = newMediaCacheJob(['lyrics']);
  await h.repo.addPage(Array.from({ length: 5 }, (_, index) => item(index)));
  job.cursors.lyrics.complete = true;
  const common = { job, repository: h.repo, signal: new AbortController().signal, policy: () => null,
    page: async () => [] as MediaCacheTask[], update: () => {}, yield: async () => {} };
  await assert.rejects(runBulkMediaWorker({ ...common, process: async () => { throw new Error('network'); } }), /repeated failures/);
  assert.equal((await h.repo.stats()).lyrics.failed, 3);
  assert.equal((await h.repo.stats()).lyrics.missing, 0);
  await runBulkMediaWorker({ ...common, process: async () => 'missing' });
  assert.equal((await h.repo.stats()).lyrics.failed, 3, 'continue does not silently retry failed requests');
  assert.equal((await h.repo.stats()).lyrics.missing, 2);
  for (const row of h.rows.values()) if (row.result === 'failed') row.result = 'pending';
  let retried = 0;
  await runBulkMediaWorker({ ...common, process: async () => { retried++; return 'success'; } });
  assert.equal(retried, 3); assert.equal((await h.repo.stats()).lyrics.success, 3);
});

test('a policy change during discovery does not insert stale pages or start transfers', async () => {
  const h = repository(), page = deferred<MediaCacheTask[]>(), entered = deferred<void>();
  let offline = false, transfers = 0;
  const work = runBulkMediaWorker({ job: newMediaCacheJob(['albumCovers']), repository: h.repo,
    signal: new AbortController().signal, policy: () => offline ? 'offline' : null,
    page: async () => { entered.resolve(); return page.promise; },
    process: async () => { transfers++; return 'success'; }, update: () => {}, yield: async () => {},
  });
  await entered.promise; offline = true; page.resolve([item(1, 'albumCovers')]);
  await assert.rejects(work, MediaCacheStopped);
  assert.equal(h.rows.size, 0); assert.equal(transfers, 0);
});
