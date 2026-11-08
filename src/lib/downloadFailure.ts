import type { Song } from '@/api/subsonic';

/** Native messages can echo credentials as quoted JSON or bare query fields.
 * Retain recognized failure categories, never arbitrary server/native text. */
function failureReason(message: string): string {
  const fixed = ['error body, not audio', 'incomplete audio file', 'Invalid resumed response', 'Unexpected partial response'];
  for (const reason of fixed) if (message === reason) return reason;
  const status = /\bHTTP\s+(\d{3})\b/i.exec(message);
  if (status) return `HTTP ${status[1]}`;
  if (/\bENOSPC\b|no space left|disk full/i.test(message)) return 'device storage full';
  if (/\bEACCES\b|permission denied/i.test(message)) return 'file permission denied';
  if (/\bENOENT\b|no such file/i.test(message)) return 'local file missing';
  if (/timed?\s*out|timeout|ETIMEDOUT/i.test(message)) return 'network timeout';
  if (/UnknownHost|unable to resolve|name.*not.*resolved|\bDNS\b/i.test(message)) return 'DNS lookup failed';
  if (/certificate|SSLHandshake|\bTLS\b/i.test(message)) return 'secure connection failed';
  if (/connection (?:refused|reset)|ECONNRESET|ECONNREFUSED|network.*(?:lost|unreachable)/i.test(message)) return 'network connection failed';
  if (/sqlite|database.*(?:locked|full|write|error)/i.test(message)) return 'local catalog write failed';
  return 'native transfer or file operation failed';
}

/** Reports only a few terminal failures per batch. Never include a request URL,
 * file path, or account credentials in the shareable Diagnostics events. */
export function createDownloadFailureReporter(note: (message: string) => void) {
  let reported = 0;
  return (song: Pick<Song, 'suffix'>, error: unknown, target?: { ext: string; bitRate?: number }) => {
    if (reported >= 3) return;
    try {
      const message = error && typeof error === 'object' && 'message' in error
        ? String(error.message) : String(error);
      const why = failureReason(message);
      const ext = (value?: string) => /^[a-z0-9]{1,12}$/i.test(value ?? '') ? value : '?';
      const converted = target && Number.isFinite(target.bitRate) && target.bitRate! > 0
        ? ` as ${ext(target.ext)} ${target.bitRate}k` : '';
      reported++;
      note(`download failed: ${why} (${ext(song.suffix)}${converted})`);
    } catch {
      // Diagnostic collection must not replace the actual download error.
    }
  };
}
