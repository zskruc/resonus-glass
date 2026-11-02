/** One considerate queue for the external lyrics provider, independent of NAS requests. */
export interface LyricsProviderResponse {
  status: number;
  headers: { get(name: string): string | null | undefined };
  text(): Promise<string>;
}
export interface LyricsProviderRequestOptions {
  headers?: HeadersInit;
  stillCurrent?: () => boolean;
  signal?: AbortSignal;
}
export interface LyricsProviderRequestDeps {
  fetch: (url: string, options: { headers?: HeadersInit; signal?: AbortSignal }) => Promise<LyricsProviderResponse>;
  now?: () => number;
  /** Native-backed on Android so queue/backoff/deadlines continue while locked. */
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
  deadlineMs?: number;
  maxAttempts?: number;
  maxWaitMs?: number;
}
export type LyricsProviderRequestCode = 'stopped' | 'timeout' | 'network' | 'http' | 'invalid-json' | 'cooldown';
export class LyricsProviderRequestError extends Error {
  readonly code: LyricsProviderRequestCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;
  constructor(code: LyricsProviderRequestCode, message: string,
    details: { status?: number; retryAfterMs?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: details.cause });
    this.name = 'LyricsProviderRequestError';
    this.code = code; this.status = details.status; this.retryAfterMs = details.retryAfterMs;
    this.retryable = details.retryable ?? false;
  }
}
export interface LyricsProviderJsonResponse { status: number; ok: boolean; data: unknown }

const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const START_SPACING_MS = 700;
const FINISH_SPACING_MS = 250;
const POLL_MS = 500;
const positive = (value: number | undefined, fallback: number) => Number.isFinite(value) && value! > 0 ? value! : fallback;

