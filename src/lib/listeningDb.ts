/** Profile-partitioned, batched local listening ledger and saved smart-list rules. */
import * as SQLite from 'expo-sqlite';
import type { Song } from '@/api/subsonic';
import type { ListeningCredit } from './listeningMath';
import { normalizeSmartRule, type SmartRule } from './smartRules';

let opening: Promise<SQLite.SQLiteDatabase> | undefined;
async function database() {
  if (!opening) opening = SQLite.openDatabaseAsync('resonus-music-tools.db').then(async (db) => {
    await db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA journal_size_limit=524288;
      CREATE TABLE IF NOT EXISTS listening_meta(profile TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, started_at INTEGER);
      CREATE TABLE IF NOT EXISTS listening_days(profile TEXT NOT NULL, day TEXT NOT NULL, song_id TEXT NOT NULL, song TEXT NOT NULL, artist TEXT NOT NULL, seconds REAL NOT NULL, plays INTEGER NOT NULL, PRIMARY KEY(profile,day,song_id));
      CREATE TABLE IF NOT EXISTS smart_rules(profile TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(profile,id));`);
    return db;
  }).catch((error) => { opening = undefined; throw error; });
  return opening;
}
let writing: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = writing.catch(() => {}).then(work);
  writing = next;
  return next;
}
function safeSong(song: Song): Song {
  // Never persist playable URLs, local paths, comments, authentication or transient queue flags.
  return { id: song.id, title: song.title, artist: song.artist, album: song.album,
    albumId: song.albumId, artistId: song.artistId, coverArt: song.coverArt && !/:\/\//.test(song.coverArt) ? song.coverArt : undefined,
    duration: song.duration, year: song.year };
}

export async function listeningPreferences(profile: string): Promise<{ enabled: boolean; startedAt?: number }> {
  await writing.catch(() => {});
  const db = await database();
  const result = await db.getFirstAsync<{ enabled: number; started_at: number | null }>('SELECT enabled,started_at FROM listening_meta WHERE profile=?', profile);
  return { enabled: result ? result.enabled === 1 : true, startedAt: result?.started_at ?? undefined };
}
export function setListeningEnabled(profile: string, enabled: boolean): Promise<void> {
  return serialized(async () => {
    const db = await database();
    await db.runAsync('INSERT INTO listening_meta(profile,enabled) VALUES(?,?) ON CONFLICT(profile) DO UPDATE SET enabled=excluded.enabled', profile, enabled ? 1 : 0);
  });
}

const pending = new Map<string, ListeningCredit>();
const profileVersions = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;
let consecutiveFailures = 0;
function addPending(credit: ListeningCredit) {
  const key = JSON.stringify([credit.profile, credit.day, credit.song.id]);
  const old = pending.get(key);
  pending.set(key, old ? { ...credit, seconds: old.seconds + credit.seconds, plays: old.plays + credit.plays, at: Math.min(old.at, credit.at) } : credit);
}
function scheduleFlush() {
  // A persistent storage failure must not start an endless background retry loop.
  // Credits remain pending; a track/pause/manual flush can try again later.
  if (!timer && pending.size && consecutiveFailures < 3) timer = setTimeout(() => { timer = undefined; void flushListeningCredits().catch(() => {}); }, 15_000);
}
export function queueListeningCredit(credit: ListeningCredit) {
  addPending(credit); scheduleFlush();
}
export function flushListeningCredits(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = undefined; }
  const batch = [...pending.values()].map((credit) => ({ credit, version: profileVersions.get(credit.profile) ?? 0 })); pending.clear();
  if (!batch.length) return writing.then(() => {}, () => {});
  return serialized(async () => {
    try {
      const db = await database();
      await db.withTransactionAsync(async () => {
        for (const { credit: row, version } of batch) {
          if ((profileVersions.get(row.profile) ?? 0) !== version) continue;
          await db.runAsync('INSERT INTO listening_meta(profile,enabled,started_at) VALUES(?,1,?) ON CONFLICT(profile) DO UPDATE SET started_at=CASE WHEN started_at IS NULL THEN excluded.started_at ELSE MIN(started_at,excluded.started_at) END', row.profile, row.at);
          await db.runAsync(`INSERT INTO listening_days(profile,day,song_id,song,artist,seconds,plays) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(profile,day,song_id) DO UPDATE SET song=excluded.song,artist=excluded.artist,seconds=seconds+excluded.seconds,plays=plays+excluded.plays`,
          row.profile, row.day, row.song.id, JSON.stringify(safeSong(row.song)), row.song.artist ?? '', row.seconds, row.plays);
        }
      });
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures++;
      for (const { credit, version } of batch) if ((profileVersions.get(credit.profile) ?? 0) === version) addPending(credit);
      scheduleFlush();
      throw error;
    }
  });
}

/** Called with the raw URL|username scope when a saved account is removed. */
export function clearMusicToolsProfile(profile: string): Promise<void> {
  profileVersions.set(profile, (profileVersions.get(profile) ?? 0) + 1);
  const discardPending = () => {
    for (const [key, credit] of pending) if (credit.profile === profile) pending.delete(key);
    if (!pending.size && timer) { clearTimeout(timer); timer = undefined; }
  };
  discardPending();
  return serialized(async () => {
    const db = await database();
    // Existing serialized writes finish before this transaction; their failed
    // batches cannot restore credits after the profile generation was changed.
    discardPending();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM listening_days WHERE profile=?', profile);
      await db.runAsync('DELETE FROM listening_meta WHERE profile=?', profile);
      await db.runAsync('DELETE FROM smart_rules WHERE profile=?', profile);
    });
  });
}

export interface ListeningSummary {
  seconds: number; plays: number; songs: number;
  days: { day: string; seconds: number }[];
  top: { song: Song; seconds: number; plays: number }[];
  artists: { name: string; seconds: number }[];
}
export async function listeningSummary(profile: string, from: string, until: string): Promise<ListeningSummary> {
  await flushListeningCredits();
  return serialized(async () => {
  const db = await database(), args = [profile, from, until];
  const where = 'profile=? AND day>=? AND day<?';
  const total = await db.getFirstAsync<{ seconds: number; plays: number; songs: number }>(`SELECT COALESCE(SUM(seconds),0) seconds,COALESCE(SUM(plays),0) plays,COUNT(DISTINCT song_id) songs FROM listening_days WHERE ${where}`, args);
  const days = await db.getAllAsync<{ day: string; seconds: number }>(`SELECT day,SUM(seconds) seconds FROM listening_days WHERE ${where} GROUP BY day ORDER BY day`, args);
  const top = await db.getAllAsync<{ song: string; seconds: number; plays: number }>(`SELECT song,SUM(seconds) seconds,SUM(plays) plays FROM listening_days WHERE ${where} GROUP BY song_id ORDER BY seconds DESC LIMIT 30`, args);
  const artists = await db.getAllAsync<{ name: string; seconds: number }>(`SELECT artist name,SUM(seconds) seconds FROM listening_days WHERE ${where} GROUP BY artist ORDER BY seconds DESC LIMIT 10`, args);
  return { seconds: total?.seconds ?? 0, plays: total?.plays ?? 0, songs: total?.songs ?? 0, days,
    top: top.flatMap((row) => { try { return [{ ...row, song: JSON.parse(row.song) as Song }]; } catch { return []; } }), artists };
  });
}
export async function savedSmartRules(profile: string): Promise<SmartRule[]> {
  await writing.catch(() => {});
  const rows = await (await database()).getAllAsync<{ data: string }>('SELECT data FROM smart_rules WHERE profile=? ORDER BY id', profile);
  return rows.flatMap((row) => { try { const rule = normalizeSmartRule(JSON.parse(row.data)); return rule ? [rule] : []; } catch { return []; } });
}
export function saveSmartRule(profile: string, rule: SmartRule): Promise<void> {
  const normalized = normalizeSmartRule(rule);
  if (!normalized) return Promise.reject(new Error('Invalid smart playlist rule'));
  return serialized(async () => {
    await (await database()).runAsync('INSERT INTO smart_rules(profile,id,data) VALUES(?,?,?) ON CONFLICT(profile,id) DO UPDATE SET data=excluded.data', profile, normalized.id, JSON.stringify(normalized));
  });
}
export function deleteSmartRule(profile: string, id: string): Promise<void> {
  return serialized(async () => { await (await database()).runAsync('DELETE FROM smart_rules WHERE profile=? AND id=?', profile, id); });
}
