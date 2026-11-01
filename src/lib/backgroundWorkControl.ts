export type BackgroundWorkOwner = 'music' | 'media-cache';
export type BackgroundWorkInterruption = 'pause' | 'cancel' | 'timeout' | 'service-destroyed' | 'start-failed';
export interface BackgroundWorkProgress {
  completed: number;
  total: number;
  failed?: number;
  bytesDone?: number;
  bytesTotal?: number;
  phase?: string;
}
export interface BackgroundWorkLease {
  active(): boolean;
  update(progress: BackgroundWorkProgress): void;
  release(): Promise<void>;
  wait(delayMs: number): Promise<void>;
}
type Progress = Omit<BackgroundWorkProgress, 'phase' | 'failed'> & { failed: number; locale: 'zh' | 'en' };
type Reference = { owner: BackgroundWorkOwner; runId: string; token: string };
type Interruption = { id: string; reason: string; leases: Reference[] };
export interface BackgroundWorkDriver {
  startJob(owner: BackgroundWorkOwner, runId: string, progress: Progress): Promise<{
    ok: boolean; token?: string; headlessActive?: boolean; reason?: string;
  }>;
  updateJob(token: string, progress: Progress): Promise<boolean>;
  stopJob(token: string): Promise<boolean>;
  stopPendingJob?(owner: BackgroundWorkOwner, runId: string): Promise<boolean>;
  delay(ms: number): Promise<void>;
  addInterruptionListener(listener: (event: Interruption) => void): { remove(): void };
  drainInterruptions(): Promise<Interruption[]>;
}
export class BackgroundWorkError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Background work unavailable: ${reason}`); this.name = 'BackgroundWorkError'; this.reason = reason;
  }
}
interface Options {
  driver?: BackgroundWorkDriver;
  required: boolean;
  foreground(): boolean;
  locale(): string;
  nonce?: () => string;
  delay?: (ms: number) => Promise<void>;
}
interface Entry {
  owner: BackgroundWorkOwner;
  runId: string;
  token?: string;
  ended: boolean;
  lost?: BackgroundWorkInterruption;
  current(): boolean;
  interrupted(reason: BackgroundWorkInterruption): void;
  latest?: Progress;
  sending: boolean;
}

/** Explicit user jobs share one native service, but never share stop authority. */
export function createBackgroundWorkCoordinator(options: Options) {
  const driver = options.driver;
  const entries = new Map<string, Entry>();
  let serial = 0;
  let subscription: { remove(): void } | undefined;
  const smallNumber = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
  const progress = (value: BackgroundWorkProgress): Progress => {
    const completed = smallNumber(value.completed);
    return { completed, total: Math.max(completed, smallNumber(value.total)),
      failed: Math.min(completed, smallNumber(value.failed)),
      bytesDone: smallNumber(value.bytesDone), bytesTotal: smallNumber(value.bytesTotal),
      locale: options.locale().toLowerCase().startsWith('zh') ? 'zh' : 'en' };
  };
  const closeSubscription = () => { if (!entries.size) { subscription?.remove(); subscription = undefined; } };
  const end = (entry: Entry) => {
    entry.ended = true;
    if (entries.get(entry.runId) === entry) entries.delete(entry.runId);
    closeSubscription();
  };
  const stop = async (token?: string) => { if (driver && token) await driver.stopJob(token).catch(() => {}); };
  const lost = (entry: Entry, reason: BackgroundWorkInterruption) => {
    if (entry.ended) return;
    entry.lost = reason; end(entry);
    void stop(entry.token);
    if (entry.current()) entry.interrupted(reason);
  };
  const receive = (event: Interruption) => {
    const reason: BackgroundWorkInterruption = ['pause', 'cancel', 'timeout', 'start-failed'].includes(event.reason)
      ? event.reason as BackgroundWorkInterruption : 'service-destroyed';
    for (const reference of event.leases) {
      const entry = entries.get(reference.runId);
      if (entry && reference.owner === entry.owner && (!entry.token || reference.token === entry.token)) lost(entry, reason);
    }
  };
  const subscribe = () => {
    if (subscription || !driver) return;
    subscription = driver.addInterruptionListener(receive);
    // Subscribe first: a stop between promotion and Promise resolution must
    // invalidate that pending lease too. Duplicate drained events are inert.
    void driver.drainInterruptions().then((events) => events.forEach(receive), () => {});
  };
  const pump = (entry: Entry) => {
    if (!driver || !entry.token || entry.ended || entry.sending || !entry.latest) return;
    const next = entry.latest; entry.latest = undefined; entry.sending = true;
    void driver.updateJob(entry.token, next).then((ok) => { if (!ok) lost(entry, 'service-destroyed'); },
      () => lost(entry, 'service-destroyed')).finally(() => { entry.sending = false; pump(entry); });
  };
  return {
    async acquire(owner: BackgroundWorkOwner, initial: BackgroundWorkProgress,
      interrupted: Entry['interrupted'], current: Entry['current'] = () => true,
      signal?: AbortSignal): Promise<BackgroundWorkLease> {
      if (!current() || signal?.aborted) throw new BackgroundWorkError('interrupted');
      if (!driver) {
        if (options.required) throw new BackgroundWorkError('native-module-missing');
        if (!options.foreground()) throw new BackgroundWorkError('foreground-required');
        let released = false;
        return { active: () => false, update() {}, release: async () => { released = true; },
          async wait(ms) {
            if (released || !current() || !options.foreground()) throw new BackgroundWorkError('interrupted');
            await (options.delay ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay))))(smallNumber(ms));
          } };
      }
      const runId = `${options.nonce?.() ?? Date.now().toString(36)}-${++serial}`;
      const entry: Entry = { owner, runId, current, interrupted, ended: false, sending: false };
      entries.set(runId, entry);
      let abortedWhileAcquiring = false;
      let removeAbort = () => {};
      try {
        subscribe();
        const aborted = new Promise<never>((_, reject) => {
          const abort = () => {
            abortedWhileAcquiring = true; end(entry);
            void driver.stopPendingJob?.(owner, runId).catch(() => {});
            reject(new BackgroundWorkError('interrupted'));
          };
          signal?.addEventListener('abort', abort, { once: true });
          removeAbort = () => signal?.removeEventListener('abort', abort);
          if (signal?.aborted) abort();
        });
        const beginning = driver.startJob(owner, runId, progress(initial));
        // An aborted caller must not wait for JobScheduler's network constraints.
        // If native promotion was already queued, dispose its exact late token.
        void beginning.then((result) => {
          if (abortedWhileAcquiring && result.token) void stop(result.token);
        }, () => {});
        const result = await Promise.race([beginning, aborted]);
        removeAbort();
        if (!result.ok || !result.token || result.headlessActive !== true) {
          // Native may resolve a pending start before delivering its stop event.
          // Preserve the user's pause/cancel intent in either delivery order.
          if (result.reason === 'pause' || result.reason === 'cancel' || result.reason === 'timeout') {
            lost(entry, result.reason);
          }
          await stop(result.token);
          throw new BackgroundWorkError(result.reason ?? 'protection-not-ready');
        }
        entry.token = result.token;
        if (entry.ended || !current()) {
          end(entry); if (!abortedWhileAcquiring) await stop(result.token);
          throw new BackgroundWorkError(entry.lost ?? 'interrupted');
        }
      } catch (error) { removeAbort(); end(entry); throw error; }
      const active = () => !entry.ended && !entry.lost && entry.current();
      return {
        active,
        update(value) {
          if (!active()) return;
          entry.latest = progress(value); pump(entry);
        },
        async release() { if (entry.ended) return; end(entry); await stop(entry.token); },
        async wait(ms) {
          if (!active()) throw new BackgroundWorkError('interrupted');
          await driver.delay(Math.min(300_000, smallNumber(ms)));
          if (!active()) throw new BackgroundWorkError('interrupted');
        },
      };
    },
  };
}
