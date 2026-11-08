/**
 * Lyrics for local/offline music, in order of preference:
 *
 * 1. `.ttml` or `.lrc` file next to the audio file (same name), in that order
 *    as Navidrome reads them. Also covers downloads: when downloading a song
 *    the server lyrics are cached in the `.lrc`.
 * 2. Embedded lyrics in the file itself (ID3 USLT frame).
 * 3. LRCLIB (lrclib.net), only if the user enables the setting: sends artist
 *    and title externally. The result is cached to disk to avoid re-fetching.
 */
// Not the global `fetch`: it never resolves in the background. See the note
// in `src/api/subsonic.ts`.
import { fetch } from 'expo/fetch';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

import { type Song, type SongLyrics } from '@/api/subsonic';
import { hashKey, readTags } from './localLibrary';
import { parseLrc } from './lrc';
import { parseTtml } from './ttml';
import { isManualOffline } from '@/api/netGate';
import { PROJECT_NAME, REPOSITORY_URL } from './project';
import { delay } from '../../modules/background-downloads';
import { createLyricsProviderRequest } from './lyricsProviderRequest';
import type { LyricCandidate } from './lyricDocuments';

const LRCLIB_CACHE_DIR = FileSystem.documentDirectory + 'lyrics-cache/';
/** Who is asking, for LRCLIB. Sent as both headers: see `fetchLrclib`. */
const CLIENT_UA = `${PROJECT_NAME} v${Constants.expoConfig?.version ?? '0.0.0'} (${REPOSITORY_URL})`;
// Server lyrics may run in parallel; the public fallback has its own single
// queue, pacing and Retry-After handling, including response-body reads.
const { requestJson: requestLrclib } = createLyricsProviderRequest({ fetch, wait: delay });
const AUDIO_EXT_RE = /\.[a-z0-9]{1,5}$/i;

/** URI of a sibling file next to an audio file (works for `file://` and SAF). */
function siblingUri(audioUri: string, ext: string): string | null {
  if (!AUDIO_EXT_RE.test(audioUri)) return null;
  return audioUri.replace(AUDIO_EXT_RE, ext);
}

/** URI of the sibling `.lrc` next to an audio file. */
export function siblingLrcUri(audioUri: string): string | null {
  return siblingUri(audioUri, '.lrc');
}

/** Reads a text file; null if it doesn't exist or can't be read. */
async function readTextIfExists(uri: string, bounded = false): Promise<string | null> {
  try {
    if (bounded) {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory || typeof info.size !== 'number' || info.size > 1_000_000) return null;
    }
    const text = await FileSystem.readAsStringAsync(uri);
    return text.trim() && (!bounded || text.length <= 1_000_000) ? text : null;
  } catch {
    return null;
  }
}

/** Reads on-device lyrics only: sibling `.ttml`, `.lrc`, then embedded USLT. */
async function getFileLyrics(song: Song): Promise<SongLyrics | null> {
  const uri = song.localUri;
  if (!uri) return null;
  // 1) .ttml next to the audio file, ahead of the .lrc: with both there, it is
  // the one timed word by word (#165).
  const ttmlUri = siblingUri(uri, '.ttml');
  const ttmlText = ttmlUri ? await readTextIfExists(ttmlUri) : null;
  const fromTtml = ttmlText ? parseTtml(ttmlText) : null;
  if (fromTtml) return fromTtml;

  // 2) .lrc next to the audio file.
  const lrcUri = siblingLrcUri(uri);
  const lrcText = lrcUri ? await readTextIfExists(lrcUri) : null;
  const fromFile = lrcText ? parseLrc(lrcText) : null;
  if (fromFile) return fromFile;

  // 3) Embedded USLT (may contain LRC-style timestamps inside).
  const tags = await readTags(uri);
  return tags?.lyrics ? parseLrc(tags.lyrics) : null;
}

/** The source picker reads the three real file sources separately, not just
 * the first match. The normal playback path above keeps its early return. */
