import type { MediaCacheKind, MediaCacheTask } from './mediaCacheTypes';

const NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError',
  'SubsonicRequestError', 'LyricsFallbackError', 'LyricsProviderRequestError', 'MediaCacheStopped']);
const CODES = new Set(['stopped', 'timeout', 'network', 'http', 'invalid-json', 'cooldown',
  'ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EIO', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']);
const SUBSONIC_CODES = new Set([0, 10, 20, 30, 40, 41, 42, 43, 44, 50, 60, 70]);
const KINDS = new Set<MediaCacheKind>(['artistCovers', 'albumCovers', 'lyrics']);

interface FailurePart {
  name: string;
  code?: string | number;
  status?: number;
  network?: boolean;
  retryAfterMs?: number;
}
interface BundleLocation { line: number; column: number }

/** Property getters on foreign/native errors must not break failure handling. */
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  try { return (value as Record<string, unknown>)[key]; } catch { return undefined; }
}

/** Keep diagnostics useful without copying messages, URLs, bodies or stacks. */
export function sanitizeMediaCacheFailure(task: Pick<MediaCacheTask, 'kind' | 'id'>, error: unknown) {
  const errorChain: FailurePart[] = [];
  const locations: BundleLocation[] = [];
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 3 && current != null && !seen.has(current); depth++) {
    seen.add(current);
    const name = field(current, 'name');
    const part: FailurePart = { name: typeof name === 'string' && NAMES.has(name) ? name : 'UnknownError' };
    const code = field(current, 'code');
    if (typeof code === 'string' && CODES.has(code) || typeof code === 'number' && SUBSONIC_CODES.has(code)) part.code = code as string | number;
    const status = field(current, 'status');
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) part.status = status;
    const network = field(current, 'network');
    if (typeof network === 'boolean') part.network = network;
    const retryAfterMs = field(current, 'retryAfterMs');
    if (typeof retryAfterMs === 'number' && Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0) part.retryAfterMs = retryAfterMs;
    errorChain.push(part);
    const stack = field(current, 'stack');
    if (typeof stack === 'string') {
      for (const match of stack.slice(0, 65_536).matchAll(/\bindex\.android\.bundle:(\d+):(\d+)(?=[)\s]|$)/g)) {
        const line = Number(match[1]), column = Number(match[2]);
        if (Number.isSafeInteger(line) && line > 0 && Number.isSafeInteger(column) && column > 0 &&
          !locations.some((location) => location.line === line && location.column === column)) locations.push({ line, column });
        if (locations.length >= 8) break;
      }
    }
    current = field(current, 'cause');
  }
  return { kind: KINDS.has(task.kind) ? task.kind : 'unknown',
    id: /^[A-Za-z0-9_-]{1,128}$/.test(task.id) ? task.id : '[redacted]', errorChain, locations: locations.slice(0, 8) };
}
