/**
 * Podcasts kept on the device, one SQLite database per profile. Not in the
 * download catalog, which can be emptied for space; a show the user opened is
 * theirs, so it lives here and not in a disposable cache.
 *
 * `podcast_channels` is both what gets refreshed and what was read from each
 * feed, including the error when the last read failed and the validators that
 * make the next read cheap. `podcast_episodes` is what the last read listed,
 * `podcast_favorites` the user's own hearts: a row is a favorited channel
 * (`kind = 'channel'`, `channel_id` its own id) or a favorited episode
 * (`kind = 'episode'`, `channel_id` the show it belongs to) — `channel_id`
 * names the show either way. `podcast_added` is the shows the user asked to keep:
 * opening one stores it too, and only this tells them apart. A column only earns existing when SQL reads it;
 * everything else is the `data` blob, which is what the getters hand back.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import { hashKey } from '@/lib/localLibrary';
import { podcastUrlExtension as urlExtension } from './podcastMedia';
import { isManualOffline } from '@/api/netGate';

import type { PodcastChannel, PodcastEpisode } from '@/api/subsonic';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA journal_size_limit = 524288;
CREATE TABLE IF NOT EXISTS podcast_channels (
  id TEXT PRIMARY KEY NOT NULL,
  feed_url TEXT NOT NULL,
  title TEXT NOT NULL,
  last_published_at INTEGER,
  refreshed_at INTEGER,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS podcast_episodes (
  id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  published_at INTEGER,
  url TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_episodes_channel
  ON podcast_episodes(channel_id, published_at DESC);
CREATE TABLE IF NOT EXISTS podcast_favorites (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  channel_id TEXT,
  favorited_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_favorites_order
  ON podcast_favorites(kind, favorited_at DESC);
CREATE TABLE IF NOT EXISTS podcast_added (
  channel_id TEXT PRIMARY KEY NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS podcast_auto_download (
  channel_id TEXT PRIMARY KEY NOT NULL
);
CREATE TABLE IF NOT EXISTS podcast_downloads (
  episode_id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  file TEXT NOT NULL,
  bytes INTEGER,
  downloaded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_downloads_channel
  ON podcast_downloads(channel_id, downloaded_at DESC);
CREATE TABLE IF NOT EXISTS podcast_progress (
  episode_id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  position_sec REAL NOT NULL,
  duration_sec REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const ROOT = `${FileSystem.documentDirectory}podcasts/`;

const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

// Only locale-sorted identities are retained, never complete episode blobs.
// Writes and these reads share writeQueue.
const alphaEpisodePages = new Map<string, { scope: string; channel: string; ids: string[]; bytes: number }>();
const ALPHA_PAGE_CACHE_BYTES = 4 * 1024 * 1024;
function clearEpisodePageOrder(scope: string, channel?: string): void {
  for (const [key, value] of alphaEpisodePages) {
    if (value.scope === scope && (channel === undefined || value.channel === channel)) alphaEpisodePages.delete(key);
  }
}

function cacheEpisodePageOrder(key: string, scope: string, channel: string, ids: string[]): void {
  const bytes = ids.reduce((sum, id) => sum + id.length * 2 + 32, 0);
  if (bytes > ALPHA_PAGE_CACHE_BYTES) return;
  alphaEpisodePages.delete(key);
  let used = [...alphaEpisodePages.values()].reduce((sum, value) => sum + value.bytes, 0);
  while (alphaEpisodePages.size >= 8 || used + bytes > ALPHA_PAGE_CACHE_BYTES) {
    const oldest = alphaEpisodePages.keys().next().value;
    if (oldest === undefined) break;
    used -= alphaEpisodePages.get(oldest)!.bytes; alphaEpisodePages.delete(oldest);
  }
  alphaEpisodePages.set(key, { scope, channel, ids, bytes });
}

/** Where one profile's podcasts are kept. */
export function podcastDbDir(scope: string): string {
  return `${ROOT}${scope}/`;
}

/** The file a show's picture is saved to: derived from the show and its
 *  address, so a reader finds the same path without being told it. It lives
 *  next to the database, not in the downloads folder — the picture belongs
 *  to the kept show, and "delete all downloads" must not take it away. */
function podcastArtFile(scope: string, channelId: string, imageUrl: string): string {
  return `${podcastDbDir(scope)}art/${hashKey(`${channelId}|${imageUrl}`)}.${urlExtension(imageUrl, 'jpg')}`;
}
const PODCAST_ART_BUDGET_MS = 2000;
let artSequence = 0;

/** Files a show's picture, once: the feed read that brought the address brings
 * the bytes too, so manual offline has a real file to draw and expo-image's
 * evictable cache is no longer a promise. `known` is what an earlier read filed
 * for the same show, remembered on its row: one stat says whether those bytes
 * are still on disk, which is why the folder no longer has to be listed every
 * time the database opens. The path is what the row remembers, so drawing the
 * cover stays synchronous. A picture that will not land is not a failed read:
 * the show is already on the device, so this answers nothing. */