export function createLyricsProviderRequest(deps: LyricsProviderRequestDeps) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const deadlineMs = positive(deps.deadlineMs, 15_000);
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(positive(deps.maxAttempts, 3))));
  const maxWaitMs = Math.min(60_000, positive(deps.maxWaitMs, 60_000));
  let tail: Promise<void> = Promise.resolve();
  let lastStart = -Infinity, lastFinish = -Infinity, blockedUntil = 0;
  let blockedStatus: number | undefined;

  const check = (options: LyricsProviderRequestOptions) => {
    if (options.signal?.aborted || options.stillCurrent && !options.stillCurrent()) {
      throw new LyricsProviderRequestError('stopped', 'Lyrics provider request stopped');
    }
  };
  const pause = async (ms: number, options: LyricsProviderRequestOptions) => {
    try { await wait(ms); }
    catch (cause) {
      check(options);
      throw new LyricsProviderRequestError('stopped', 'Lyrics provider wait interrupted', { cause });
    }
  };
  // A native body read may ignore abort. Race it against the independently
  // advancing clock without allowing its eventual result to publish anything.
  const guarded = async <T,>(work: Promise<T>, options: LyricsProviderRequestOptions, deadline = Infinity): Promise<T> => {
    type Result = { ok: true; value: T } | { ok: false; error: unknown };
    let result: Result | undefined;
    const completed = work.then((value) => { result = { ok: true, value }; },
      (error: unknown) => { result = { ok: false, error }; });
    for (;;) {
      check(options);
      await Promise.resolve();
      check(options);
      if (now() >= deadline) throw new LyricsProviderRequestError('timeout', 'Lyrics provider request timed out', { retryable: true });
      if (result) {
        if (!result.ok) throw result.error;
        return result.value;
      }
      await Promise.race([completed, pause(Math.min(POLL_MS, Math.max(1, deadline - now())), options)]);
    }
  };
  const retryDelay = (header: string | null | undefined, attempt: number) => {
    let delay = Number.NaN;
    if (header?.trim()) {
      const value = header.trim();
      delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now();
    }
    if (!Number.isFinite(delay)) delay = 1000 * 2 ** (attempt - 1);
    const sample = random();
    const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
    return Math.ceil(Math.max(0, delay) * (1 + jitter * .3));
  };
  const cooldown = () => new LyricsProviderRequestError('cooldown', 'Lyrics provider requires a longer wait', {
    status: blockedStatus, retryAfterMs: Math.max(0, blockedUntil - now()), retryable: true,
  });

  async function requestJson(url: string, options: LyricsProviderRequestOptions = {}): Promise<LyricsProviderJsonResponse> {
    check(options);
    const previous = tail;
    let release!: () => void;
    const own = new Promise<void>((resolve) => { release = resolve; });
    // A cancelled waiter releases its own placeholder, never its predecessor's
    // slot. Later callers still wait for the actual active request to finish.
    tail = previous.then(() => own);
    try {
      await guarded(previous, options);
      let waitedMs = 0;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        check(options);
        const readyAt = Math.max(lastStart + START_SPACING_MS, lastFinish + FINISH_SPACING_MS, blockedUntil);
        if (readyAt - now() > maxWaitMs - waitedMs) throw cooldown();
        while (now() < readyAt) {
          check(options);
          const delay = Math.min(POLL_MS, Math.max(1, readyAt - now()));
          await pause(delay, options); waitedMs += delay;
        }
        check(options);
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        let receivedStatus: number | undefined;
        let retryAfter: string | null | undefined;
        let attemptBlockedUntil: number | undefined;
        let response: LyricsProviderJsonResponse;
        lastStart = now();
        const deadline = lastStart + deadlineMs;
        try {
          response = await guarded((async () => {
            const received = await deps.fetch(url, { headers: options.headers, signal: controller.signal });
            check(options);
            if (controller.signal.aborted) throw new LyricsProviderRequestError('stopped', 'Lyrics provider attempt ended');
            receivedStatus = received.status;
            retryAfter = received.headers.get('Retry-After');
            // Record a known provider cooldown at the headers, even if a pause
            // or stalled body prevents this particular caller from finishing.
            if (TRANSIENT.has(received.status)) {
              attemptBlockedUntil = now() + retryDelay(retryAfter, attempt);
              blockedUntil = Math.max(blockedUntil, attemptBlockedUntil); blockedStatus = received.status;
            }
            const body = await received.text();
            check(options);
            if (controller.signal.aborted) throw new LyricsProviderRequestError('stopped', 'Lyrics provider attempt ended');
            let data: unknown = null;
            try { data = JSON.parse(body) as unknown; }
            catch (cause) {
              if (received.status >= 200 && received.status < 300) {
                throw new LyricsProviderRequestError('invalid-json', 'Lyrics provider returned invalid JSON', {
                  status: received.status, cause,
                });
              }
              // Error responses can be HTML/plain text; status and cooldown
              // remain authoritative, and raw bodies never enter diagnostics.
            }
            return { status: received.status, ok: received.status >= 200 && received.status < 300, data };
          })(), options, deadline);
        } catch (cause) {
          controller.abort();
          check(options);
          const error = cause instanceof LyricsProviderRequestError ? cause
            : new LyricsProviderRequestError('network', 'Lyrics provider could not be reached', { retryable: true, cause });
          if (!error.retryable) throw error;
          if (attemptBlockedUntil === undefined) {
            const delay = retryDelay(retryAfter, attempt);
            blockedUntil = Math.max(blockedUntil, now() + delay); blockedStatus = receivedStatus;
          }
          if (attempt === maxAttempts) {
            throw new LyricsProviderRequestError(error.code, error.message, {
              status: receivedStatus, retryAfterMs: Math.max(0, blockedUntil - now()), retryable: true, cause: error,
            });
          }
          continue;
        } finally {
          lastFinish = now();
          options.signal?.removeEventListener('abort', abort);
        }
        check(options);
        if (!TRANSIENT.has(response.status)) return response;
        if (attempt === maxAttempts) {
          throw new LyricsProviderRequestError('http', `Lyrics provider returned HTTP ${response.status}`, {
            status: response.status, retryAfterMs: Math.max(0, blockedUntil - now()), retryable: true,
          });
        }
      }
      throw new LyricsProviderRequestError('http', 'Lyrics provider attempts exhausted', { retryable: true });
    } finally { release(); }
  }
  return { requestJson };
}
