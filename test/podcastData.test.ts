import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { create as createStore } from 'zustand';

import { episodePlayed, episodeResumeAt } from '../src/lib/episodeResume';
import { parseFeed, sortEpisodes } from '../src/lib/podcastFeed';
import { podcastUrlExtension } from '../src/lib/podcastMedia';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
function compile(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, AbortController, Date, setTimeout, clearTimeout, ...globals,
    require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
const hash = (text: string) => [...text].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function databaseHarness(legacy = false) {
  const databases = new Map<string, any>();
  const files = new Map<string, number>();
  const fs = { documentDirectory: 'file:///sandbox/', makeDirectoryAsync: async () => {},
    getInfoAsync: async (path: string) => ({ exists: files.has(path), size: files.get(path) ?? 0 }),
    downloadAsync: async (_: string, path: string) => { files.set(path, 512); return { status: 200 }; },
    moveAsync: async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!); files.delete(from); },
    deleteAsync: async (path: string) => { files.delete(path); }, readDirectoryAsync: async () => [] };
  const connection = (dir: string) => {
    let raw = databases.get(dir); if (!raw) { raw = new DatabaseSync(':memory:'); databases.set(dir, raw); }
    return raw;
  };
  if (legacy) {
    const db = connection('/sandbox/podcasts/a/');
    db.exec(`CREATE TABLE podcast_channels(id TEXT PRIMARY KEY,feed_url TEXT,title TEXT NOT NULL,image_url TEXT,episode_count INTEGER NOT NULL DEFAULT 0,last_published_at INTEGER,refreshed_at INTEGER,data TEXT NOT NULL);
      CREATE TABLE podcast_episodes(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,published_at INTEGER,duration INTEGER,url TEXT,data TEXT NOT NULL);
      CREATE TABLE podcast_feeds(feed_url TEXT PRIMARY KEY,added_at INTEGER NOT NULL);`);
    db.prepare('INSERT INTO podcast_channels(id,feed_url,title,data) VALUES(?,?,?,?)').run('show', 'https://feed.test/rss', 'Kept show', JSON.stringify({ id: 'show', title: 'Kept show', feedUrl: 'https://feed.test/rss' }));
    db.prepare('INSERT INTO podcast_episodes(id,channel_id,url,data) VALUES(?,?,?,?)').run('show/old', 'show', 'https://audio.test/old.mp3', JSON.stringify({ id: 'show/old', channelId: 'show', title: 'Old episode', url: 'https://audio.test/old.mp3' }));
  }
  const args = (params: unknown[]) => params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  let gate: (() => Promise<void>) | undefined;
  const sqlite = { openDatabaseAsync: async (_: string, __: unknown, dir: string) => {
    const raw = connection(dir);
    return { execAsync: async (sql: string) => raw.exec(sql),
      getFirstAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).get(...args(params)) ?? null,
      getAllAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...args(params)),
      runAsync: async (sql: string, ...params: unknown[]) => { if (gate) { const wait = gate; gate = undefined; await wait(); } return raw.prepare(sql).run(...args(params)); },
      withTransactionAsync: async (run: () => Promise<void>) => { raw.exec('BEGIN'); try { await run(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; } },
      closeAsync: async () => {},
    };
  } };
  const Db = compile('../src/lib/podcastDb.ts', { 'expo-file-system/legacy': fs, 'expo-sqlite': sqlite,
    '@/lib/localLibrary': { hashKey: hash }, './podcastMedia': { podcastUrlExtension }, '@/api/netGate': { isManualOffline: () => false } });
  return { Db, files, databases, gateNext: (run: () => Promise<void>) => { gate = run; } };
}