export async function savePodcastArt(
  scope: string,
  channelId: string,
  imageUrl: string,
  known?: string,
  current: () => boolean = () => true,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const dir = podcastDbDir(scope);
  const file = podcastArtFile(scope, channelId, imageUrl);
  if (!current() || signal?.aborted || isManualOffline() || !/^https?:\/\//i.test(imageUrl)) return known;
  const part = `${file}.${Date.now().toString(36)}.${++artSequence}.part`;
  let active = true, finished = false;
  let transfer: ReturnType<typeof FileSystem.createDownloadResumable> | undefined;
  const owns = () => active && !signal?.aborted && current() && !isManualOffline();
  const cancel = () => { if (transfer && !finished) void transfer.cancelAsync().catch(() => {}); };
  const cleanup = () => { void FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {}); };
  let settleStop!: (value: string | undefined) => void;
  const stopped = new Promise<string | undefined>((resolve) => { settleStop = resolve; });
  const stop = () => { active = false; cancel(); cleanup(); settleStop(known); };
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, PODCAST_ART_BUDGET_MS);
  const work = (async () => {
    if (known === file && (await FileSystem.getInfoAsync(file)).exists && owns()) return file;
    if (!owns()) return known;
    await FileSystem.makeDirectoryAsync(`${dir}art/`, { intermediates: true });
    if (!owns()) return known;
    transfer = FileSystem.createDownloadResumable(imageUrl, part, {}, () => { if (!owns()) stop(); });
    const res = await transfer.downloadAsync(); finished = true;
    if (!res || res.status !== 200 || !owns()) return known;
    const mime = Object.entries(res.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.toLowerCase();
    if (mime && !mime.startsWith('image/')) return known;
    const info = await FileSystem.getInfoAsync(part);
    if (!info.exists || (info.size ?? 0) < 100 || (info.size ?? 0) > 16 * 1024 * 1024 || !owns()) return known;
    await FileSystem.moveAsync({ from: part, to: file });
    return owns() ? file : known;
  })().catch(() => known).finally(cleanup);
  try { return await Promise.race([work, stopped]); }
  finally {
    active = false; clearTimeout(timer); signal?.removeEventListener('abort', stop); cancel();
    // Never await native cleanup: a stuck cancellation/FS call must not become
    // another navigation deadline. Only this attempt's unique part is touched.
    cleanup();
  }
}

async function openDb(dir: string): Promise<SQLite.SQLiteDatabase> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const db = await SQLite.openDatabaseAsync('podcasts.db', {}, dir.replace(/^file:\/\//, ''));
  const migration = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  await db.execAsync(SCHEMA);
  // The marker and legacy rows commit together. A crash after CREATE TABLE
  // must not make all the pre-upgrade subscriptions disappear on next launch.
  if ((migration?.user_version ?? 0) < 1) await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT OR IGNORE INTO podcast_added (channel_id, added_at) SELECT id, ? FROM podcast_channels',
      [Date.now()],
    );
    await db.execAsync('PRAGMA user_version = 1');
  });
  return db;
}

// Writes go one at a time. Two transactions at once on one connection is an
// error, not a wait — "cannot start a transaction within a transaction" is
// what two screens refreshing the same profile at once would look like. The
// downloads database keeps the same lock for the same reason.
let writeQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

function podcastDb(scope: string): Promise<SQLite.SQLiteDatabase> {
  const dir = podcastDbDir(scope);
  const existing = open.get(dir);
  if (existing) return existing;
  // A failure is not remembered, so the next caller tries again.
  const handle: Promise<SQLite.SQLiteDatabase> = openDb(dir).catch((e) => {
    if (open.get(dir) === handle) open.delete(dir);
    throw e;
  });
  open.set(dir, handle);
  return handle;
}

/** Closes one profile's database, for when its folder is about to go. */
export async function closePodcastDb(scope: string): Promise<void> {
  clearEpisodePageOrder(scope);
  const dir = podcastDbDir(scope);
  const handle = open.get(dir);
  if (!handle) return;
  open.delete(dir);
  await handle.then((db) => db.closeAsync()).catch(() => {});
}

export async function saveChannel(scope: string, channel: PodcastChannel, current: () => boolean = () => true): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(() => {
    if (!current()) throw new Error('Podcast scope changed');
    return writeChannel(db, channel);
  });
}

