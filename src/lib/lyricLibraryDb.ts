/** Durable per-profile source choices and incremental, on-device lyric search. */
import type { Song, SongLyrics } from '@/api/subsonic';
import { mediaCacheDatabase } from './mediaCacheDb';
import * as FileSystem from 'expo-file-system/legacy';
import { getSongs } from './mirrorDb';
import { lyricSidecarPage } from './downloadsDb';
import { parseLrc } from './lrc';
import { lyricCatalogSong, lyricIndexText, lyricMatchQuery, lyricRecordingKey, plainLyricText,
  validLyricDocument, type CachedLyricMatch, type LyricCandidate, type LyricCandidateKind } from './lyricDocuments';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lyric_documents(song_id TEXT NOT NULL, recording TEXT NOT NULL, source TEXT NOT NULL,
  kind TEXT NOT NULL, label TEXT, data TEXT NOT NULL, PRIMARY KEY(song_id,recording,source));
CREATE TABLE IF NOT EXISTS lyric_choices(song_id TEXT PRIMARY KEY, recording TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lyric_search_songs(song_id TEXT PRIMARY KEY, recording TEXT NOT NULL, song TEXT NOT NULL, body TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS lyric_search USING fts5(song_id UNINDEXED, tokens, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS lyric_index_migration(id INTEGER PRIMARY KEY CHECK(id=1), cursor INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lyric_download_migration(id INTEGER PRIMARY KEY CHECK(id=1), cursor INTEGER NOT NULL);
`;
// Initialisation is tied to the live database object: removing a profile closes
// it and a newly created database must not reuse the old "ready" promise.
const initialized = new WeakMap<object, Promise<void>>();
const writes = new WeakMap<object, Promise<unknown>>();
async function db(profile: string) {
  const value = await mediaCacheDatabase(profile);
  let ready = initialized.get(value);
  if (!ready) {
    ready = value.execAsync(SCHEMA).catch((error) => { initialized.delete(value); throw error; });
    initialized.set(value, ready);
  }
  await ready; return value;
}
function check(current: () => boolean) { if (!current()) throw new Error('Lyrics profile changed'); }
function serial<T>(value: object, work: () => Promise<T>): Promise<T> {
  const pending = (writes.get(value) ?? Promise.resolve()).catch(() => {}).then(work);
  writes.set(value, pending);
  void pending.finally(() => { if (writes.get(value) === pending) writes.delete(value); }).catch(() => {});
  return pending;
}
export async function saveLyricCandidate(profile: string, song: Song, candidate: LyricCandidate, current = () => true): Promise<void> {
  if (!validLyricDocument(candidate.lyrics)) throw new Error('Invalid lyric document');
  const data = JSON.stringify(candidate.lyrics);
  if (data.length > 1_000_000 || !candidate.id || candidate.id.length > 256) throw new Error('Lyric document too large');
  const value = await db(profile); check(current);
  await serial(value, async () => {
    check(current);
    await value.runAsync('INSERT OR REPLACE INTO lyric_documents(song_id,recording,source,kind,label,data) VALUES(?,?,?,?,?,?)',
      song.id, lyricRecordingKey(song), candidate.id, candidate.kind, candidate.label ?? null, data);
  });
}
export async function cachedLyricCandidates(profile: string, song: Song, current = () => true): Promise<LyricCandidate[]> {
  const value = await db(profile); check(current);
  const rows = await value.getAllAsync<{ source: string; kind: LyricCandidateKind; label: string | null; data: string }>(
    'SELECT source,kind,label,data FROM lyric_documents WHERE song_id=? AND recording=? ORDER BY source LIMIT 24', song.id, lyricRecordingKey(song));
  check(current);
  return rows.flatMap((row) => {
    try { const lyrics: unknown = JSON.parse(row.data); return validLyricDocument(lyrics)
      ? [{ id: row.source, kind: row.kind, ...(row.label ? { label: row.label } : {}), lyrics }] : []; } catch { return []; }
  });
}
export async function chosenLyricSource(profile: string, song: Song, current = () => true): Promise<string | null> {
  const value = await db(profile); check(current);
  const row = await value.getFirstAsync<{ source: string }>('SELECT source FROM lyric_choices WHERE song_id=? AND recording=?', song.id, lyricRecordingKey(song));
  check(current); return row?.source ?? null;
}
export async function selectedLyrics(profile: string, song: Song, current = () => true): Promise<SongLyrics | null> {
  const value = await db(profile); check(current);
  const row = await value.getFirstAsync<{ data: string }>(`SELECT d.data FROM lyric_documents d JOIN lyric_choices c
    ON d.song_id=c.song_id AND d.recording=c.recording AND d.source=c.source WHERE d.song_id=? AND d.recording=?`, song.id, lyricRecordingKey(song));
  check(current);
  try { const lyrics: unknown = row ? JSON.parse(row.data) : null; return validLyricDocument(lyrics) ? lyrics : null; } catch { return null; }
}
async function indexWith(value: Pick<Awaited<ReturnType<typeof db>>, 'runAsync'>, song: Song, lyrics: SongLyrics) {
  const metadata = lyricCatalogSong(song); if (!metadata) return;
  const body = plainLyricText(lyrics, 'both');
  await value.runAsync('INSERT OR REPLACE INTO lyric_search_songs(song_id,recording,song,body) VALUES(?,?,?,?)',
    song.id, lyricRecordingKey(song), JSON.stringify(metadata), body);
  await value.runAsync('DELETE FROM lyric_search WHERE song_id=?', song.id);
  await value.runAsync('INSERT INTO lyric_search(song_id,tokens) VALUES(?,?)', song.id, lyricIndexText(body));
}
export async function indexSongLyrics(profile: string, song: Song, lyrics: SongLyrics, current = () => true): Promise<void> {
  if (!validLyricDocument(lyrics) || JSON.stringify(lyrics).length > 1_000_000) return;
  const value = await db(profile); check(current);
  await serial(value, () => value.withExclusiveTransactionAsync(async (transaction) => { check(current); await indexWith(transaction, song, lyrics); check(current); }));
}
/** Choice + search document commit together. A failed save leaves the old choice. */
export async function selectLyricCandidate(profile: string, song: Song, candidate: LyricCandidate | null, current = () => true): Promise<void> {
  const value = await db(profile); check(current);
  await serial(value, () => value.withExclusiveTransactionAsync(async (transaction) => {
    check(current);
    if (candidate) {
      const saved = await transaction.getFirstAsync<{ data: string }>('SELECT data FROM lyric_documents WHERE song_id=? AND recording=? AND source=?',
        song.id, lyricRecordingKey(song), candidate.id);
      if (!saved || !validLyricDocument(JSON.parse(saved.data))) throw new Error('Lyric source is not cached');
      await transaction.runAsync('INSERT OR REPLACE INTO lyric_choices(song_id,recording,source) VALUES(?,?,?)', song.id, lyricRecordingKey(song), candidate.id);
      await indexWith(transaction, song, JSON.parse(saved.data));
    } else await transaction.runAsync('DELETE FROM lyric_choices WHERE song_id=?', song.id);
    check(current);
  }));
}
/** Backfill old saved lyrics in small pages. Caller yields between pages and
 * may stop on blur/profile change. No file reads or network requests occur. */
export async function indexSavedLyricsPage(profile: string, current = () => true): Promise<boolean> {
  const value = await db(profile); check(current);
  return serial(value, async () => {
    check(current);
    const cursor = (await value.getFirstAsync<{ cursor: number }>('SELECT cursor FROM lyric_index_migration WHERE id=1'))?.cursor ?? 0;
    const rows = await value.getAllAsync<{ rowid: number; id: string; source: string; data: string; task: string | null }>(`SELECT l.rowid,l.id,l.source,l.data,t.data AS task
      FROM saved_lyrics l LEFT JOIN cache_tasks t ON t.kind='lyrics' AND t.id=l.id WHERE l.rowid>? ORDER BY l.rowid LIMIT 20`, cursor);
    check(current);
    const metadata = rows.length ? await getSongs(`${FileSystem.documentDirectory}library-mirror/`, profile, rows.map((row) => row.id)) : new Map<string, Song>();
    check(current);
    await value.withExclusiveTransactionAsync(async (transaction) => {
      for (const row of rows) {
        check(current);
        let lyrics: unknown, song: Song | undefined;
        try {
          lyrics = JSON.parse(row.data);
          const task = row.task ? JSON.parse(row.task) : null;
          song = task?.song ?? metadata.get(row.id);
        } catch { continue; /* A malformed historical document cannot block later rows. */ }
        if (song?.id === row.id && validLyricDocument(lyrics)) {
          const existing = await transaction.getFirstAsync('SELECT 1 FROM lyric_search_songs WHERE song_id=?', row.id);
          if (!existing) await indexWith(transaction, song, lyrics);
        }
      }
      check(current);
      if (rows.length) await transaction.runAsync('INSERT OR REPLACE INTO lyric_index_migration(id,cursor) VALUES(1,?)', rows[rows.length - 1].rowid);
    });
    return rows.length === 20;
  });
}
export async function searchCachedLyrics(profile: string, query: string, current = () => true): Promise<CachedLyricMatch[]> {
  const match = lyricMatchQuery(query); if (!match) return [];
  const value = await db(profile); check(current);
  const rows = await value.getAllAsync<{ song: string; excerpt: string }>(`SELECT s.song,
    substr(s.body,max(1,instr(lower(s.body),lower(?))-60),220) AS excerpt FROM lyric_search f
    JOIN lyric_search_songs s ON s.song_id=f.song_id WHERE lyric_search MATCH ? ORDER BY rank LIMIT 20`, query.trim(), match);
  check(current);
  return rows.flatMap((row) => { try { return [{ song: JSON.parse(row.song) as Song, excerpt: row.excerpt }]; } catch { return []; } });
}

/** Only pre-existing downloaded LRC sidecars need a one-time file upgrade.
 * New downloads index when they finish; each yielded page is at most 20 files. */
export async function indexDownloadedLyricsPage(profile: string, dir: string, current = () => true): Promise<boolean> {
  const value = await db(profile); check(current);
  return serial(value, async () => {
    check(current);
    const cursor = (await value.getFirstAsync<{ cursor: number }>('SELECT cursor FROM lyric_download_migration WHERE id=1'))?.cursor ?? 0;
    const rows = await lyricSidecarPage(dir, cursor); check(current);
    for (const { song } of rows) {
      if (!song) continue;
      const existing = await value.getFirstAsync('SELECT 1 FROM lyric_search_songs WHERE song_id=? AND recording=?', song.id, lyricRecordingKey(song));
      check(current);
      if (existing || !song.localUri || !/\.[a-z0-9]{1,5}$/i.test(song.localUri)) continue;
      const uri = song.localUri.replace(/\.[a-z0-9]{1,5}$/i, '.lrc');
      const info = await FileSystem.getInfoAsync(uri).catch(() => undefined); check(current);
      if (!info?.exists || info.isDirectory || typeof info.size !== 'number' || info.size > 1_000_000) continue;
      const text = await FileSystem.readAsStringAsync(uri).catch(() => null);
      check(current);
      const lyrics = text && text.length <= 1_000_000 ? parseLrc(text) : null;
      if (!lyrics || !validLyricDocument(lyrics)) continue;
      await value.withExclusiveTransactionAsync(async (transaction) => {
        check(current);
        await transaction.runAsync('INSERT OR REPLACE INTO lyric_documents(song_id,recording,source,kind,label,data) VALUES(?,?,?,?,?,?)',
          song.id, lyricRecordingKey(song), 'sidecar-lrc', 'sidecar-lrc', null, JSON.stringify(lyrics));
        await indexWith(transaction, song, lyrics); check(current);
      });
    }
    check(current);
    if (rows.length) await value.runAsync('INSERT OR REPLACE INTO lyric_download_migration(id,cursor) VALUES(1,?)', rows[rows.length - 1].cursor);
    return rows.length === 20;
  });
}
