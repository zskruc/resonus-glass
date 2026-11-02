import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaCacheStopped, runBulkMediaWorker, type MediaCacheRepository } from '../src/lib/bulkMediaWorker';
import { emptyMediaCacheStats, newMediaCacheJob, type MediaCacheKind, type MediaCacheOutcome, type MediaCacheTask } from '../src/lib/mediaCacheTypes';
import { LyricsFallbackError } from '../src/lib/lyricsLookupError';

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

test('pause interrupts unresolved discovery, processing and protected yields without waiting for late callbacks', async () => {
  for (const stage of ['page', 'process', 'yield'] as const) {
    const h = repository(), job = newMediaCacheJob(['lyrics']), control = new AbortController();
    const gate = deferred<void>(), entered = deferred<void>();
    if (stage !== 'page') { await h.repo.addPage([item(1)]); job.cursors.lyrics.complete = true; }
    let updates = 0;
    const work = runBulkMediaWorker({ job, repository: h.repo, signal: control.signal, policy: () => null,
      page: async () => { entered.resolve(); await gate.promise; return [item(1)]; },
      process: async () => { if (stage === 'process') { entered.resolve(); await gate.promise; } return 'success'; },
      yield: async () => { if (stage === 'yield') { entered.resolve(); await gate.promise; } },
      update: () => { updates++; },
    });
    await entered.promise; control.abort();
    await assert.rejects(work, MediaCacheStopped);
    assert.notEqual(job.status, 'completed');
    const stoppedUpdates = updates;
    gate.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(updates, stoppedUpdates);
    if (stage === 'page') assert.equal(h.rows.size, 0);
    if (stage === 'process') assert.equal((await h.repo.stats()).lyrics.pending, 1);
  }
});

function lyricPoolRepository() {
  const h = repository();
  const limits: number[] = [];
  h.repo.nextLyrics = async (limit) => {
    limits.push(limit);
    return [...h.rows.values()].filter((row) => row.task.kind === 'lyrics' && row.result === 'pending')
      .slice(0, limit).map((row) => row.task);
  };
  return { ...h, limits };
}
const settle = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };

test('three lyric lanes continue around one slow item, never duplicate a task, and commit counters serially', { timeout: 2000 }, async (t) => {
  const h = lyricPoolRepository(), job = newMediaCacheJob(['lyrics']), slow = deferred<void>();
  const fastFinished = deferred<void>(), control = new AbortController();
  t.after(() => { control.abort(); slow.resolve(); });
  await h.repo.addPage(Array.from({ length: 10 }, (_, i) => item(i))); job.cursors.lyrics.complete = true;
  let active = 0, peak = 0, commits = 0, commitPeak = 0, finishedFast = 0;
  const called: string[] = [], pending: number[] = [];
  const finish = h.repo.finish;
  h.repo.finish = async (task, outcome) => {
    commitPeak = Math.max(commitPeak, ++commits); await Promise.resolve();
    await finish(task, outcome); commits--;
    if (task.id !== '0' && ++finishedFast === 9) fastFinished.resolve();
  };
  const work = runBulkMediaWorker({ job, repository: h.repo, signal: control.signal, policy: () => null,
    page: async () => [],
    process: async (task) => {
      called.push(task.id); peak = Math.max(peak, ++active);
      if (task.id === '0') await slow.promise; else await Promise.resolve();
      active--; return 'success';
    },
    update: (_job, stats) => pending.push(stats.lyrics.pending), yield: async () => {},
  });
  await fastFinished.promise;
  assert.equal(h.rows.get('lyrics|0')?.result, 'pending', 'the slow first request does not hold up later songs');
  assert.equal(peak, 3); assert.equal(commitPeak, 1);
  assert.equal(called.length, 10); assert.equal(new Set(called).size, 10);
  slow.resolve(); await work;
  assert.equal(job.status, 'completed');
  assert.equal((await h.repo.stats()).lyrics.success, 10);
  assert.ok(pending.every((value, index) => value >= 0 && (index === 0 || value <= pending[index - 1])));
  assert.ok(h.limits.every((limit) => limit === 3), 'each refill has a bounded lookahead');
});