function writeChannel(db: SQLite.SQLiteDatabase, channel: PodcastChannel) {
  return db.runAsync(
      `INSERT OR REPLACE INTO podcast_channels
         (id, feed_url, title, last_published_at, refreshed_at, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        channel.id,
        channel.feedUrl ?? '',
        channel.title,
        channel.lastPublishedAt ?? null,
        channel.refreshedAt ?? null,
        JSON.stringify(channel),
      ],
  );
}

/**
 * A channel's episodes, replaced by what its feed lists now: an episode the
 * publisher pulled goes too.
 *
 * A download whose episode the publisher renamed or pulled points at a file
 * nothing can reach any more: the row goes with it, and the file goes with
 * the row — left alone, those bytes would sit in „Storage used" under a badge
 * and a row no surface shows.
 */
export async function replaceEpisodes(
  scope: string,
  channelId: string,
  episodes: PodcastEpisode[],
  current: () => boolean = () => true,
): Promise<void> {
  const db = await podcastDb(scope);
  const orphans: string[] = [];
  await serialized(async () => {
    await db.withTransactionAsync(async () => {
      await replaceEpisodeRows(db, channelId, episodes, current, orphans);
    });
    clearEpisodePageOrder(scope, channelId);
  });
  for (const file of orphans) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
}

async function replaceEpisodeRows(
  db: SQLite.SQLiteDatabase, channelId: string, episodes: PodcastEpisode[], current: () => boolean, orphans: string[],
): Promise<void> {
      if (!current()) throw new Error('Podcast scope changed');
      // The publisher can trim a feed; an explicitly downloaded episode is
      // still the listener's audio and remains reachable until they delete it.
      await db.runAsync(`DELETE FROM podcast_episodes WHERE channel_id = ?
        AND NOT EXISTS (SELECT 1 FROM podcast_downloads d WHERE d.episode_id = podcast_episodes.id)`, [channelId]);
      for (const e of episodes) {
        if (!current()) throw new Error('Podcast scope changed');
        await db.runAsync(
          `INSERT OR REPLACE INTO podcast_episodes
             (id, channel_id, published_at, url, data)
           VALUES (?, ?, ?, ?, ?)`,
          [
            e.id,
            e.channelId,
            e.publishedAt ?? null,
            e.url ?? null,
            JSON.stringify(e),
          ],
        );
      }
      // Read once the new episodes are in: these are the downloads this very
      // read orphaned. The file's own address is in the row, so the file can
      // go with it.
      const rows = await db.getAllAsync<{ file: string }>(
        `SELECT d.file FROM podcast_downloads AS d
         WHERE d.channel_id = ?
         AND NOT EXISTS (SELECT 1 FROM podcast_episodes AS e WHERE e.id = d.episode_id)`,
        [channelId],
      );
      for (const r of rows) orphans.push(r.file);
      await db.runAsync(
        `DELETE FROM podcast_downloads
         WHERE channel_id = ?
         AND NOT EXISTS (SELECT 1 FROM podcast_episodes AS e WHERE e.id = episode_id)`,
        [channelId],
      );
      if (!current()) throw new Error('Podcast scope changed');
}

/** Prefixes never replace a feed or validators, and never downgrade a full cache. */
export async function mergePreview(
  scope: string, channel: PodcastChannel, episodes: PodcastEpisode[], current: () => boolean = () => true,
): Promise<PodcastChannel | undefined> {
  if (episodes.length > 7 || episodes.some((episode) => episode.channelId !== channel.id || !episode.id.startsWith(`${channel.id}/`)))
    throw new Error('Invalid podcast preview');
  if (!current()) throw new Error('Podcast scope changed');
  const db = await podcastDb(scope); let merged: PodcastChannel | undefined;
  await serialized(async () => {
    await db.withTransactionAsync(async () => {
      if (!current()) throw new Error('Podcast scope changed');
      const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM podcast_channels WHERE id=?', [channel.id]);
      if (!current()) throw new Error('Podcast scope changed');
      const existing = row ? JSON.parse(row.data) as PodcastChannel : undefined;
      if (existing && existing.syncComplete !== false) return;
      const preview: PodcastChannel = { ...existing, ...channel, syncComplete: false };
      delete preview.refreshedAt; delete preview.etag; delete preview.lastModified;
      delete preview.episodeCount; delete preview.lastPublishedAt; delete preview.newSinceAt; delete preview.error;
      await writeChannel(db, preview);
      for (const episode of episodes) {
        if (!current()) throw new Error('Podcast scope changed');
        // Existing richer records, firstSeenAt, downloads and progress are
        // untouched. Only the full snapshot may replace an existing episode.
        await db.runAsync(`INSERT OR IGNORE INTO podcast_episodes(id,channel_id,published_at,url,data) VALUES(?,?,?,?,?)`,
          [episode.id, episode.channelId, episode.publishedAt ?? null, episode.url ?? null, JSON.stringify(episode)]);
      }
      if (!current()) throw new Error('Podcast scope changed');
      merged = preview;
    });
    if (merged) clearEpisodePageOrder(scope, channel.id);
  });
  return merged;
}

/** Completeness, validators and the whole episode set land or roll back together. */
export async function saveFeedSnapshot(
  scope: string, channel: PodcastChannel, episodes: PodcastEpisode[], current: () => boolean = () => true,
): Promise<void> {
  if (episodes.some((episode) => episode.channelId !== channel.id)) throw new Error('Invalid podcast snapshot');
  if (!current()) throw new Error('Podcast scope changed');
  const db = await podcastDb(scope), orphans: string[] = [];
  await serialized(async () => {
    await db.withTransactionAsync(async () => {
      if (!current()) throw new Error('Podcast scope changed');
      await replaceEpisodeRows(db, channel.id, episodes, current, orphans);
      await writeChannel(db, { ...channel, syncComplete: true });
      if (!current()) throw new Error('Podcast scope changed');
    });
    clearEpisodePageOrder(scope, channel.id);
  });
  for (const file of orphans) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
}

/** Artwork only merges into the exact full generation that requested it. */
export async function updateChannelArt(
  scope: string, id: string, imageUrl: string, refreshedAt: number | undefined, artFile: string, current: () => boolean,
): Promise<boolean> {
  const db = await podcastDb(scope); let updated = false;
  await serialized(() => db.withTransactionAsync(async () => {
    if (!current()) throw new Error('Podcast scope changed');
    const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM podcast_channels WHERE id=?', [id]);
    if (!current()) throw new Error('Podcast scope changed');
    const channel = row ? JSON.parse(row.data) as PodcastChannel : undefined;
    if (!channel || channel.syncComplete === false || channel.imageUrl !== imageUrl || channel.refreshedAt !== refreshedAt) return;
    await writeChannel(db, { ...channel, artFile });
    if (!current()) throw new Error('Podcast scope changed'); updated = true;
  }));
  return updated;
}

export async function listChannels(scope: string): Promise<PodcastChannel[]> {
  const db = await podcastDb(scope);
  return serialized(async () => {
    const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM podcast_channels
     ORDER BY COALESCE(last_published_at, 0) DESC, title COLLATE NOCASE ASC`,
  );
    return rows.map((r) => JSON.parse(r.data) as PodcastChannel);
  });
}

