import { markUnplayableOffline } from '@/api/data';
import type { Song } from '@/api/subsonic';
import * as DownloadsDb from '@/lib/downloadsDb';
import * as LocalDb from '@/lib/localDb';
import { folderSetKey, localSource } from '@/lib/localLibrary';
import { recommendationSong } from '@/lib/dailyRecommendations';
import { activeServerDir } from '@/store/downloads';
import { useAuthStore } from '@/store/auth';

/** Current SQLite rows offline; credential-free IDs stream using current auth online. */
export async function currentRecommendationSongs(saved: readonly Song[], current: () => boolean): Promise<Map<string, Song>> {
  const state = useAuthStore.getState();
  const check = () => { if (!current() || useAuthStore.getState() !== state) throw new Error('Recommendation profile changed'); };
  check();
  const ids = [...new Set(saved.map((song) => song.id))];
  if (!state.auth) {
    if (!state.offlineSource) return new Map();
    const source = state.offlineSource;
    const path = localSource(source.mode, source.mode === 'folder' ? folderSetKey(source.uris) : undefined);
    const songs = await LocalDb.songsByIds(path, ids); check(); return songs;
  }
  if (state.offline) {
    const dir = activeServerDir();
    if (!dir) return new Map();
    const songs = await DownloadsDb.songsByIds(dir, ids); check();
    return new Map(markUnplayableOffline([...songs.values()]).map((song) => [song.id, song]));
  }
  // These are same-profile catalogue IDs, never saved source URLs or paths.
  // The player builds its stream URL from the currently active account. Do
  // not make playback wait for 24 network metadata reads; if an ID has since
  // been removed, the existing player's normal error handling explains it.
  const output = new Map<string, Song>();
  for (const item of saved) {
    const song = recommendationSong(item);
    if (song) output.set(song.id, song);
  }
  check(); return output;
}
