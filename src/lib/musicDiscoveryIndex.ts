/** Persistent metadata-only discovery index. Inspired by Primuse's indexed pinyin search.
 * Explicit rebuilds page the catalogue; search and intentions never scan audio or artwork. */
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { pinyin } from 'pinyin-pro';
import type { Song, SearchResult, Album, Artist } from '@/api/subsonic';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLibraries } from '@/store/libraries';
import { hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { ownedPlayCounts } from '@/store/playCounts';
import { getCatalogSongPage } from '@/api/data';
export interface MusicIndexIdentity { profile: string; source: string }
export interface MusicIndexStatus { count: number; updatedAt: number }
export const LISTENING_INTENTS = [
  { key: 'focus', label: 'Focus', explanation: 'Ambient, classical and instrumental genre tags, or a moderate tagged tempo.', hours: [8, 18] },
  { key: 'calm', label: 'Unwind', explanation: 'Acoustic and ambient genre tags, or a slower tagged tempo.', hours: [18, 24] },
  { key: 'energy', label: 'More energy', explanation: 'Dance, electronic and rock genre tags, or a faster tagged tempo.', hours: [6, 19] },
  { key: 'short', label: 'A short break', explanation: 'Tracks up to four minutes, based on their actual duration.', hours: [8, 22] },
  { key: 'long', label: 'Long listening', explanation: 'Tracks at least ten minutes long.', hours: [18, 24] },
  { key: 'nineties', label: 'Back to the nineties', explanation: 'Release years from 1990 to 1999.', hours: [0, 24] },
  { key: 'unplayed', label: 'Still unheard', explanation: 'Tracks without a reported play count.', hours: [0, 24] },
  { key: 'rediscover', label: 'Hear it again', explanation: 'Previously played tracks, ordered by the fewest reported plays.', hours: [0, 24] },
  { key: 'favorites', label: 'Familiar favourites', explanation: 'Tracks marked as favourites in the indexed library.', hours: [0, 24] },
] as const;
export type ListeningIntentKey = typeof LISTENING_INTENTS[number]['key'];
export const foldMusicText = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function musicSearchFields(song: Song) {
  const original = [song.title, song.artist, song.album, ...(song.artists ?? []).map((x) => x.name)].filter(Boolean).join(' ');
  const full = /\p{Script=Han}/u.test(original) ? pinyin(original, { toneType: 'none', type: 'array', nonZh: 'consecutive' }) : [];
  const path = [(song as Song & { path?: string }).path, song.localUri].filter((x): x is string => typeof x === 'string').join(' ');
  return { original: foldMusicText(original), roman: foldMusicText(full.join(' ')), compact: foldMusicText(full.join('')),
    initials: foldMusicText(full.map((s) => /\p{Script=Han}/u.test(s) ? s : s[0] ?? '').join('')), path: foldMusicText(path) };
}
export function musicIndexIdentity(): MusicIndexIdentity {
  const auth = useAuthStore.getState();
  return { profile: profileScopeId(), source: hashKey(JSON.stringify([auth.offline, auth.offlineSource, useLibraries.getState().disabled])) };
}
const sameIdentity = (identity: MusicIndexIdentity) => { const active = musicIndexIdentity(); return active.profile === identity.profile && active.source === identity.source; };
interface IndexConnection { promise: Promise<SQLite.SQLiteDatabase>; active: number; touched: number }
const open = new Map<string, IndexConnection>();
function evictIdle() {
  if (open.size <= 3) return;
  for (const [key, entry] of [...open].filter(([, value]) => value.active === 0).sort((a, b) => a[1].touched - b[1].touched)) {
    if (open.size <= 3) break; open.delete(key); void entry.promise.then((handle) => handle.closeAsync()).catch(() => {});
  }
}
const ROOT = `${FileSystem.cacheDirectory}music-discovery-v1/`;
const retired = new Map<string, { accounts: WeakSet<object>; noAuth: boolean }>();
const retiredCurrent = (identity: MusicIndexIdentity) => { const auth = useAuthStore.getState().auth, state = retired.get(identity.profile); return auth ? state?.accounts.has(auth) === true : state?.noAuth === true; };
async function db(identity: MusicIndexIdentity) {
  if (!sameIdentity(identity) || retiredCurrent(identity)) throw new Error('Music source changed');
  const key = `${hashKey(identity.profile)}-${identity.source}`;
  let connection = open.get(key);
  if (!connection) {
    const promise = (async () => { await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
      const handle = await SQLite.openDatabaseAsync(`${key}.db`, {}, ROOT.replace(/^file:\/\//, ''));
      await handle.execAsync(`PRAGMA journal_mode=WAL; PRAGMA journal_size_limit=524288;
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), generation TEXT, count INTEGER, updated INTEGER);
        CREATE TABLE IF NOT EXISTS tracks (generation TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,original TEXT,roman TEXT,compact TEXT,initials TEXT,path TEXT,genre TEXT,bpm REAL,duration REAL,year INTEGER,plays INTEGER,favourite INTEGER,PRIMARY KEY(generation,id));
        CREATE INDEX IF NOT EXISTS tracks_gen ON tracks(generation);`);
      return handle;
    })();
    connection = { promise, active: 0, touched: Date.now() }; open.set(key, connection);
    const created = connection; void promise.catch(() => { if (open.get(key) === created) open.delete(key); });
  }
  const entry = connection; entry.active++; entry.touched = Date.now(); let released = false;
  const release = () => { if (released) return; released = true; entry.active--; entry.touched = Date.now(); evictIdle(); };
  try { return { handle: await entry.promise, release }; } catch (error) { release(); throw error; }
}
export async function musicIndexStatus(identity = musicIndexIdentity()): Promise<MusicIndexStatus> {
  const owns = captureLyricOwner(identity.profile), lease = await db(identity), handle = lease.handle;
  try { const state = await handle.getFirstAsync<{ count: number; updated: number }>('SELECT count,updated FROM state WHERE id=1');
  if (!owns() || !sameIdentity(identity)) throw new Error('Music source changed');
  return { count: state?.count ?? 0, updatedAt: state?.updated ?? 0 };
  } finally { lease.release(); }
}
let buildSequence = 0;
const builds = new Map<string, number>();
export async function rebuildMusicIndex(identity = musicIndexIdentity(), signal?: AbortSignal, progress?: (count: number) => void) {
  const owns = captureLyricOwner(identity.profile), key = `${identity.profile}|${identity.source}`, sequence = ++buildSequence;
  builds.set(key, sequence);
  const current = () => !signal?.aborted && owns() && sameIdentity(identity) && builds.get(key) === sequence && !retiredCurrent(identity);
  if (!current()) throw new Error('Music index cancelled');
  const lease = await db(identity), handle = lease.handle, generation = `${Date.now()}-${sequence}`;
  let count = 0;
  const counts = ownedPlayCounts();
  try {
    let sources = 1, expectedSources: number | undefined;
    const globalIds = new Set<string>();
    for (let source = 0; source < sources; source++) {
      let offset = 0; const seen = new Set<string>();
      while (true) {
        if (!current()) throw new Error('Music index cancelled');
        const result = await getCatalogSongPage(200, offset, source);
        if (!current()) throw new Error('Music index cancelled');
        if (!Number.isInteger(result.sourceCount) || result.sourceCount < 1 || result.sourceCount > 1000 || expectedSources !== undefined && expectedSources !== result.sourceCount) throw new Error('Catalogue sources changed');
        sources = expectedSources = result.sourceCount;
        if (!result.songs.length) break;
        const fresh = result.songs.filter((song) => { if (!song.id || seen.has(song.id)) return false; seen.add(song.id); return true; });
        if (!fresh.length) throw new Error('The server repeated a catalogue page');
        for (let offset = 0; offset < fresh.length; offset += 40) {
          await handle.withExclusiveTransactionAsync(async (tx) => {
            for (const input of fresh.slice(offset, offset + 40)) {
              if (!current()) throw new Error('Music index cancelled');
              const { coverBase64: _, coverMime: __, ...song } = input;
              const fields = musicSearchFields(song);
              await tx.runAsync('INSERT OR REPLACE INTO tracks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [generation, song.id, JSON.stringify(song), fields.original, fields.roman, fields.compact, fields.initials, fields.path,
                foldMusicText([song.genre, ...(song.genres ?? []).map((x) => x.name)].filter(Boolean).join(' ')), song.bpm ?? 0, song.duration ?? 0, song.year ?? 0, Math.max(song.playCount ?? 0, counts[song.id] ?? 0), song.starred ? 1 : 0]);
              globalIds.add(song.id); count = globalIds.size;
            }
          });
          progress?.(count); await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        offset += result.songs.length;
        if (count > 250000 || offset > 500000) throw new Error('Catalogue is too large');
      }
    }
    if (!current()) throw new Error('Music index cancelled');
    await handle.withExclusiveTransactionAsync(async (tx) => {
      if (!current()) throw new Error('Music index cancelled');
      await tx.runAsync('INSERT OR REPLACE INTO state VALUES(1,?,?,?)', [generation, count, Date.now()]);
      await tx.runAsync('DELETE FROM tracks WHERE generation<>?', generation);
    });
    return count;
  } catch (error) { await handle.runAsync('DELETE FROM tracks WHERE generation=? AND generation<>COALESCE((SELECT generation FROM state WHERE id=1),\'\')', generation); throw error; }
  finally { lease.release(); if (builds.get(key) === sequence) builds.delete(key); }
}
const like = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
function indexedResults(songs: Song[]): SearchResult {
  const albums = new Map<string, Album>(), artists = new Map<string, Artist>();
  for (const song of songs) {
    if (song.albumId && song.album && !albums.has(song.albumId)) albums.set(song.albumId, { id: song.albumId, name: song.album, artist: song.artist, coverArt: song.coverArt, year: song.year });
    const credits = song.artists?.length ? song.artists : song.artistId && song.artist ? [{ id: song.artistId, name: song.artist }] : [];
    for (const artist of credits) if (!artists.has(artist.id)) artists.set(artist.id, artist);
  }
  return { songs: songs.slice(0, 100), albums: [...albums.values()].slice(0, 30), artists: [...artists.values()].slice(0, 30) };
}
export async function searchMusicIndex(query: string, identity = musicIndexIdentity(), signal?: AbortSignal): Promise<SearchResult> {
  const owns = captureLyricOwner(identity.profile), current = () => owns() && sameIdentity(identity) && !signal?.aborted;
  if (!current()) throw new Error('Music source changed');
  const text = foldMusicText(query); if (text.length < 2) return { songs: [], albums: [], artists: [] };
  const lease = await db(identity), handle = lease.handle, pattern = like(text), compact = like(text.replace(/\s/g, ''));
  try { const rows = await handle.getAllAsync<{ data: string }>(`SELECT data FROM tracks WHERE generation=(SELECT generation FROM state WHERE id=1)
    AND (original LIKE ? ESCAPE '\\' OR roman LIKE ? ESCAPE '\\' OR compact LIKE ? ESCAPE '\\' OR initials LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')
    ORDER BY CASE WHEN original LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, original,id LIMIT 150`, [pattern, pattern, compact, compact, pattern, pattern]);
  if (!current()) throw new Error('Music source changed');
  return indexedResults(rows.map((row) => JSON.parse(row.data) as Song));
  } finally { lease.release(); }
}
const INTENT_SQL: Record<ListeningIntentKey, string> = {
  focus: "(genre LIKE '%ambient%' OR genre LIKE '%classical%' OR genre LIKE '%instrumental%' OR bpm BETWEEN 85 AND 110)",
  calm: "(genre LIKE '%ambient%' OR genre LIKE '%acoustic%' OR genre LIKE '%chill%' OR bpm BETWEEN 45 AND 85)",
  energy: "(genre LIKE '%dance%' OR genre LIKE '%electronic%' OR genre LIKE '%rock%' OR bpm>=120)",
  short: 'duration>0 AND duration<=240', long: 'duration>=600', nineties: 'year BETWEEN 1990 AND 1999',
  unplayed: 'plays=0', rediscover: 'plays>0', favorites: 'favourite=1',
};
export async function readListeningIntent(intent: ListeningIntentKey, identity = musicIndexIdentity(), signal?: AbortSignal) {
  if (!Object.hasOwn(INTENT_SQL, intent)) return [];
  const owns = captureLyricOwner(identity.profile), lease = await db(identity), handle = lease.handle;
  try { const rows = await handle.getAllAsync<{ data: string }>(`SELECT data FROM tracks WHERE generation=(SELECT generation FROM state WHERE id=1) AND (${INTENT_SQL[intent]}) ORDER BY ${intent === 'rediscover' ? 'plays ASC,' : ''} RANDOM() LIMIT 200`);
  if (!owns() || !sameIdentity(identity) || signal?.aborted) throw new Error('Music source changed');
  return rows.map((row) => JSON.parse(row.data) as Song);
  } finally { lease.release(); }
}

/** Remove only this account's rebuildable cache. Old builders cannot republish after deletion. */
export async function clearMusicDiscoveryProfile(profile: string) {
  const state = retired.get(profile) ?? { accounts: new WeakSet<object>(), noAuth: false };
  const auth = useAuthStore.getState().auth; if (auth) state.accounts.add(auth); else state.noAuth = true; retired.set(profile, state);
  for (const key of builds.keys()) if (key.startsWith(`${profile}|`)) builds.delete(key);
  const prefix = `${hashKey(profile)}-`;
  for (const [key, connection] of open) if (key.startsWith(prefix)) {
    open.delete(key); const handle = await connection.promise.catch(() => undefined); await handle?.closeAsync().catch(() => {});
  }
  const files = await FileSystem.readDirectoryAsync(ROOT).catch(() => []);
  for (const name of files) if (name.startsWith(prefix) && /^[a-z0-9-]+\.db(?:-wal|-shm)?$/i.test(name)) await FileSystem.deleteAsync(`${ROOT}${name}`, { idempotent: true });
}