test('legacy podcast databases migrate subscriptions atomically and isolate favorites/progress per profile', async () => {
  const { Db, databases } = databaseHarness(true);
  assert.deepEqual([...await Db.addedIds('a')], ['show']);
  assert.equal((await Db.listAllEpisodes('a', 'show'))[0].title, 'Old episode');
  assert.equal(databases.get('/sandbox/podcasts/a/').prepare('PRAGMA user_version').get().user_version, 1);
  await Db.toggleFavorite('a', 'show', 'channel', 'show');
  await Db.saveEpisodeProgress('a', { id: 'show/old', channelId: 'show', positionSec: 73, durationSec: 300 });
  assert.deepEqual([...await Db.favoriteIds('a')], ['show']);
  assert.equal((await Db.listFavoriteChannels('a'))[0].listenedAt > 0, true);
  assert.deepEqual([...await Db.favoriteIds('b')], []);
  assert.equal(await Db.getEpisodeProgress('b', 'show/old'), undefined);
  await Db.closePodcastDb('a');
  assert.deepEqual([...await Db.addedIds('a')], ['show']);
});

test('feed refresh retains downloaded episodes missing from a trimmed feed and rolls back a cancelled replacement', async () => {
  const { Db, files } = databaseHarness();
  const old = { id: 'show/old', channelId: 'show', title: 'Keep my offline episode', url: 'https://audio.test/old.mp3' };
  await Db.saveChannel('a', { id: 'show', title: 'Show', feedUrl: 'https://feed.test/rss' });
  await Db.replaceEpisodes('a', 'show', [old]);
  files.set('file:///saved.mp3', 80);
  await Db.saveDownload('a', old, 'file:///saved.mp3', 80);
  await Db.replaceEpisodes('a', 'show', [{ id: 'show/new', channelId: 'show', title: 'New' }]);
  assert.equal((await Db.listAllEpisodes('a', 'show')).length, 2);
  assert.equal((await Db.listDownloads('a'))['show/old'], 'file:///saved.mp3');
  let checks = 0;
  await assert.rejects(Db.replaceEpisodes('a', 'show', [{ id: 'show/x', channelId: 'show' }, { id: 'show/y', channelId: 'show' }], () => ++checks < 3));
  assert.deepEqual(plain((await Db.listAllEpisodes('a', 'show')).map((x: any) => x.id).sort()), ['show/new', 'show/old']);
  assert.equal(files.has('file:///saved.mp3'), true);
});

test('queued database commits recheck the ownership predicate after waiting', async () => {
  const h = databaseHarness(); await h.Db.addedIds('a');
  let release!: () => void;
  h.gateNext(() => new Promise<void>((resolve) => { release = resolve; }));
  const blocker = h.Db.addChannel('a', 'show'); await turn();
  let current = true;
  const write = h.Db.saveDownload('a', { id: 'episode', channelId: 'show' }, 'file:///new.mp3', 4, () => current);
  current = false; release(); await blocker;
  await assert.rejects(write);
  assert.equal(Object.keys(await h.Db.listDownloads('a')).length, 0);
});

test('podcast resume treats short clips, unknown duration and invalid values safely', () => {
  assert.equal(episodePlayed(0, 20), false);
  assert.equal(episodePlayed(18, 20), true);
  assert.equal(episodeResumeAt(70, 300), 70);
  assert.equal(episodeResumeAt(290, 300), 0);
  assert.equal(episodeResumeAt(70, 0), 70);
  assert.equal(episodeResumeAt(Number.NaN, 300), 0);
  assert.equal(episodeResumeAt(Infinity, 300), 0);
  assert.equal(podcastUrlExtension('https://audio.test/file.mp3?signature=example'), 'mp3');
});