test('artist and album work stays sequential and never overlaps the three-lane lyric phase', { timeout: 2000 }, async () => {
  const h = lyricPoolRepository(), job = newMediaCacheJob(['artistCovers', 'albumCovers', 'lyrics']);
  await h.repo.addPage([item(0, 'artistCovers'), item(1, 'artistCovers'), item(2, 'albumCovers'), item(3, 'albumCovers'),
    item(4), item(5), item(6), item(7)]);
  for (const kind of job.selected) job.cursors[kind].complete = true;
  const active = { artistCovers: 0, albumCovers: 0, lyrics: 0 };
  const peak = { ...active }, lyricBatch = deferred<void>();
  await runBulkMediaWorker({ job, repository: h.repo, signal: new AbortController().signal, policy: () => null,
    page: async () => [],
    process: async (task) => {
      peak[task.kind] = Math.max(peak[task.kind], ++active[task.kind]);
      if (task.kind === 'lyrics') {
        assert.equal(active.artistCovers + active.albumCovers, 0);
        if (active.lyrics === 3) lyricBatch.resolve();
        await lyricBatch.promise;
      } else { assert.equal(active.lyrics, 0); await Promise.resolve(); }
      active[task.kind]--; return 'success';
    }, update: () => {}, yield: async () => {},
  });
  assert.deepEqual(peak, { artistCovers: 1, albumCovers: 1, lyrics: 3 });
});

test('pausing a lyric pool returns promptly and invalidates every late cache writer without completing pending rows', { timeout: 2000 }, async () => {
  const h = lyricPoolRepository(), job = newMediaCacheJob(['lyrics']), control = new AbortController();
  const entered = deferred<void>(), late = deferred<void>();
  await h.repo.addPage(Array.from({ length: 5 }, (_, i) => item(i))); job.cursors.lyrics.complete = true;
  const contexts: { signal: AbortSignal; current: () => boolean }[] = [];
  let writes = 0, updates = 0;
  const work = runBulkMediaWorker({ job, repository: h.repo, signal: control.signal, policy: () => null,
    page: async () => [],
    process: async (_task, context) => {
      contexts.push(context); if (contexts.length === 3) entered.resolve();
      await late.promise; if (context.current()) writes++; return 'success';
    }, update: () => { updates++; }, yield: async () => {},
  });
  await entered.promise; control.abort();
  await assert.rejects(work, MediaCacheStopped);
  assert.ok(contexts.every((context) => context.signal.aborted && !context.current()));
  assert.equal((await h.repo.stats()).lyrics.pending, 5);
  const stoppedUpdates = updates; late.resolve(); await settle();
  assert.equal(writes, 0); assert.equal(updates, stoppedUpdates);
  assert.equal((await h.repo.stats()).lyrics.pending, 5);
});

test('three failed lyric completions stop bounded work and close slow peers instead of marking them missing', { timeout: 2000 }, async () => {
  const h = lyricPoolRepository(), job = newMediaCacheJob(['lyrics']), late = deferred<void>();
  await h.repo.addPage(Array.from({ length: 8 }, (_, i) => item(i))); job.cursors.lyrics.complete = true;
  const contexts: { signal: AbortSignal; current: () => boolean }[] = [];
  let calls = 0, writes = 0;
  await assert.rejects(runBulkMediaWorker({ job, repository: h.repo, signal: new AbortController().signal, policy: () => null,
    page: async () => [],
    process: async (task, context) => {
      calls++;
      if (['1', '2', '3'].includes(task.id)) throw new Error('provider offline');
      contexts.push(context); await late.promise; if (context.current()) writes++; return 'success';
    }, update: () => {}, yield: async () => {},
  }), /repeated failures/);
  const stats = await h.repo.stats();
  assert.equal(stats.lyrics.failed, 3); assert.equal(stats.lyrics.missing, 0); assert.equal(stats.lyrics.pending, 5);
  assert.ok(calls <= 5, 'the failure budget permits only the bounded peers already in flight');
  assert.ok(contexts.every((context) => context.signal.aborted && !context.current()));
  late.resolve(); await settle(); assert.equal(writes, 0);
  assert.equal((await h.repo.stats()).lyrics.pending, 5);
});

test('policy changes while lyric requests are outstanding leave their rows pending and prevent late cache publication', { timeout: 2000 }, async () => {
  for (const reason of ['offline', 'wifi', 'profile'] as const) {
    const h = lyricPoolRepository(), job = newMediaCacheJob(['lyrics']), entered = deferred<void>(), late = deferred<void>();
    await h.repo.addPage([item(0), item(1), item(2)]); job.cursors.lyrics.complete = true;
    let policy: typeof reason | null = null, count = 0, writes = 0;
    const contexts: { signal: AbortSignal; current: () => boolean }[] = [];
    const work = runBulkMediaWorker({ job, repository: h.repo, signal: new AbortController().signal, policy: () => policy,
      page: async () => [], process: async (_task, context) => {
        contexts.push(context); if (++count === 3) entered.resolve();
        await late.promise; if (context.current()) writes++; return 'success';
      }, update: () => {}, yield: async () => {},
    });
    await entered.promise; policy = reason; late.resolve();
    await assert.rejects(work, (error: unknown) => error instanceof MediaCacheStopped && error.reason === reason);
    assert.equal(writes, 0); assert.equal((await h.repo.stats()).lyrics.pending, 3);
    assert.ok(contexts.every((context) => context.signal.aborted && !context.current()));
  }
});