export async function addChannel(scope: string, id: string, current: () => boolean = () => true): Promise<void> {
  if (!current()) throw new Error('Podcast scope changed');
  const db = await podcastDb(scope);
  await serialized(() => db.withTransactionAsync(async () => {
    if (!current()) throw new Error('Podcast scope changed');
    await db.runAsync('INSERT OR IGNORE INTO podcast_added (channel_id, added_at) VALUES (?, ?)', [id, Date.now()]);
    // The callback can be invalidated while the native INSERT is in flight.
    // Roll it back before COMMIT rather than reporting a cancelled add as kept.
    if (!current()) throw new Error('Podcast scope changed');
  }));
}

export async function addedIds(scope: string): Promise<Set<string>> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ channel_id: string }>('SELECT channel_id FROM podcast_added');
  return new Set(rows.map((r) => r.channel_id));
}

export async function autoDownloadIds(scope: string): Promise<Set<string>> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ channel_id: string }>(
    'SELECT channel_id FROM podcast_auto_download',
  );
  return new Set(rows.map((r) => r.channel_id));
}

export async function setAutoDownload(scope: string, id: string, on: boolean): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(() =>
    on
      ? db.runAsync('INSERT OR IGNORE INTO podcast_auto_download (channel_id) VALUES (?)', [id])
      : db.runAsync('DELETE FROM podcast_auto_download WHERE channel_id = ?', [id]),
  );
}

export async function getChannel(
  scope: string,
  id: string,
): Promise<PodcastChannel | undefined> {
  const db = await podcastDb(scope);
  return serialized(async () => {
    const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM podcast_channels WHERE id = ?',
    [id],
  );
    return row ? (JSON.parse(row.data) as PodcastChannel) : undefined;
  });
}

/** One page of a channel's episodes, newest first: old feeds list thousands,
 *  so a read asks for a page at a time rather than the whole show. */
const MAX_EPISODES = 200;

