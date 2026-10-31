import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import type { ArtistInfo, SongLyrics, SubsonicAuth } from '@/api/subsonic';
import type { ArtistDetail } from './mirrorDb';
import { hashKey } from './localLibrary';
import { primaryUrl } from './serverUrls';
import { MEDIA_CACHE_KINDS, emptyMediaCacheStats, newMediaCacheJob,
  type MediaCacheJob, type MediaCacheKind, type MediaCacheOutcome, type MediaCacheStats, type MediaCacheTask } from './mediaCacheTypes';

const DIR = FileSystem.documentDirectory + 'library-mirror/';
const handles = new Map<string, Promise<SQLite.SQLiteDatabase>>();
const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA journal_size_limit=524288;
CREATE TABLE IF NOT EXISTS cache_job (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cache_tasks (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(kind,id));
CREATE INDEX IF NOT EXISTS cache_tasks_pending ON cache_tasks(result,kind);
CREATE TABLE IF NOT EXISTS saved_lyrics (id TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(id,source));
CREATE TABLE IF NOT EXISTS saved_artists (id TEXT PRIMARY KEY, detail TEXT, info TEXT, cover_key TEXT,
  hero_uri TEXT, detail_at INTEGER, info_at INTEGER);
`;
export function mediaCacheProfile(auth: SubsonicAuth): string { return hashKey(`${primaryUrl(auth)}|${auth.username}`); }
export async function closeMediaCacheFor(profile: string): Promise<void> {
  const pending = handles.get(profile);
  if (!pending) return;
  handles.delete(profile);
  await (await pending).closeAsync().catch(() => {});
}
export async function mediaCacheBytes(profile: string): Promise<number> {
  // Do not open/create a new database just to count its existing disk files.
  const sizes = await Promise.all(['', '-wal', '-shm'].map(async (suffix) => {
    const info = await FileSystem.getInfoAsync(`${DIR}media-cache-${profile}.db${suffix}`).catch(() => undefined);
    return info?.exists ? info.size ?? 0 : 0;
  }));
  return sizes.reduce((sum, size) => sum + size, 0);
}
async function db(profile: string): Promise<SQLite.SQLiteDatabase> {
  if (!/^[\da-z_-]+$/i.test(profile)) throw new Error('Invalid cache profile');
  const old = handles.get(profile); if (old) return old;
  const pending = (async () => {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    const value = await SQLite.openDatabaseAsync(`media-cache-${profile}.db`, {}, DIR.replace(/^file:\/\//, ''));
    await value.execAsync(SCHEMA); return value;
  })().catch((error) => { if (handles.get(profile) === pending) handles.delete(profile); throw error; });
  handles.set(profile, pending); return pending;
}
export async function readMediaCacheJob(profile: string): Promise<MediaCacheJob> {
  const value = await db(profile);
  const row = await value.getFirstAsync<{ data: string }>('SELECT data FROM cache_job WHERE id=1');
  if (!row) return newMediaCacheJob();
  try {
    const job = JSON.parse(row.data) as MediaCacheJob;
    if (!Array.isArray(job.selected) || !job.selected.every((kind) => MEDIA_CACHE_KINDS.includes(kind))
      || !MEDIA_CACHE_KINDS.every((kind) => Number.isInteger(job.cursors?.[kind]?.offset))) return newMediaCacheJob();
    // A killed process never silently restarts a transfer after launching again.
    if (job.status === 'running' || job.status === 'discovering') { job.status = 'paused'; job.reason = 'user'; }
    return job;
  } catch { return newMediaCacheJob(); }
}
export async function saveMediaCacheJob(profile: string, job: MediaCacheJob): Promise<void> {
  const value = await db(profile);
  await value.runAsync('INSERT OR REPLACE INTO cache_job(id,data) VALUES(1,?)', JSON.stringify(job));
}
export async function resetMediaCacheTasks(profile: string): Promise<void> {
  const value = await db(profile); await value.runAsync('DELETE FROM cache_tasks');
}
/** Cursor and task reset commit together, including when a scan is cancelled
 * during disk preparation or the process is killed before discovery starts. */
export async function beginMediaCacheJob(profile: string, job: MediaCacheJob): Promise<void> {
  const value = await db(profile);
  const saved = JSON.stringify(job);
  await value.withTransactionAsync(async () => {
    await value.runAsync('DELETE FROM cache_tasks');
    await value.runAsync('INSERT OR REPLACE INTO cache_job(id,data) VALUES(1,?)', saved);
  });
}
export async function addMediaCacheTasks(profile: string, tasks: MediaCacheTask[]): Promise<number> {
  const value = await db(profile); let added = 0;
  await value.withTransactionAsync(async () => {
    for (const task of tasks) {
      const result = await value.runAsync('INSERT OR IGNORE INTO cache_tasks(kind,id,data,result) VALUES(?,?,?,\'pending\')',
        task.kind, task.id, JSON.stringify(task.data));
      added += result.changes;
    }
  });
  return added;
}
export async function nextMediaCacheTask(profile: string, selected: MediaCacheKind[]): Promise<MediaCacheTask | undefined> {
  if (!selected.length) return undefined;
  const value = await db(profile);
  const row = await value.getFirstAsync<{ kind: MediaCacheKind; id: string; data: string }>(
    `SELECT kind,id,data FROM cache_tasks WHERE result='pending' AND kind IN (${selected.map(() => '?').join(',')}) ORDER BY rowid LIMIT 1`, selected);
  return row ? { kind: row.kind, id: row.id, data: JSON.parse(row.data) } : undefined;
}
export async function finishMediaCacheTask(profile: string, task: MediaCacheTask, outcome: MediaCacheOutcome): Promise<void> {
  const value = await db(profile); await value.runAsync('UPDATE cache_tasks SET result=? WHERE kind=? AND id=?', outcome, task.kind, task.id);
}
export async function retryMediaCacheFailures(profile: string): Promise<void> {
  const value = await db(profile); await value.runAsync("UPDATE cache_tasks SET result='pending' WHERE result='failed'");
}
export async function mediaCacheStats(profile: string): Promise<MediaCacheStats> {
  const value = await db(profile);
  const rows = await value.getAllAsync<{ kind: MediaCacheKind; result: MediaCacheOutcome | 'pending'; count: number }>(
    'SELECT kind,result,COUNT(*) AS count FROM cache_tasks GROUP BY kind,result');
  const stats = emptyMediaCacheStats();
  for (const row of rows) if (stats[row.kind]) { stats[row.kind].total += row.count; stats[row.kind][row.result] += row.count; }
  return stats;
}
export async function readSavedLyrics(profile: string, id: string, source: string): Promise<SongLyrics | undefined> {
  const value = await db(profile);
  const row = await value.getFirstAsync<{ data: string }>('SELECT data FROM saved_lyrics WHERE id=? AND source=?', id, source);
  if (!row) return undefined;
  try { const data = JSON.parse(row.data) as SongLyrics; return Array.isArray(data.lines) && data.lines.length ? data : undefined; }
  catch { return undefined; }
}
export async function saveLyrics(profile: string, id: string, source: string, lyrics: SongLyrics, stillCurrent?: () => boolean): Promise<void> {
  const value = await db(profile);
  if (stillCurrent && !stillCurrent()) throw new Error('Media cache owner changed');
  await value.runAsync('INSERT OR REPLACE INTO saved_lyrics(id,source,data,updated_at) VALUES(?,?,?,?)', id, source, JSON.stringify(lyrics), Date.now());
}
export async function lyricsCacheState(profile: string, id: string, source: string): Promise<'cached' | 'missing' | undefined> {
  const value = await db(profile);
  const row = await value.getFirstAsync<{ data: string; updated_at: number }>('SELECT data,updated_at FROM saved_lyrics WHERE id=? AND source=?', id, source);
  if (!row) return undefined;
  if (row.data === 'null') return Date.now() - row.updated_at < 86_400_000 ? 'missing' : undefined;
  try { return JSON.parse(row.data)?.lines?.length ? 'cached' : undefined; } catch { return undefined; }
}
export async function saveMissingLyrics(profile: string, id: string, source: string, stillCurrent?: () => boolean): Promise<void> {
  const value = await db(profile);
  if (stillCurrent && !stillCurrent()) throw new Error('Media cache owner changed');
  await value.runAsync("INSERT OR REPLACE INTO saved_lyrics(id,source,data,updated_at) VALUES(?,?,'null',?)", id, source, Date.now());
}
export interface SavedArtist {
  detail?: ArtistDetail; info?: ArtistInfo; coverKey?: string; heroUri?: string; detailAt: number; infoAt: number;
}
export async function readSavedArtist(profile: string, id: string): Promise<SavedArtist | undefined> {
  const value = await db(profile);
  const row = await value.getFirstAsync<{ detail: string | null; info: string | null; cover_key: string | null;
    hero_uri: string | null; detail_at: number | null; info_at: number | null }>('SELECT * FROM saved_artists WHERE id=?', id);
  if (!row) return undefined;
  try { return { detail: row.detail ? JSON.parse(row.detail) : undefined, info: row.info ? JSON.parse(row.info) : undefined,
    coverKey: row.cover_key ?? undefined, heroUri: row.hero_uri ?? undefined, detailAt: row.detail_at ?? 0, infoAt: row.info_at ?? 0 }; }
  catch { return undefined; }
}
export async function saveArtistDetail(profile: string, id: string, detail: ArtistDetail, stillCurrent?: () => boolean): Promise<void> {
  const value = await db(profile);
  if (stillCurrent && !stillCurrent()) throw new Error('Media cache owner changed');
  // A changed artwork hash invalidates only its old local hero, never another
  // profile's record. The original signed/public image URI stays in info.
  await value.runAsync(`INSERT INTO saved_artists(id,detail,cover_key,detail_at) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET detail=excluded.detail,detail_at=excluded.detail_at,
    hero_uri=CASE WHEN cover_key IS excluded.cover_key THEN hero_uri ELSE NULL END,cover_key=excluded.cover_key`,
  id, JSON.stringify(detail), detail.artist.coverArt ?? '', Date.now());
}
export async function saveArtistInfo(profile: string, id: string, info: ArtistInfo, heroUri?: string, stillCurrent?: () => boolean): Promise<void> {
  const value = await db(profile);
  if (stillCurrent && !stillCurrent()) throw new Error('Media cache owner changed');
  await value.runAsync(`INSERT INTO saved_artists(id,info,info_at,hero_uri) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET info=excluded.info,info_at=excluded.info_at,
    hero_uri=COALESCE(excluded.hero_uri,hero_uri)`, id, JSON.stringify(info), Date.now(), heroUri ?? null);
}