export async function getOnDeviceLyricCandidates(song: Song, current = () => true): Promise<LyricCandidate[]> {
  if (!song.localUri) return [];
  const candidates: LyricCandidate[] = [];
  for (const [ext, kind, parse] of [['.ttml', 'sidecar-ttml', parseTtml], ['.lrc', 'sidecar-lrc', parseLrc]] as const) {
    const uri = siblingUri(song.localUri, ext);
    const text = uri ? await readTextIfExists(uri, true) : null;
    if (!current()) throw new Error('Lyrics request stopped');
    const lyrics = text ? parse(text) : null;
    if (lyrics) candidates.push({ id: kind, kind, lyrics });
  }
  const tags = await readTags(song.localUri);
  if (!current()) throw new Error('Lyrics request stopped');
  const embedded = tags?.lyrics ? parseLrc(tags.lyrics) : null;
  if (embedded) candidates.push({ id: 'embedded', kind: 'embedded', lyrics: embedded });
  return candidates;
}

/** Explicit source-picker search. Uses the same paced provider request queue
 * as background caching, honours manual offline and has a strict result cap. */
export async function findLrclibCandidates(song: Song, options: { stillCurrent: () => boolean; signal?: AbortSignal }): Promise<LyricCandidate[]> {
  const check = () => { if (!options.stillCurrent() || options.signal?.aborted) throw new Error('Lyrics request stopped'); };
  check();
  if (isManualOffline()) throw new Error('Offline mode');
  if (!song.title || !song.artist) return [];
  const params = new URLSearchParams({ artist_name: song.artist, track_name: song.title });
  const response = await requestLrclib(`https://lrclib.net/api/search?${params}`, {
    headers: { 'Lrclib-Client': CLIENT_UA, 'User-Agent': CLIENT_UA }, ...options,
  });
  check();
  if (!response.ok || !Array.isArray(response.data)) throw new Error('Lyrics provider failed');
  const results = (response.data as (LrclibResult & { id?: number; trackName?: string; artistName?: string; albumName?: string; duration?: number })[])
    .slice(0, 40).sort((left, right) => Math.abs((left.duration ?? 0) - (song.duration ?? 0)) - Math.abs((right.duration ?? 0) - (song.duration ?? 0)));
  const candidates: LyricCandidate[] = [];
  for (const record of results) {
    const text = pickLrclibText(record), lyrics = text ? parseLrc(text) : null;
    if (!lyrics || !Number.isSafeInteger(record.id) || record.id! < 0) continue;
    const label = [record.trackName, record.artistName, record.albumName,
      typeof record.duration === 'number' && Number.isFinite(record.duration) ? `${Math.round(record.duration)} s` : undefined]
      .filter(Boolean).join(' · ').slice(0, 300);
    candidates.push({ id: `lrclib:${record.id}`, kind: 'lrclib', label, lyrics });
    if (candidates.length === 10) break;
  }
  return candidates;
}

/**
 * Local/offline lyrics. Normally on-device first with LRCLIB as fallback; with
 * `preferOnline` the order flips (LRCLIB first, on-device as fallback). LRCLIB
 * is only used when `allowOnline` is set.
 */
export async function getLocalLyrics(
  song: Song,
  allowOnline: boolean,
  preferOnline = false,
): Promise<SongLyrics | null> {
  if (allowOnline && preferOnline) {
    return (await getOnlineLyrics(song)) ?? (await getFileLyrics(song));
  }
  const fromFile = await getFileLyrics(song);
  if (fromFile) return fromFile;
  if (allowOnline) return getOnlineLyrics(song);
  return null;
}

/**
 * Lyrics from LRCLIB with disk cache. Also serves as last resort for server
 * songs whose server doesn't have lyrics.
 */
export async function getOnlineLyrics(song: Song, options: { strict?: boolean; stillCurrent?: () => boolean } = {}): Promise<SongLyrics | null> {
  // IDs can repeat on different servers. A complete recording signature keeps
  // one account's LRCLIB result from being served for another account's song.
  const file = `${LRCLIB_CACHE_DIR}v2_${hashKey(JSON.stringify([song.id, song.artist, song.title, song.album, song.duration]))}.lrc`;
  const cached = await readTextIfExists(file);
  if (options.stillCurrent && !options.stillCurrent()) throw new Error('Lyrics request stopped');
  if (cached) return parseLrc(cached);
  const text = await fetchLrclib(song, options);
  if (!text) return null;
  if (options.stillCurrent && !options.stillCurrent()) throw new Error('Lyrics request stopped');
  await FileSystem.makeDirectoryAsync(LRCLIB_CACHE_DIR, { intermediates: true }).catch(() => {});
  // Directory preparation can outlive a pause/profile change. Do not publish
  // the fallback file for a request whose batch no longer owns it.
  if (options.stillCurrent && !options.stillCurrent()) throw new Error('Lyrics request stopped');
  try {
    await FileSystem.writeAsStringAsync(file, text);
  } catch {
    // Without cache we still work; it would just repeat the request.
  }
  return parseLrc(text);
}