async function listEpisodes(
  scope: string,
  channelId: string,
  limit: number,
  offset: number,
): Promise<PodcastEpisode[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM podcast_episodes
     WHERE channel_id = ?
     ORDER BY COALESCE(published_at, 0) DESC, id ASC
     LIMIT ? OFFSET ?`,
    [channelId, limit, offset],
  );
  return rows.map((r) => JSON.parse(r.data) as PodcastEpisode);
}

/** Every episode of a channel, pages read to the end: a screen shows the
 *  whole show, and old feeds list thousands. */
export async function listAllEpisodes(scope: string, channelId: string): Promise<PodcastEpisode[]> {
  // One read owns all its pages. It cannot join another task's half-written
  // snapshot on the cached connection between DELETE and the final INSERT.
  return serialized(async () => {
    const all: PodcastEpisode[] = [];
    for (let offset = 0; ; offset += MAX_EPISODES) {
      const page = await listEpisodes(scope, channelId, MAX_EPISODES, offset);
      all.push(...page);
      if (page.length < MAX_EPISODES) return all;
    }
  });
}

export interface PodcastEpisodePageOptions {
  limit?: number;
  offset?: number;
  order?: 'recent' | 'added' | 'alpha';
  language?: string;
  filter?: 'all' | 'unplayed' | 'progress' | 'downloaded';
  season?: number | 'other';
}
export interface PodcastEpisodePage {
  items: PodcastEpisode[];
  total: number;
  nextOffset: number | null;
  /** Seasons of the complete show, not just this page or selected filter. */
  seasons: number[];
  /** First matching in-progress episode in full current order; first page only. */
  resumeId: string | null;
}

/** A bounded detail page. Full notes/chapters stay available through getEpisode. */
export async function listEpisodePage(
  scope: string, channelId: string, options: PodcastEpisodePageOptions = {}, current: () => boolean = () => true,
): Promise<PodcastEpisodePage> {
  const check = () => { if (!current()) throw new Error('Podcast scope changed'); };
  check(); const db = await podcastDb(scope); check();
  const limit = Math.max(1, Math.min(100, Math.floor(Number.isFinite(options.limit) ? options.limit! : 7)));
  const offset = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER,
    Math.floor(Number.isFinite(options.offset) ? options.offset! : 0)));
  const filter = ['unplayed', 'progress', 'downloaded'].includes(options.filter ?? '') ? options.filter : 'all';
  const order = options.order === 'added' || options.order === 'alpha' ? options.order : 'recent';
  const season = options.season === 'other' ? 'other'
    : Number.isSafeInteger(options.season) && Number(options.season) > 0 ? options.season : undefined;
  const seasonSql = season === 'other' ? 'AND season IS NULL' : season !== undefined ? 'AND season = ?' : '';
  const params = season !== undefined && season !== 'other' ? [channelId, season] : [channelId];
  const condition = filter === 'downloaded' ? 'downloaded = 1' : filter === 'unplayed' ? 'NOT played'
    : filter === 'progress' ? 'position_sec >= 5 AND NOT played' : '1';
  const eligible = `WITH source AS (
    SELECT e.id,e.data,e.published_at,
      json_extract(e.data,'$.season') AS season,
      CASE WHEN p.position_sec >= 0 AND p.position_sec <= 1.7976931348623157e308 THEN p.position_sec ELSE 0 END AS position_sec,
      CASE WHEN p.duration_sec > 0 AND p.duration_sec <= 1.7976931348623157e308 THEN p.duration_sec
        WHEN json_extract(e.data,'$.duration') > 0 THEN json_extract(e.data,'$.duration') ELSE 0 END AS duration_sec,
      CASE WHEN d.file IS NOT NULL AND d.file <> '' THEN 1 ELSE 0 END AS downloaded
    FROM podcast_episodes e LEFT JOIN podcast_progress p ON p.episode_id=e.id
      LEFT JOIN podcast_downloads d ON d.episode_id=e.id WHERE e.channel_id=?
  ), eligible AS (
    SELECT *,duration_sec > 0 AND position_sec >= MAX(duration_sec*.9,duration_sec-30) AS played FROM source
  )`;
  return serialized(async () => {
    check();
    const seasons = await db.getAllAsync<{ season: number }>(
      `SELECT DISTINCT json_extract(data,'$.season') AS season FROM podcast_episodes
       WHERE channel_id=? AND json_type(data,'$.season') IN ('integer','real')
       AND json_extract(data,'$.season') > 0 ORDER BY season DESC`, [channelId]); check();
    let ids: string[], total: number, resumeId: string | null = null;
    if (order === 'alpha') {
      const cacheKey = JSON.stringify([scope, channelId, options.language ?? '']);
      let cached = alphaEpisodePages.get(cacheKey);
      if (!cached) {
        // Read no episode blobs into JS. Preserve the old full-list base order
        // when the locale regards two titles as equal.
        const titles = await db.getAllAsync<{ id: string; title: string }>(
          `SELECT id,COALESCE(json_extract(data,'$.title'),'') AS title FROM podcast_episodes
           WHERE channel_id=? ORDER BY COALESCE(published_at,0) DESC,id ASC`, [channelId]); check();
        let compare: (left: string, right: string) => number;
        try { compare = new Intl.Collator(options.language).compare; }
        catch { compare = new Intl.Collator().compare; }
        // Small runs keep cancellation and UI work bounded even for very old
        // feeds; merging yields rather than sorting a large notes array at once.
        let runs: { id: string; title: string; index: number }[][] = [];
        for (let start = 0; start < titles.length; start += 256) {
          check(); runs.push(titles.slice(start, start + 256).map((row, index) => ({ ...row, index: start + index }))
            .sort((a, b) => compare(a.title, b.title) || a.index - b.index));
          if (start + 256 < titles.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        while (runs.length > 1) {
          const next: typeof runs = [];
          for (let part = 0; part < runs.length; part += 2) {
            check(); const left = runs[part], right = runs[part + 1];
            if (!right) { next.push(left); continue; }
            const merged: typeof left = []; let a = 0, b = 0;
            while (a < left.length || b < right.length) {
              if (b === right.length || a < left.length && (compare(left[a].title, right[b].title) || left[a].index - right[b].index) <= 0) merged.push(left[a++]);
              else merged.push(right[b++]);
              if (merged.length % 512 === 0) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); check(); }
            }
            next.push(merged);
          }
          runs = next;
        }
        const sorted = (runs[0] ?? []).map((row) => row.id); check();
        cacheEpisodePageOrder(cacheKey, scope, channelId, sorted);
        cached = { scope, channel: channelId, ids: sorted, bytes: 0 };
      } else { alphaEpisodePages.delete(cacheKey); alphaEpisodePages.set(cacheKey, cached); }
      const matches = await db.getAllAsync<{ id: string; position_sec: number; played: number }>(
        `${eligible} SELECT id,position_sec,played FROM eligible WHERE ${condition} ${seasonSql}`, params); check();
      const matching = new Set(matches.map((row) => row.id));
      const sorted = cached.ids.filter((id) => matching.has(id)); total = sorted.length; ids = sorted.slice(offset, offset + limit);
      if (offset === 0) {
        const inProgress = new Set(matches.filter((row) => row.position_sec >= 5 && !row.played).map((row) => row.id));
        resumeId = sorted.find((id) => inProgress.has(id)) ?? null;
      }
    } else {
      const ordering = `CASE WHEN published_at > 0 THEN 0 ELSE 1 END,
        CASE WHEN published_at > 0 THEN published_at END ${order === 'added' ? 'ASC' : 'DESC'},id ASC`;
      const count = await db.getFirstAsync<{ total: number }>(`${eligible} SELECT COUNT(*) AS total FROM eligible WHERE ${condition} ${seasonSql}`, params); check();
      total = count?.total ?? 0;
      const rows = await db.getAllAsync<{ id: string }>(`${eligible} SELECT id FROM eligible WHERE ${condition} ${seasonSql}
        ORDER BY ${ordering} LIMIT ? OFFSET ?`, [...params, limit, offset]); check();
      ids = rows.map((row) => row.id);
      if (offset === 0) {
        const resume = await db.getFirstAsync<{ id: string }>(`${eligible} SELECT id FROM eligible
          WHERE ${condition} ${seasonSql} AND position_sec >= 5 AND NOT played ORDER BY ${ordering} LIMIT 1`, params); check();
        resumeId = resume?.id ?? null;
      }
    }
    if (!ids.length) return { items: [], total, nextOffset: null, seasons: seasons.map((row) => row.season), resumeId };
    const rows = await db.getAllAsync<{ id: string; data: string }>(
      `SELECT id,json_set(json_remove(data,'$.descriptionHtml','$.chapters','$.transcripts','$.description'),
        '$.description',substr(COALESCE(json_extract(data,'$.description'),''),1,512)) AS data
       FROM podcast_episodes WHERE channel_id=? AND id IN (${ids.map(() => '?').join(',')})`, [channelId, ...ids]); check();
    const byId = new Map(rows.map((row) => [row.id, JSON.parse(row.data) as PodcastEpisode]));
    return { items: ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), total,
      nextOffset: offset + ids.length < total ? offset + ids.length : null, seasons: seasons.map((row) => row.season), resumeId };
  });
}

export async function getEpisode(scope: string, id: string): Promise<PodcastEpisode | undefined> {
  const db = await podcastDb(scope);
  return serialized(async () => {
    const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM podcast_episodes WHERE id = ?', [id]);
    return row ? JSON.parse(row.data) as PodcastEpisode : undefined;
  });
}

/** One episode together with the show it belongs to, for a row that shows both. */
export interface RecentEpisode {
  episode: PodcastEpisode;
  channel: PodcastChannel;
}

/** When a kept item was hearted and last listened to, for the Library's orders. */
export interface FavoriteTimes {
  favoritedAt: number;
  listenedAt: number;
}

/** The newest playable episodes across every channel, each with its channel. */
export async function listRecentEpisodes(scope: string, limit = 20): Promise<RecentEpisode[]> {
  const db = await podcastDb(scope);
  return serialized(async () => {
    const rows = await db.getAllAsync<{ episode: string; channel: string }>(
    `SELECT e.data AS episode, c.data AS channel
     FROM podcast_episodes e
     JOIN podcast_channels c ON c.id = e.channel_id
     JOIN podcast_added a ON a.channel_id = c.id
     WHERE e.url IS NOT NULL AND e.url <> ''
     ORDER BY COALESCE(e.published_at, 0) DESC, e.id ASC
     LIMIT ?`,
    [limit],
  );
    return rows.map((r) => ({
    episode: JSON.parse(r.episode) as PodcastEpisode,
    channel: JSON.parse(r.channel) as PodcastChannel,
    }));
  });
}

export type PodcastLibraryFilter = 'continue' | 'unplayed' | 'downloaded';
export interface PodcastLibraryEpisode extends RecentEpisode {
  positionSec: number;
  durationSec: number;
  downloaded: boolean;
  updatedAt: number;
}

/** A bounded cross-show shelf, read on the existing connection after queued writes. */
export async function listLibraryEpisodes(scope: string, filter: PodcastLibraryFilter, limit = 80, offset = 0, search = ''): Promise<PodcastLibraryEpisode[]> {
  const db = await podcastDb(scope);
  const pageSize = Math.max(1, Math.min(200, Math.floor(Number.isFinite(limit) ? limit : 80)));
  const start = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0));
  const term = search.trim().slice(0, 200);
  const condition = filter === 'downloaded' ? 'downloaded = 1'
    : filter === 'continue' ? 'position_sec >= 5 AND NOT played' : 'NOT played';
  const order = filter === 'continue' ? 'updated_at DESC, id ASC'
    : filter === 'downloaded' ? 'downloaded_at DESC, id ASC' : 'published_at DESC, id ASC';
  return serialized(async () => {
    const rows = await db.getAllAsync<{ episode: string; channel: string; position_sec: number; duration_sec: number; downloaded: number; updated_at: number }>(
      `WITH library AS (
        SELECT e.id,
          json_set(json_remove(e.data, '$.descriptionHtml', '$.chapters', '$.transcripts', '$.description'),
            '$.description', substr(COALESCE(json_extract(e.data, '$.description'), ''), 1, 512)) AS episode,
          c.data AS channel, COALESCE(e.published_at, 0) AS published_at,
          COALESCE(p.position_sec, 0) AS position_sec,
          CASE WHEN COALESCE(p.duration_sec, 0) > 0 THEN p.duration_sec ELSE COALESCE(json_extract(e.data, '$.duration'), 0) END AS duration_sec,
          COALESCE(p.updated_at, 0) AS updated_at, COALESCE(d.downloaded_at, 0) AS downloaded_at,
          CASE WHEN d.file IS NOT NULL AND d.file <> '' THEN 1 ELSE 0 END AS downloaded
        FROM podcast_episodes e JOIN podcast_channels c ON c.id = e.channel_id
        JOIN podcast_added a ON a.channel_id = c.id
        LEFT JOIN podcast_progress p ON p.episode_id = e.id
        LEFT JOIN podcast_downloads d ON d.episode_id = e.id
        WHERE (e.url IS NOT NULL AND e.url <> '') OR (d.file IS NOT NULL AND d.file <> '')
      ), listening AS (
        SELECT *, (duration_sec > 0 AND position_sec >= MAX(duration_sec * .9, duration_sec - 30)) AS played FROM library
      ) SELECT episode, channel, position_sec, duration_sec, downloaded, updated_at FROM listening
      WHERE ${condition} AND (? = '' OR instr(lower(json_extract(episode, '$.title')), lower(?)) > 0
        OR instr(lower(json_extract(channel, '$.title')), lower(?)) > 0)
      ORDER BY ${order} LIMIT ? OFFSET ?`, [term, term, term, pageSize, start],
    );
    return rows.map((row) => ({ episode: JSON.parse(row.episode) as PodcastEpisode, channel: JSON.parse(row.channel) as PodcastChannel,
      positionSec: row.position_sec, durationSec: row.duration_sec, downloaded: !!row.downloaded, updatedAt: row.updated_at }));
  });
}

/** Every feed kept on the device, the one least recently read first. The
 * channels are the feeds — a show is only filed once its feed has been read, and
 * a read that failed keeps the address it tried — so a refresh-all has nothing
 * else to ask for. A row written before this change can have no address, and
 * there is nothing to read for it. */
export async function listFeeds(scope: string): Promise<string[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ feed_url: string }>(
    `SELECT c.feed_url FROM podcast_channels c JOIN podcast_added a ON a.channel_id=c.id
     WHERE c.feed_url IS NOT NULL AND c.feed_url<>'' ORDER BY COALESCE(c.refreshed_at, 0) ASC`,
  );
  return rows.map((r) => r.feed_url);
}

/**
 * Hearts on/off. A favorite is the user's own, so it lives here and not in the
 * server's starring: `kind` says whether the id is a show or one of its episodes,
 * and `channel_id` is the show either way — the id for a channel, its show for an
 * episode — so one row can find the show an episode belongs to. Returns whether
 * the item is favorited now.
 */
export async function toggleFavorite(
  scope: string,
  id: string,
  kind: 'channel' | 'episode',
  channelId: string,
): Promise<boolean> {
  const db = await podcastDb(scope);
  // Read and write as one step: two taps on the same heart must not both see
  // the old state and write the same answer.
  return serialized(async () => {
    const existing = await db.getFirstAsync<{ favorited_at: number }>(
      'SELECT favorited_at FROM podcast_favorites WHERE id = ?',
      [id],
    );
    if (existing) {
      await db.runAsync('DELETE FROM podcast_favorites WHERE id = ?', [id]);
      return false;
    }
    await db.runAsync(
      'INSERT INTO podcast_favorites (id, kind, channel_id, favorited_at) VALUES (?, ?, ?, ?)',
      [id, kind, channelId, Date.now()],
    );
    return true;
  });
}

/** The ids the user has hearted, for a row to show its heart without a query each. */
export async function favoriteIds(scope: string): Promise<Set<string>> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM podcast_favorites',
    [],
  );
  return new Set(rows.map((r) => r.id));
}

/** The favorited shows, most recently hearted first. */
export async function listFavoriteChannels(
  scope: string,
): Promise<(PodcastChannel & FavoriteTimes)[]> {
  const db = await podcastDb(scope);
  return serialized(async () => {
    const rows = await db.getAllAsync<{ data: string; favorited_at: number; listened_at: number | null }>(
    `SELECT c.data, f.favorited_at,
       (SELECT MAX(p.updated_at) FROM podcast_progress p WHERE p.channel_id = c.id) AS listened_at
     FROM podcast_favorites f
     JOIN podcast_channels c ON c.id = f.id
     WHERE f.kind = 'channel'
     ORDER BY f.favorited_at DESC`,
  );
    return rows.map((r) => ({
    ...(JSON.parse(r.data) as PodcastChannel),
    favoritedAt: r.favorited_at,
    listenedAt: r.listened_at ?? 0,
    }));
  });
}

/** The favorited episodes, each with its show, most recently hearted first. */
export async function listFavoriteEpisodes(
  scope: string,
  limit = 100,
): Promise<(RecentEpisode & FavoriteTimes)[]> {
  const db = await podcastDb(scope);
  return serialized(async () => {
    const rows = await db.getAllAsync<{
    episode: string;
    channel: string;
    favorited_at: number;
    listened_at: number | null;
  }>(
    `SELECT e.data AS episode, c.data AS channel, f.favorited_at, p.updated_at AS listened_at
     FROM podcast_favorites f
     JOIN podcast_episodes e ON e.id = f.id
     JOIN podcast_channels c ON c.id = e.channel_id
     LEFT JOIN podcast_progress p ON p.episode_id = e.id
     WHERE f.kind = 'episode'
     ORDER BY f.favorited_at DESC
     LIMIT ?`,
    [limit],
  );
    return rows.map((r) => ({
    episode: JSON.parse(r.episode) as PodcastEpisode,
    channel: JSON.parse(r.channel) as PodcastChannel,
    favoritedAt: r.favorited_at,
    listenedAt: r.listened_at ?? 0,
    }));
  });
}

/** Where an episode was left. Its own table: a feed read replaces the episodes. */
export async function saveEpisodeProgress(
  scope: string,
  episode: { id: string; channelId: string; positionSec: number; durationSec: number },
  current: () => boolean = () => true,
): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(async () => {
    if (!current()) return;
    await db.runAsync(
      `INSERT OR REPLACE INTO podcast_progress
         (episode_id, channel_id, position_sec, duration_sec, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [episode.id, episode.channelId, episode.positionSec, episode.durationSec, Date.now()],
    );
  });
}

