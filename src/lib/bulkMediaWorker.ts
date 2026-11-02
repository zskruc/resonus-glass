import type { MediaCacheJob, MediaCacheKind, MediaCacheOutcome, MediaCacheReason, MediaCacheStats, MediaCacheTask } from './mediaCacheTypes';
import { LyricsFallbackError } from './lyricsLookupError';

export interface MediaCacheRepository {
  saveJob: (job: MediaCacheJob) => Promise<void>;
  addPage: (tasks: MediaCacheTask[]) => Promise<number>;
  next: (selected: MediaCacheKind[]) => Promise<MediaCacheTask | undefined>;
  /** A bounded lookahead, still pending until the coordinator commits each result. */
  nextLyrics?: (limit: number) => Promise<MediaCacheTask[]>;
  finish: (task: MediaCacheTask, result: MediaCacheOutcome) => Promise<void>;
  stats: () => Promise<MediaCacheStats>;
}
interface Options {
  job: MediaCacheJob;
  repository: MediaCacheRepository;
  /** Single page, never a fixed first-N list masquerading as the library. */
  page: (kind: MediaCacheKind, offset: number, size: number) => Promise<MediaCacheTask[]>;
  process: (task: MediaCacheTask, context: { signal: AbortSignal; current: () => boolean }) => Promise<MediaCacheOutcome>;
  policy: () => MediaCacheReason;
  signal: AbortSignal;
  update: (job: MediaCacheJob, stats: MediaCacheStats) => void;
  /** Diagnostics must never replace a task's original failure or affect progress. */
  onFailure?: (task: MediaCacheTask, error: unknown) => void | Promise<void>;
  pageSize?: number;
  /** Yield between items so UI, foreground playback and their callbacks run. */
  yield?: (delay?: number) => Promise<void>;
}
export class MediaCacheStopped extends Error {
  readonly reason: Exclude<MediaCacheReason, null>;
  constructor(reason: Exclude<MediaCacheReason, null>) { super(reason); this.reason = reason; }
}

/** Pausing must not wait for a transport or timer that stopped delivering callbacks. */
export async function awaitMediaCacheWork<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new MediaCacheStopped('user'));
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
  try { return await Promise.race([work, interrupted]); }
  finally { if (stop) signal.removeEventListener('abort', stop); }
}