interface LrclibResult {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  lyricsfile?: string | null;
}

function pickLrclibText(r: LrclibResult | undefined): string | null {
  if (!r || r.instrumental) return null;
  const text = r.syncedLyrics?.trim() || r.plainLyrics?.trim();
  if (text) return text;
  // Do not turn a provider format we cannot read into "no lyrics". A strict
  // batch keeps it failed/retryable rather than saving a false missing marker.
  if (r.lyricsfile?.trim()) throw new Error('Lyrics provider format is not supported');
  return null;
}

/** Searches LRCLIB for lyrics by artist+title. Returns LRC/plain text. */
/** Only in development: where a lyrics lookup went, since it never throws. */
function trace(what: string, song: Song): void {
  if (__DEV__) console.log(`[lyrics] lrclib · ${what} · ${song.artist} — ${song.title}`);
}

async function fetchLrclib(song: Song, options: { strict?: boolean; stillCurrent?: () => boolean; signal?: AbortSignal } = {}): Promise<string | null> {
  const check = () => { if (options.stillCurrent && !options.stillCurrent()) throw new Error('Lyrics request stopped'); };
  if (!song.title || !song.artist) {
    trace('not asked: the song has no artist or no title', song);
    return null;
  }
  // LRCLIB is somebody else's server, but it is reached the same way and costs
  // the same data, so an offline somebody asked for covers it too: the .lrc
  // cached next to a download is read before this is ever called.
  //
  // An offline the app fell into is a different thing. It means one server
  // stopped answering, not that the phone has no connection, and taking the
  // lyrics away too made the app look broken to whoever never noticed the
  // mode had changed.
  if (isManualOffline()) {
    trace('not asked: offline was chosen', song);
    return null;
  }
  // The User-Agent is not politeness, it is the request working at all. React
  // Native sends okhttp's own on Android, and LRCLIB answers that with a 520
  // from Cloudflare: every lookup failed, silently, on every Android phone.
  // Anything that identifies the client is accepted, and identifying it is
  // what their API asks for anyway.
  const headers = {
    'Lrclib-Client': CLIENT_UA,
    'User-Agent': CLIENT_UA,
  };
  try {
    check();
    // Exact metadata lookup accepts an optional album/duration. Never send an
    // out-of-range duration (long ASMR files can exceed the provider's 1h cap).
    if (song.album || song.duration) {
      const params = new URLSearchParams({
        artist_name: song.artist,
        track_name: song.title,
      });
      if (song.album) params.set('album_name', song.album);
      const duration = typeof song.duration === 'number' ? Math.round(song.duration) : Number.NaN;
      if (Number.isFinite(duration) && duration >= 1 && duration <= 3600) params.set('duration', String(duration));
      const res = await requestLrclib(`https://lrclib.net/api/get?${params}`, { headers, ...options });
      trace(`get ${res.status}`, song);
      if (res.ok) {
        const record = res.data as LrclibResult;
        // An exact instrumental match is a complete answer. Searching again
        // could turn that confirmed result into an unrelated overload failure.
        if (record.instrumental === true) return null;
        const text = pickLrclibText(record);
        if (text) return text;
      }
      else if (options.strict && res.status !== 404) throw new Error('Lyrics provider failed');
    }
    check();
    const params = new URLSearchParams({ artist_name: song.artist, track_name: song.title });
    const res = await requestLrclib(`https://lrclib.net/api/search?${params}`, { headers, ...options });
    trace(`search ${res.status}`, song);
    if (!res.ok) { if (options.strict) throw new Error('Lyrics provider failed'); return null; }
    if (!Array.isArray(res.data)) throw new Error('Unexpected lyrics provider response');
    const results = res.data as LrclibResult[];
    for (const r of results) {
      const text = pickLrclibText(r);
      if (text) return text;
    }
    trace(`search matched nothing (${results.length} results)`, song);
    return null;
  } catch (e) {
    if (options.strict) throw e;
    // No network or the API down: simply no lyrics. Said out loud in
    // development, because a feature that fails in silence cannot be told
    // apart from one that was never asked.
    trace(`failed: ${e instanceof Error ? e.message : String(e)}`, song);
    return null;
  }
}