export async function clearEpisodeProgress(scope: string, id: string, current: () => boolean = () => true): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(async () => { if (current()) await db.runAsync('DELETE FROM podcast_progress WHERE episode_id = ?', [id]); });
}

/** One atomic bulk mark, without re-reading/re-rendering the library per episode. */
export async function markManyPlayed(scope: string, episodes: { id: string; channelId: string; durationSec: number }[], current: () => boolean): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(() => db.withTransactionAsync(async () => {
    const now = Date.now();
    for (const episode of episodes) {
      if (!current()) throw new Error('Podcast marks superseded');
      const duration = episode.durationSec > 0 && Number.isFinite(episode.durationSec) ? episode.durationSec : 1;
      await db.runAsync('INSERT OR REPLACE INTO podcast_progress (episode_id,channel_id,position_sec,duration_sec,updated_at) VALUES(?,?,?,?,?)',
        [episode.id, episode.channelId, duration, duration, now]);
    }
    if (!current()) throw new Error('Podcast marks superseded');
  }));
}

export async function listEpisodeProgress(
  scope: string,
  channelId: string,
): Promise<{ id: string; positionSec: number; durationSec: number }[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ episode_id: string; position_sec: number; duration_sec: number }>(
    'SELECT episode_id, position_sec, duration_sec FROM podcast_progress WHERE channel_id = ?',
    [channelId],
  );
  return rows.map((r) => ({ id: r.episode_id, positionSec: r.position_sec, durationSec: r.duration_sec }));
}

