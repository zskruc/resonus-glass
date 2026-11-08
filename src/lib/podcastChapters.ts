import type { PodcastChapter } from '@/api/subsonic';
import { podcastTimestamp, safePodcastUrl } from './podcastShowNotes';

export const MAX_PODCAST_CHAPTERS = 1000;
export function normalizePodcastChapters(rows: readonly unknown[], base?: string): PodcastChapter[] {
  const result: PodcastChapter[] = [], seen = new Set<number>();
  for (const raw of rows.slice(0, 3000)) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const start = podcastTimestamp(row.startSec ?? row.startTime ?? row.start), title = typeof row.title === 'string' ? row.title.trim().slice(0, 1000) : '';
    if (start === undefined || !title || row.toc === false || seen.has(start)) continue;
    const end = podcastTimestamp(row.endSec ?? row.endTime), url = safePodcastUrl(row.url ?? row.href, base), imageUrl = safePodcastUrl(row.imageUrl ?? row.img ?? row.image, base);
    seen.add(start); result.push({ startSec: start, title, ...(end !== undefined && end > start ? { endSec: end } : {}),
      ...(url ? { url } : {}), ...(imageUrl ? { imageUrl } : {}) });
    if (result.length === MAX_PODCAST_CHAPTERS) break;
  }
  return result.sort((a, b) => a.startSec - b.startSec);
}
export class PodcastChapterError extends Error {
  readonly code: 'offline' | 'stopped' | 'timeout' | 'http' | 'tooLarge' | 'invalid';
  constructor(code: PodcastChapterError['code']) { super(code); this.name = 'PodcastChapterError'; this.code = code; }
}
export function parsePodcastChapters(value: unknown, base?: string): PodcastChapter[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { chapters?: unknown }).chapters)) throw new PodcastChapterError('invalid');
  return normalizePodcastChapters((value as { chapters: unknown[] }).chapters, base);
}
interface ChaptersResponse {
  ok: boolean; headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
  body?: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<unknown>; releaseLock: () => void } } | null;
}
/** A caller must explicitly request chapters. Public, credential-free JSON only,
 * never an episode media download. All stages share one hard 20-second budget. */
export async function fetchPodcastChapters(url: string, options: {
  fetch: (url: string, init: { signal: AbortSignal; credentials: 'omit'; headers: Record<string, string> }) => Promise<ChaptersResponse>;
  current: () => boolean; offline: () => boolean; signal?: AbortSignal;
}): Promise<PodcastChapter[]> {
  const source = safePodcastUrl(url); if (!source) throw new PodcastChapterError('invalid');
  const ctl = new AbortController(); let failure: PodcastChapterError | undefined;
  let rejectStop!: (error: PodcastChapterError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const stop = (code: 'timeout' | 'stopped') => { if (failure) return; failure = new PodcastChapterError(code); ctl.abort(); rejectStop(failure); };
  const abort = () => stop('stopped'); options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('timeout'), 20_000), limit = 512 * 1024;
  const check = () => {
    if (failure) throw failure;
    if (options.signal?.aborted || !options.current()) throw new PodcastChapterError('stopped');
    if (options.offline()) throw new PodcastChapterError('offline');
  };
  const work = async () => {
    check();
    const response = await options.fetch(source, { signal: ctl.signal, credentials: 'omit', headers: { accept: 'application/json, application/json+chapters' } });
    check(); if (!response.ok) throw new PodcastChapterError('http');
    const bytes = Number(response.headers.get('content-length')), mime = response.headers.get('content-type')?.toLowerCase();
    if (Number.isFinite(bytes) && bytes > limit) throw new PodcastChapterError('tooLarge');
    if (mime && !/json|text\/plain/.test(mime)) throw new PodcastChapterError('invalid');
    let body = '';
    if (response.body) {
      const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0;
      try {
        while (true) {
          const part = await reader.read(); check(); if (part.done) break;
          if (!part.value) continue; size += part.value.byteLength;
          if (size > limit) throw new PodcastChapterError('tooLarge');
          body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
      } catch (error) { void reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    } else {
      body = await response.text(); check();
      if (body.length > limit || new TextEncoder().encode(body).byteLength > limit) throw new PodcastChapterError('tooLarge');
    }
    check(); let value: unknown;
    try { value = JSON.parse(body); } catch { throw new PodcastChapterError('invalid'); }
    return parsePodcastChapters(value, source);
  };
  try { return await Promise.race([work(), stopped]); }
  catch (error) {
    if (failure) throw failure;
    if (!options.current() || options.signal?.aborted) throw new PodcastChapterError('stopped');
    if (options.offline()) throw new PodcastChapterError('offline');
    if (error instanceof PodcastChapterError) throw error;
    throw new PodcastChapterError('http');
  }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); ctl.abort(); }
}