function apiHarness() {
  const h = databaseHarness();
  const owner = { username: 'one', serverUrl: 'https://one.test' };
  const useAuthStore = createStore(() => ({ auth: owner, offline: false }));
  const profileScopeId = () => useAuthStore.getState().auth.username;
  let xml = '', bodyWait: Promise<void> | undefined, status = 200;
  const requests: { url: string; headers: Record<string, string>; signal: AbortSignal }[] = [];
  const downloaded: { channel: any; episodes: any[]; automatic: boolean }[] = [];
  const invalidations: string[] = [];
  const imports = {
    'expo/fetch': { fetch: async (url: string, options: any) => {
      requests.push({ url, ...options });
      return { status, ok: status >= 200 && status < 300, headers: { get: (name: string) => name === 'etag' ? 'test-etag' : null },
        text: async () => { if (bodyWait) await bodyWait; return xml; } };
    } },
    './netGate': { assertCanRequest() {}, isManualOffline: () => false, OfflineError: class extends Error {} },
    '@/store/auth': { profileScopeId, useAuthStore },
    '@/store/podcastDownloads': { usePodcastDownloads: { getState: () => ({ download: async (channel: any, episodes: any[], automatic: boolean) => downloaded.push({ channel, episodes, automatic }), deleteEpisodes: async () => {}, deleteShow: async () => {} }) } },
    '@/store/player': { usePlayerStore: { getState: () => ({ playQueue: async () => {} }) } },
    '@/lib/podcastProgress': { markPodcastPlayed: async () => {} },
    '@/lib/episodeResume': { episodePlayed },
    '@/lib/localLibrary': { hashKey: hash },
    '@/lib/query': { queryClient: { invalidateQueries: ({ queryKey }: any) => { invalidations.push(queryKey[0]); return Promise.resolve(); } } },
    '@/lib/podcastDb': h.Db,
    '@/lib/podcastFeed': { parseFeed, sortEpisodes },
  };
  const Api = compile('../src/api/podcasts.ts', imports);
  const feed = (ids: string[]) => `<rss><channel><title>Example show</title>${ids.map((id, i) => `<item><guid>${id}</guid><title>${id}</title><pubDate>${new Date(2026, 0, 20 - i).toUTCString()}</pubDate><enclosure url="https://audio.test/${id}.mp3" type="audio/mpeg"/></item>`).join('')}</channel></rss>`;
  return { ...h, Api, downloaded, useAuthStore, requests, setFeed: (ids: string[]) => { xml = feed(ids); }, setStatus: (value: number) => { status = value; }, waitBody: (value?: Promise<void>) => { bodyWait = value; } };
}

test('automatic podcast downloads select only unique new arrivals, cap3, and never sweep initial backlog', async () => {
  const h = apiHarness(); h.setFeed(['old-a', 'old-b']);
  const channel = await h.Api.subscribe('https://feed.test/rss');
  await h.Api.setChannelAutoDownload(channel.id, true);
  assert.equal(h.downloaded.length, 0);
  h.setFeed(['new-a', 'new-a', 'new-b', 'new-c', 'new-d', 'old-a', 'old-b']);
  await h.Api.refreshChannel('https://feed.test/rss');
  assert.equal(h.downloaded.length, 1);
  assert.deepEqual(plain(h.downloaded[0].episodes.map((x) => x.title)), ['new-a', 'new-b', 'new-c']);
  assert.equal(h.downloaded[0].automatic, true);
  await h.Api.refreshChannel('https://feed.test/rss');
  assert.equal(h.downloaded.length, 1, 'unchanged episode set must not redownload');
  assert.deepEqual(plain(await h.Api.listAddedChannels()).map((x: any) => x.id), [channel.id]);
  assert.equal((await h.Api.favoriteIds()).size, 0, 'adding a show must not favorite it');
});

test('source change aborts a feed body and rejects late metadata/artwork writes', async () => {
  const h = apiHarness(); h.setFeed(['one']);
  let release!: () => void;
  h.waitBody(new Promise<void>((resolve) => { release = resolve; }));
  const work = h.Api.refreshChannel('https://feed.test/new'); await turn();
  h.useAuthStore.setState({ auth: { username: 'two', serverUrl: 'https://two.test' } });
  release(); await assert.rejects(work);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal((await h.Db.listChannels(hash('one'))).length, 0);
  assert.equal((await h.Db.listChannels(hash('two'))).length, 0);
});