export async function getEpisodeProgress(
  scope: string,
  id: string,
): Promise<{ positionSec: number; durationSec: number } | undefined> {
  const db = await podcastDb(scope);
  const row = await db.getFirstAsync<{ position_sec: number; duration_sec: number }>(
    'SELECT position_sec, duration_sec FROM podcast_progress WHERE episode_id = ?',
    [id],
  );
  return row ? { positionSec: row.position_sec, durationSec: row.duration_sec } : undefined;
}

/**
 * Takes a show off the device: its row, its episodes, its hearts, its download
 * records and its picture. The downloaded files are unlinked by the caller
 * first, from the same records this clears.
 */
export async function removeChannel(scope: string, id: string): Promise<void> {
  const channel = await getChannel(scope, id);
  const db = await podcastDb(scope);
  await serialized(() =>
    db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM podcast_channels WHERE id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_episodes WHERE channel_id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_favorites WHERE channel_id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_added WHERE channel_id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_auto_download WHERE channel_id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_downloads WHERE channel_id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_progress WHERE channel_id = ?', [id]);
    }),
  );
  clearEpisodePageOrder(scope, id);
  if (channel?.imageUrl) {
    await FileSystem.deleteAsync(podcastArtFile(scope, id, channel.imageUrl), {
      idempotent: true,
    }).catch(() => {});
  }
}

