import type { MediaCacheJob, MediaCacheKind, MediaCacheOutcome, MediaCacheReason, MediaCacheStats, MediaCacheTask } from './mediaCacheTypes';

export interface MediaCacheRepository {
  saveJob: (job: MediaCacheJob) => Promise<void>;
  addPage: (tasks: MediaCacheTask[]) => Promise<number>;
  next: (selected: MediaCacheKind[]) => Promise<MediaCacheTask | undefined>;
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
  pageSize?: number;
  /** Yield between items so UI, foreground playback and their callbacks run. */
  yield?: (delay?: number) => Promise<void>;
}
export class MediaCacheStopped extends Error {
  readonly reason: Exclude<MediaCacheReason, null>;
  constructor(reason: Exclude<MediaCacheReason, null>) { super(reason); this.reason = reason; }
}

/** One sequential worker per explicit run; all state/checkpoints are profile-scoped. */
export async function runBulkMediaWorker(options: Options): Promise<void> {
  const { job, repository: repo, signal } = options;
  const current = () => !signal.aborted && options.policy() === null;
  const check = () => {
    const reason = options.policy();
    if (signal.aborted || reason) throw new MediaCacheStopped(reason ?? 'user');
  };
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
      const page = await options.page(kind, cursor.offset, options.pageSize ?? 200);
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
      await publish(); await yieldUi();
    }
  }
  job.status = 'running';
  await publish();
  let failures = 0;
  for (;;) {
    check();
    const task = await repo.next(job.selected);
    check();
    if (!task) break;
    if (job.phase !== task.kind) { job.phase = task.kind; await publish(); }
    let result: MediaCacheOutcome;
    try { result = await options.process(task, { signal, current }); }
    catch (error) {
      check();
      if (error instanceof MediaCacheStopped) throw error;
      result = 'failed';
    }
    check();
    await repo.finish(task, result);
    stats[task.kind].pending--; stats[task.kind][result]++;
    await publish(false);
    failures = result === 'failed' ? failures + 1 : 0;
    // A server outage or full disk must not produce thousands of retries.
    if (failures >= 3) throw new Error('Media cache stopped after repeated failures');
    await yieldUi(result === 'cached' || result === 'missing' ? 0 : 30);
  }
  check(); job.status = 'completed'; job.phase = null; job.reason = null;
  await publish();
}