test('conditional304 preserves episodes and clears a previous feed error without redownloading audio', async () => {
  const h = apiHarness(); h.setFeed(['old']);
  const ch = await h.Api.subscribe('https://feed.test/rss');
  await h.Db.saveChannel(hash('one'), { ...ch, error: 'http' });
  h.setStatus(304);
  const fresh = await h.Api.refreshChannel('https://feed.test/rss');
  assert.equal(fresh.error, undefined);
  assert.equal((await h.Api.listAllEpisodes(ch.id)).length, 1);
  assert.equal(h.requests[1].headers['if-none-match'], 'test-etag');
  assert.equal(h.downloaded.length, 0);
});

test('same-account simultaneous feed refreshes share one request and release their ticket afterwards', async () => {
  const h = apiHarness(); h.setFeed(['one']);
  let release!: () => void;
  h.waitBody(new Promise<void>((resolve) => { release = resolve; }));
  const first = h.Api.refreshChannel('https://feed.test/rss');
  const second = h.Api.refreshChannel('https://feed.test/rss');
  await turn(); assert.equal(h.requests.length, 1);
  release(); await Promise.all([first, second]); h.waitBody();
  await h.Api.refreshChannel('https://feed.test/rss');
  assert.equal(h.requests.length, 2);
});

test('an account change during the auto-download preference read cannot enqueue the previous feed under the new account', async () => {
  const h = apiHarness(); h.setFeed(['old']); const ch = await h.Api.subscribe('https://feed.test/rss');
  await h.Api.setChannelAutoDownload(ch.id, true);
  let release!: (value: unknown) => void, waiting = false;
  h.Db.autoDownloadIds = () => { waiting = true; return new Promise((resolve) => { release = resolve; }); };
  h.setFeed(['new', 'old']); const refresh = h.Api.refreshChannel('https://feed.test/rss');
  while (!waiting) await turn();
  h.useAuthStore.setState({ auth: { username: 'two', serverUrl: 'https://two.test' } });
  release(new Set([ch.id])); await assert.rejects(refresh);
  assert.equal(h.downloaded.length, 0);
});

test('manual progress marking and account change prevent old player reads/ticks publishing', async () => {
  const h = databaseHarness();
  let owner = 'one';
  const query = { queryClient: { invalidateQueries: async () => {} } };
  const M = compile('../src/lib/podcastProgress.ts', { '@/store/auth': { profileScopeId: () => owner }, './localLibrary': { hashKey: hash }, './query': query,
    './podcastDb': h.Db, './episodeResume': { episodeResumeAt } });
  const song = { id: 'ep', podcastChannelId: 'show', duration: 300 };
  const version = M.podcastProgressVersion(song, owner);
  await M.writePodcastProgress(song, 80, 300, owner, version, true);
  assert.equal(await M.readPodcastResume(song, owner, version), 80);
  await M.markPodcastPlayed(song, true);
  await M.writePodcastProgress(song, 90, 300, owner, version, true);
  assert.equal((await h.Db.getEpisodeProgress(hash(owner), 'ep')).positionSec, 300);
  await assert.rejects(M.readPodcastResume(song, owner, version));
  const markedVersion = M.podcastProgressVersion(song, owner);
  owner = 'two';
  await M.writePodcastProgress(song, 20, 300, 'one', markedVersion, true);
  assert.equal(await h.Db.getEpisodeProgress(hash(owner), 'ep'), undefined);
  assert.equal((await h.Db.getEpisodeProgress(hash('one'), 'ep')).positionSec, 300);
  owner = 'one';
  const oldToken = M.podcastProgressVersion(song, owner);
  for (let n = 0; n < 600; n++) M.podcastProgressVersion({ id: `unrelated-${n}`, podcastChannelId: 'other' }, owner);
  assert.equal(M.ownsPodcastProgress(song, owner, oldToken), false, 'bounded eviction must never restore a previously valid token');
  await M.writePodcastProgress(song, 12, 300, owner, oldToken, true);
  assert.equal((await h.Db.getEpisodeProgress(hash(owner), 'ep')).positionSec, 300);
});