/**
 * A downloaded episode: its file on disk, remembered so a cold start can hand
 * the same path back to the player. `channel_id` lets a whole show's downloads
 * be counted and cleared together.
 */
export async function saveDownload(
  scope: string,
  episode: { id: string; channelId: string },
  fileUri: string,
  bytes: number | undefined,
  current: () => boolean = () => true,
): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(() => {
    if (!current()) throw new Error('Podcast download stopped');
    return db.runAsync(
      `INSERT OR REPLACE INTO podcast_downloads
         (episode_id, channel_id, file, bytes, downloaded_at)
       VALUES (?, ?, ?, ?, ?)`,
      [episode.id, episode.channelId, fileUri, bytes ?? null, Date.now()],
    );
  });
}

export async function getDownload(scope: string, id: string): Promise<{ file: string; bytes: number | null } | undefined> {
  const db = await podcastDb(scope);
  return await db.getFirstAsync<{ file: string; bytes: number | null }>(
    'SELECT file, bytes FROM podcast_downloads WHERE episode_id = ?', [id],
  ) ?? undefined;
}

/** Drops downloads from the record (the file itself is unlinked by the
 *  caller). Chunked like every other id list: SQLite counts placeholders,
 *  and a whole show's ids would otherwise pass the parameter limit. */
const PARAM_CHUNK = 400;

export async function dropDownloads(scope: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await podcastDb(scope);
  for (let i = 0; i < ids.length; i += PARAM_CHUNK) {
    const part = ids.slice(i, i + PARAM_CHUNK);
    await serialized(() =>
      db.runAsync(
        `DELETE FROM podcast_downloads WHERE episode_id IN (${part.map(() => '?').join(', ')})`,
        part,
      ),
    );
  }
}

/** Every downloaded episode's file, keyed by episode id, for the player's map. */
export async function listDownloads(scope: string): Promise<Record<string, string>> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string; file: string }>(
    `SELECT episode_id AS id, file FROM podcast_downloads
     WHERE EXISTS (SELECT 1 FROM podcast_episodes AS e WHERE e.id = episode_id)`,
    [],
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id] = r.file;
  return out;
}

/**
 * What the downloaded episodes take, added up by the database: the size was
 * written down when each file landed, so this is a sum, not a walk.
 */
export async function downloadedBytes(scope: string): Promise<number> {
  const db = await podcastDb(scope);
  const row = await db.getFirstAsync<{ total: number | null }>(
    // Only what an episode still reaches counts: a row whose episode the
    // publisher pulled is cleaned by the read that pulled it, and this is the
    // belt that keeps such a row from sitting in the number anyway.
    `SELECT SUM(bytes) AS total FROM podcast_downloads
     WHERE EXISTS (SELECT 1 FROM podcast_episodes AS e WHERE e.id = episode_id)`,
  );
  return row?.total ?? 0;
}

/**
 * Forgets every downloaded episode in every profile's database, and closes the
 * handles: the files under `podcast-downloads/` are about to go, and rows
 * pointing at them would hand the player a path that no longer exists. The
 * databases themselves stay — the shows and the hearts are the person's own.
 */
export async function clearDownloadRecords(): Promise<void> {
  const scopes = await FileSystem.readDirectoryAsync(ROOT).catch(() => [] as string[]);
  for (const scope of scopes) {
    try {
      const db = await podcastDb(scope);
      await serialized(() => db.runAsync('DELETE FROM podcast_downloads', []));
    } catch {
      // A database that cannot be opened has no rows anyone can read.
    }
    // Closed right after: touching every profile's database must not leave a
    // handle open for each of them.
    await closePodcastDb(scope);
  }
}

/** How many of a show's episodes are downloaded, and their ids. */
export async function downloadedForChannel(
  scope: string,
  channelId: string,
): Promise<{ ids: string[]; count: number }> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT episode_id AS id FROM podcast_downloads WHERE channel_id = ?',
    [channelId],
  );
  const ids = rows.map((r) => r.id);
  return { ids, count: ids.length };
}