/** One coordinator per explicit run; only lyrics use a bounded three-request pool. */
export async function runBulkMediaWorker(options: Options): Promise<void> {
  const { job, repository: repo } = options;
  const controller = new AbortController();
  const signal = controller.signal;
  let active = true;
  const interrupt = () => controller.abort();
  options.signal.addEventListener('abort', interrupt, { once: true });
  if (options.signal.aborted) interrupt();
  const current = () => active && !signal.aborted && options.policy() === null;
  const check = () => {
    const reason = options.policy();
    if (signal.aborted || reason) throw new MediaCacheStopped(reason ?? 'user');
  };
  try {
    check();
    const stats = await repo.stats();
    check();
    const publish = async (save = true) => {
      check();
      if (save) await repo.saveJob(job);
      check();
      // Counters advance with committed rows. Recounting the whole task table
      // after every song would turn a large library scan into quadratic work.
      options.update(job, Object.fromEntries(Object.entries(stats).map(([kind, count]) => [kind, { ...count }])) as MediaCacheStats);
    };
    const yieldUi = options.yield ?? ((delay = 30) => new Promise<void>((resolve) => setTimeout(resolve, delay)));
    for (const kind of job.selected) {
      const cursor = job.cursors[kind];
      const pages = new Set<string>(cursor.pageSignature ? [cursor.pageSignature] : []);
      while (!cursor.complete) {
        check(); job.status = 'discovering'; job.phase = kind;
        await publish();
        const page = await awaitMediaCacheWork(options.page(kind, cursor.offset, options.pageSize ?? 200), signal);
        check();
        if (page.length === 0) cursor.complete = true;
        else {
          const keys = JSON.stringify(page.map((task) => task.id));
          let first = 2166136261, second = 0x9e3779b9;
          for (let index = 0; index < keys.length; index++) {
            first = Math.imul(first ^ keys.charCodeAt(index), 16777619);
            second = Math.imul(second ^ keys.charCodeAt(index), 2246822519);
          }
          const signature = `${page.length}:${first >>> 0}:${second >>> 0}`;
          if (pages.has(signature)) throw new Error('Media cache pagination did not advance');
          const added = await repo.addPage(page);
          check();
          stats[kind].total += added; stats[kind].pending += added;
          // Some servers cap pages below the requested size; only an empty
          // page finishes discovery. An ignored offset must fail visibly.
          // Replaying a page after a process stopped between INSERT and saving
          // its cursor is safe: INSERT OR IGNORE keeps the task unique.
          pages.add(signature); cursor.pageSignature = signature;
          cursor.offset += page.length;
        }
        await publish(); await awaitMediaCacheWork(yieldUi(), signal);
      }
    }
    job.status = 'running';
    await publish();
    let failures = 0;
    type Processed = { result: MediaCacheOutcome; isolatedFallback?: boolean };
    const process = async (task: MediaCacheTask): Promise<Processed> => {
      check();
      try {
        const result = await awaitMediaCacheWork(options.process(task, { signal, current }), signal);
        check();
        return { result };
      } catch (error) {
        check();
        if (error instanceof MediaCacheStopped) throw error;
        try { void Promise.resolve(options.onFailure?.(task, error)).catch(() => {}); } catch { /* Diagnostics are best-effort. */ }
        return { result: 'failed', isolatedFallback: task.kind === 'lyrics' && error instanceof LyricsFallbackError };
      }
    };
    // Only the coordinator commits. Out-of-order network completion must never
    // race counters, task updates, the failure budget or the progress callback.
    const finish = async (task: MediaCacheTask, processed: Processed) => {
      const { result, isolatedFallback } = processed;
      check();
      await repo.finish(task, result);
      check();
      stats[task.kind].pending--; stats[task.kind][result]++;
      await publish(false);
      // A confirmed healthy music server with no lyric is not an outage merely
      // because the optional external lookup failed. Keep that item's failure
      // visible/retryable without blocking unrelated server-backed songs.
      failures = result === 'failed' && !isolatedFallback ? failures + 1 : 0;
      if (failures >= 3) throw new Error('Media cache stopped after repeated failures');
      // Lyrics already await network/SQLite; yield without adding a fixed 30ms
      // to every item. Cover work retains its existing pacing.
      await awaitMediaCacheWork(yieldUi(task.kind === 'lyrics' || result === 'cached' || result === 'missing' ? 0 : 30), signal);
    };
    const lyrics = async (first: MediaCacheTask) => {
      type Completion = { task: MediaCacheTask; result?: Processed; error?: unknown };
      type Entry = { work: Promise<Completion>; settled: boolean };
      const inFlight = new Map<string, Entry>();
      const hasCompleted = () => [...inFlight.values()].some((entry) => entry.settled);
      const start = (task: MediaCacheTask) => {
        const key = `${task.kind}|${task.id}`;
        if (task.kind !== 'lyrics' || inFlight.has(key) || inFlight.size >= 3) return;
        let entry: Entry;
        const work = process(task).then(
          (result) => { entry.settled = true; return { task, result }; },
          (error: unknown) => { entry.settled = true; return { task, error }; },
        );
        entry = { work, settled: false };
        inFlight.set(key, entry);
      };
      start(first);
      for (;;) {
        check();
        if (inFlight.size < 3 && !hasCompleted()) {
          const candidates = await awaitMediaCacheWork(repo.nextLyrics!(3), signal);
          check();
          // Harvest already-failed work before adding replacements. A complete
          // outage stops after three failures rather than spawning another wave.
          if (!hasCompleted()) for (const candidate of candidates) start(candidate);
        }
        if (inFlight.size === 0) return;
        const done = await awaitMediaCacheWork(Promise.race([...inFlight.values()].map((entry) => entry.work)), signal);
        check();
        inFlight.delete(`${done.task.kind}|${done.task.id}`);
        if ('error' in done) throw done.error;
        await finish(done.task, done.result!);
      }
    };
    for (;;) {
      check();
      const task = await repo.next(job.selected);
      check();
      if (!task) break;
      if (job.phase !== task.kind) { job.phase = task.kind; await publish(); }
      if (task.kind === 'lyrics' && repo.nextLyrics) await lyrics(task);
      else await finish(task, await process(task));
    }
    check(); job.status = 'completed'; job.phase = null; job.reason = null;
    await publish();
  } finally {
    active = false;
    controller.abort();
    options.signal.removeEventListener('abort', interrupt);
  }
}