test('external fallback failures after healthy empty server lyrics remain failed without blocking later server-backed songs', async () => {
  for (const pooled of [false, true]) {
    const h = pooled ? lyricPoolRepository() : repository(), job = newMediaCacheJob(['lyrics']);
    await h.repo.addPage(Array.from({ length: 8 }, (_, i) => item(i))); job.cursors.lyrics.complete = true;
    await runBulkMediaWorker({ job, repository: h.repo, signal: new AbortController().signal, policy: () => null,
      page: async () => [], process: async (task) => {
        if (Number(task.id) < 3) throw new LyricsFallbackError(new Error('External provider timed out'));
        return 'success';
      }, update: () => {}, yield: async () => {},
    });
    const stats = await h.repo.stats();
    assert.equal(job.status, 'completed');
    assert.equal(stats.lyrics.failed, 3, 'source failures remain individually visible and retryable');
    assert.equal(stats.lyrics.success, 5); assert.equal(stats.lyrics.missing, 0); assert.equal(stats.lyrics.pending, 0);
    for (let i = 0; i < 3; i++) assert.equal(h.rows.get(`lyrics|${i}`)?.result, 'failed');
  }
});

test('an isolated fallback failure resets the main-service failure streak but ordinary failures still stop after three', async () => {
  const h = repository(), job = newMediaCacheJob(['lyrics']);
  await h.repo.addPage(Array.from({ length: 8 }, (_, i) => item(i))); job.cursors.lyrics.complete = true;
  await assert.rejects(runBulkMediaWorker({ job, repository: h.repo, signal: new AbortController().signal, policy: () => null,
    page: async () => [], process: async (task) => {
      if (task.id === '2') throw new LyricsFallbackError(new Error('External provider failed'));
      throw new Error('Main server or disk failure');
    }, update: () => {}, yield: async () => {},
  }), /repeated failures/);
  const stats = await h.repo.stats();
  assert.equal(stats.lyrics.failed, 6); assert.equal(stats.lyrics.pending, 2);
  assert.equal(stats.lyrics.missing, 0);
});

test('failure observers receive original errors while observer throws and rejections cannot change the failure budget', async () => {
  const h = repository(), job = newMediaCacheJob(['lyrics']);
  await h.repo.addPage(Array.from({ length: 5 }, (_, i) => item(i))); job.cursors.lyrics.complete = true;
  const errors = Array.from({ length: 3 }, () => new Error('original process failure'));
  const observed: { id: string; error: unknown }[] = [];
  await assert.rejects(runBulkMediaWorker({ job, repository: h.repo, signal: new AbortController().signal, policy: () => null,
    page: async () => [], process: async (task) => { throw errors[Number(task.id)]; },
    onFailure: (task, error) => { observed.push({ id: task.id, error });
      if (task.id === '0') throw new Error('observer must not replace original failure');
      return Promise.reject(new Error('asynchronous diagnostics failed'));
    }, update: () => {}, yield: async () => {},
  }), /repeated failures/);
  assert.deepEqual(observed.map((value) => value.id), ['0', '1', '2']);
  assert.ok(observed.every((value, index) => value.error === errors[index]));
  const stats = await h.repo.stats();
  assert.equal(stats.lyrics.failed, 3); assert.equal(stats.lyrics.pending, 2); assert.equal(stats.lyrics.missing, 0);
});

test('late process failures after pause cannot emit failure diagnostics or complete a pending row', async () => {
  const h = repository(), job = newMediaCacheJob(['lyrics']), control = new AbortController();
  await h.repo.addPage([item(1)]); job.cursors.lyrics.complete = true;
  const entered = deferred<void>(), release = deferred<void>(); let failures = 0;
  const work = runBulkMediaWorker({ job, repository: h.repo, signal: control.signal, policy: () => null,
    page: async () => [], process: async () => { entered.resolve(); await release.promise; throw new Error('late private error'); },
    onFailure: () => { failures++; }, update: () => {}, yield: async () => {},
  });
  await entered.promise; control.abort(); await assert.rejects(work, MediaCacheStopped);
  release.resolve(); await settle();
  assert.equal(failures, 0); assert.equal((await h.repo.stats()).lyrics.pending, 1);
});
