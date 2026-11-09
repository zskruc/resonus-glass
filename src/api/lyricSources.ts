import * as Backend from './backend';
import type { Song } from './subsonic';
import { hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { cachedLyricCandidates, saveLyricCandidate } from '@/lib/lyricLibraryDb';
import { getOnDeviceLyricCandidates, findLrclibCandidates } from '@/lib/localLyrics';
import { isManualOffline } from './netGate';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { activeServerDir } from '@/store/downloads';
import { songsByIds } from '@/lib/downloadsDb';
import { cachedUri } from '@/store/songCache';
import { ownedLyricAudioUri } from '@/lib/lyricAudioUri';
import type { LyricCandidate } from '@/lib/lyricDocuments';
import { sourceSong } from '@/lib/sourceSongMetadata';

/** Opening the picker only reads local data. Network work requires its buttons. */
export async function getLyricCandidates(song: Song, profile: string, options: {
  server?: boolean; provider?: boolean; signal?: AbortSignal; current?: () => boolean;
} = {}): Promise<LyricCandidate[]> {
  song = sourceSong(song);
  const owns = captureLyricOwner(profile), owner = useAuthStore.getState().auth;
  const current = () => owns() && !options.signal?.aborted && (!options.current || options.current());
  const check = () => { if (!current()) throw new Error('Lyrics profile changed'); };
  check();
  const scope = hashKey(profile), found = new Map<string, LyricCandidate>();
  for (const entry of await cachedLyricCandidates(scope, song, current)) found.set(entry.id, entry);
  check();
  const dir = activeServerDir();
  const downloaded = dir ? (await songsByIds(dir, [song.id])).get(song.id)?.localUri : undefined;
  check();
  const uri = song.localUri ?? ownedLyricAudioUri(scope, downloaded, cachedUri(song.id));
  for (const entry of await getOnDeviceLyricCandidates({ ...song, ...(uri ? { localUri: uri } : {}) }, current)) {
    check(); await saveLyricCandidate(scope, song, entry, current); found.set(entry.id, entry);
  }
  check();
  if (options.server || options.provider) {
    if (isManualOffline()) throw new Error('Offline mode');
    if (options.server && owner && !useAuthStore.getState().offline && !song.url) {
      let lyrics;
      try { lyrics = await Backend.getLyricsBySongId(owner, song.id); }
      catch (error) {
        check();
        if (!(error instanceof Backend.SubsonicRequestError) || error.network || error.code !== 0) throw error;
        const text = await Backend.getLyrics(owner, song.artist ?? '', song.title);
        lyrics = text.trim() ? { synced: false, lines: text.split('\n').map((value) => ({ value })) } : null;
      }
      check();
      if (lyrics) {
        const entry: LyricCandidate = { id: 'server', kind: 'server', lyrics };
        await saveLyricCandidate(scope, song, entry, current); found.set(entry.id, entry);
      }
    }
    if (options.provider) for (const entry of await findLrclibCandidates(song, { signal: options.signal, stillCurrent: current })) {
      check(); await saveLyricCandidate(scope, song, entry, current); found.set(entry.id, entry);
    }
  }
  check();
  // Automatic is a mode, not another row indistinguishable from real sources.
  return Array.from(found.values()).slice(0, 24);
}

export function lyricSourcesAreCurrent(profile: string): boolean { return profileScopeId() === profile; }
