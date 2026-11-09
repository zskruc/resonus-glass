/** Production maintenance + SQLite; only the native filesystem/stores are faked. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import { podcastUrlExtension } from '../src/lib/podcastMedia';

const DAY = 86_400_000;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const hash = (value: string) => [...value].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
function harness() {
  let now = 10 * DAY;
  class Clock extends Date { static now() { return now; } }
  const authA = { username: 'A', serverUrl: 'https://a.test' };
  const auth = createStore<any>(() => ({ auth: authA, offline: false, autoOffline: false }));
  const profileScopeId = () => auth.getState().auth.username as string;
  const scope = hash('A'), databases = new Map<string, DatabaseSync>();
  const disk = new Map<string, { size: number; modificationTime?: number }>();
  let statGate: { file: string; entered: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | undefined;
  let sqlGate: { pattern: RegExp; entered: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | undefined;
  const failures = new Set<string>(), deleted: string[] = [];
  let directoryReads = 0, playing: any[] = [], downloadRows: any[] = [];
  const fs = { documentDirectory: 'file:///sandbox/', makeDirectoryAsync: async () => {},
    getInfoAsync: async (file: string) => {
      if (statGate?.file === file) { const gate = statGate; statGate = undefined; gate.entered.resolve(); await gate.release.promise; }
      return { exists: disk.has(file), isDirectory: false, ...(disk.get(file) ?? {}) };
    },
    readDirectoryAsync: async (directory: string) => { directoryReads++; return [...disk.keys()].filter((file) => file.startsWith(directory) && !file.slice(directory.length).includes('/')).map((file) => file.slice(directory.length)); },
    deleteAsync: async (file: string) => { if (failures.has(file)) throw new Error('Native unlink failed'); deleted.push(file); disk.delete(file); },
  };
  function compile(path: string, imports: Record<string, unknown>) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Date: Clock, URL, setTimeout, clearTimeout, AbortController,
      require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
    return exports;
  }
  const authModule = { profileScopeId, useAuthStore: auth };
  const lease = compile('../src/lib/podcastStorageLease.ts', {});
  const lyricOwner = compile('../src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const args = (values: any[]) => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  const Db = compile('../src/lib/podcastDb.ts', {
    'expo-file-system/legacy': fs, '@/lib/localLibrary': { hashKey: hash }, './podcastMedia': { podcastUrlExtension },
    '@/api/netGate': { isManualOffline: () => false },
    'expo-sqlite': { openDatabaseAsync: async (_name: string, _options: unknown, dir: string) => {
      let raw = databases.get(dir); if (!raw) { raw = new DatabaseSync(':memory:'); databases.set(dir, raw); }
      const db = raw;
      return { execAsync: async (sql: string) => db.exec(sql),
        getFirstAsync: async (sql: string, ...values: any[]) => db.prepare(sql).get(...args(values)) ?? null,
        getAllAsync: async (sql: string, ...values: any[]) => db.prepare(sql).all(...args(values)),
        runAsync: async (sql: string, ...values: any[]) => {
          const result = db.prepare(sql).run(...args(values));
          if (sqlGate?.pattern.test(sql)) { const gate = sqlGate; sqlGate = undefined; gate.entered.resolve(); await gate.release.promise; }
          return result;
        },
        withTransactionAsync: async (work: () => Promise<void>) => { db.exec('BEGIN'); try { await work(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } },
        closeAsync: async () => {},
      };
    } },
  });
  const downloads = createStore<any>(() => ({ scope, files: {}, hydrated: true }));
  const Service = compile('../src/lib/podcastStorage.ts', {
    'expo-file-system/legacy': fs, './podcastDb': Db, './localLibrary': { hashKey: hash }, './lyricOwner': lyricOwner,
    '@/store/auth': authModule, './query': { queryClient: { invalidateQueries: async () => {} } }, './podcastStorageLease': lease,
    '@/store/player': { getPodcastStoragePlaybackSongs: () => playing }, '@/store/downloads': { useDownloads: { getState: () => ({ queue: downloadRows }) } },
    '@/store/podcastDownloads': { usePodcastDownloads: downloads },
  });
  const root = `file:///sandbox/podcasts/${scope}/`;
  const channel = (id = 'show') => ({ id, title: id, feedUrl: `https://feeds.test/${id}`, syncComplete: true, description: 'Heavy notes' });
  const episode = (id: string, channelId = 'show') => ({ id: `${channelId}/${id}`, channelId, title: id, url: `https://media.test/${id}.mp3`, duration: 600, descriptionHtml: '<p>Heavy notes</p>' });
  async function seed(id: string, automatic = false, played = true, channelId = 'show') {
    const ch = channel(channelId), ep = episode(id, channelId), file = `${root}audio/${channelId}-${id}.mp3`;
    await Db.saveChannel(scope, ch); await Db.replaceEpisodes(scope, channelId, [ep]);
    disk.set(file, { size: 100 }); await Db.saveDownload(scope, ep, file, 100, () => true, automatic);
    if (played) await Db.saveEpisodeProgress(scope, { id: ep.id, channelId, positionSec: 600, durationSec: 600 });
    downloads.setState((state: any) => ({ files: { ...state.files, [ep.id]: file } }));
    return { ch, ep, file };
  }
  const blockStat = (file: string) => { const gate = { file, entered: deferred<void>(), release: deferred<void>() }; statGate = gate; return gate; };
  const blockSql = (pattern: RegExp) => { const gate = { pattern, entered: deferred<void>(), release: deferred<void>() }; sqlGate = gate; return gate; };
  return { Service, Db, lease, auth, authA, scope, disk, failures, deleted, downloads, root, seed, channel, episode, blockStat, blockSql,
    setNow: (value: number) => { now = value; }, playing: (songs: any[]) => { playing = songs; }, rows: (rows: any[]) => { downloadRows = rows; }, reads: () => directoryReads,
    close: () => { for (const db of databases.values()) db.close(); } };
}

test('usage counts only current-profile physical audio/covers/catalog and separately reports reusable DB pages', async () => {
  const h = harness(); try {
    await h.seed('one'); h.disk.set(`${h.root}art/one.jpg`, { size: 40 });
    h.disk.set(`${h.root}podcasts.db`, { size: 800 }); h.disk.set(`${h.root}podcasts.db-wal`, { size: 60 });
    h.disk.set(`file:///sandbox/podcasts/${hash('B')}/audio/other.mp3`, { size: 9999 });
    const usage = await h.Service.getPodcastStorageUsage({ expectedProfile: 'A' });
    assert.equal(usage.audioBytes, 100); assert.equal(usage.coverBytes, 40); assert.equal(usage.catalogBytes, 860); assert.equal(usage.totalBytes, 1000);
    assert.ok(usage.databaseAllocatedBytes > 0); assert.equal(usage.databaseLiveBytes + usage.databaseFreeBytes, usage.databaseAllocatedBytes);
    await assert.rejects(h.Service.getPodcastStorageUsage({ expectedProfile: 'B' }), /owner changed/);
  } finally { h.close(); }
});

test('daily policy removes only automatic completed audio older than24h, never legacy/manual/favorite/current/preloaded files', async () => {
  const h = harness(); try {
    const old = await h.seed('old', true, true, 'old'), manual = await h.seed('manual', false, true, 'manual');
    const current = await h.seed('current', true, true, 'current'), next = await h.seed('next', true, true, 'next');
    const favorite = await h.seed('favorite', true, true, 'favorite'), unplayed = await h.seed('unplayed', true, false, 'unplayed');
    await h.Db.toggleFavorite(h.scope, favorite.ep.id, 'episode', favorite.ch.id);
    h.playing([current.ep, next.ep].map((ep) => ({ ...ep, podcastChannelId: ep.channelId })));
    h.setNow(11 * DAY + 1);
    const result = await h.Service.runPodcastMaintenance();
    assert.equal(result.removedFiles, 1); assert.equal(h.disk.has(old.file), false);
    for (const entry of [manual, current, next, favorite, unplayed]) assert.equal(h.disk.has(entry.file), true, entry.ep.id);
    assert.equal((await h.Db.getEpisodeProgress(h.scope, old.ep.id)).positionSec, 600, 'audio deletion retains progress');
    const reads = h.reads(); await h.Service.runPodcastMaintenance(); assert.equal(h.reads(), reads, 'not due means no repeated directory scan');
    const last = await h.Service.getPodcastStorageLastMaintenance(); assert.equal(last.lastCompletedAt, 11 * DAY + 1);
  } finally { h.close(); }
});

test('manual audio cleanup protects actual installed/preloaded sources but not unrelated historical queue files; removes old orphan parts', async () => {
  const h = harness(); try {
    const current = await h.seed('current', false, false, 'current'), other = await h.seed('history', false, false, 'history');
    h.playing([{ ...current.ep, podcastChannelId: 'current' }]);
    const first = await h.Service.clearPodcastStorage('audio');
    assert.equal(first.removedFiles, 1); assert.equal(h.disk.has(other.file), false); assert.equal(h.disk.has(current.file), true);
    h.playing([]); h.disk.set(`${h.root}audio/crashed.mp3.part`, { size: 23 });
    const second = await h.Service.clearPodcastStorage('audio'); assert.equal(second.removedFiles, 2); assert.equal(second.removedBytes, 123);
    assert.equal((await h.Service.getPodcastStorageUsage()).audioBytes, 0);
  } finally { h.close(); }
});

test('unlink failure restores the same download record and in-memory path without deleting replacement/manual data', async () => {
  const h = harness(); try {
    const entry = await h.seed('failed'); h.failures.add(entry.file);
    const result = await h.Service.clearPodcastStorage('audio');
    assert.equal(result.failedFiles, 1); assert.equal(result.removedRecords, 0);
    assert.equal((await h.Db.getDownload(h.scope, entry.ep.id)).file, entry.file); assert.equal(h.downloads.getState().files[entry.ep.id], entry.file);
    assert.equal(h.Service.isPodcastStorageFileRemoving(h.scope, entry.ep.id), false);
  } finally { h.close(); }
});

test('A→B→A during a claimed deletion cancels unlink and restores only its old record; profile deletion generation prevents resurrection', async () => {
  const h = harness(); try {
    const entry = await h.seed('cancel'); const gate = h.blockStat(entry.file);
    const work = h.Service.clearPodcastStorage('audio'); const rejection = assert.rejects(work, /owner changed/);
    await gate.entered.promise; assert.equal(await h.Db.getDownload(h.scope, entry.ep.id), undefined);
    h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.authA }); gate.release.resolve(); await rejection;
    assert.equal(h.disk.has(entry.file), true); assert.equal((await h.Db.getDownload(h.scope, entry.ep.id)).file, entry.file);
    const nextGate = h.blockStat(entry.file); const second = h.Service.clearPodcastStorage('audio'); const failed = assert.rejects(second, /owner changed/);
    await nextGate.entered.promise; const stopped = h.Service.stopPodcastStorageProfile(h.scope); nextGate.release.resolve(); await Promise.all([failed, stopped]);
    assert.equal(await h.Db.getDownload(h.scope, entry.ep.id), undefined, 'deletion generation prohibits re-creating a removed profile');
  } finally { h.close(); }
});

test('new playback protection during catalog transaction rolls it back even without lease change', async () => {
  const h = harness(); try {
    const ch = h.channel('stale'), ep = h.episode('one', ch.id);
    await h.Db.saveChannel(h.scope, ch); await h.Db.replaceEpisodes(h.scope, ch.id, [ep]); await h.Db.touchChannel(h.scope, ch.id, 1);
    const gate = h.blockSql(/DELETE FROM podcast_episodes WHERE channel_id=/);
    const work = h.Service.clearPodcastStorage('catalog'); const failed = assert.rejects(work, /scope changed/);
    await gate.entered.promise; h.playing([{ ...ep, podcastChannelId: ch.id }]); gate.release.resolve(); await failed;
    assert.ok(await h.Db.getChannel(h.scope, ch.id)); assert.equal((await h.Db.listAllEpisodes(h.scope, ch.id)).length, 1);
  } finally { h.close(); }
});

test('three-day unvisited previews recycle while subscriptions, favorites and progress retain reachable lightweight metadata', async () => {
  const h = harness(); try {
    h.setNow(1);
    for (const id of ['stale', 'recent', 'subscribed', 'favorite', 'progress']) {
      const ch = h.channel(id), ep = h.episode('one', id);
      await h.Db.saveChannel(h.scope, ch); await h.Db.replaceEpisodes(h.scope, id, [ep]);
      await h.Db.touchChannel(h.scope, id, id === 'recent' ? 9 * DAY : 1);
      if (id === 'subscribed') await h.Db.addChannel(h.scope, id);
      if (id === 'favorite') await h.Db.toggleFavorite(h.scope, ep.id, 'episode', id);
      if (id === 'progress') await h.Db.saveEpisodeProgress(h.scope, { id: ep.id, channelId: id, positionSec: 120, durationSec: 600 });
    }
    h.setNow(10 * DAY); await h.Service.runPodcastMaintenance();
    assert.equal(await h.Db.getChannel(h.scope, 'stale'), undefined);
    for (const id of ['recent', 'subscribed', 'favorite', 'progress']) assert.ok(await h.Db.getChannel(h.scope, id), id);
    assert.equal((await h.Db.listAllEpisodes(h.scope, 'favorite'))[0].descriptionHtml, undefined);
    assert.equal((await h.Db.getEpisodeProgress(h.scope, 'progress/one')).positionSec, 120);
    assert.equal((await h.Db.addedIds(h.scope)).has('subscribed'), true);
  } finally { h.close(); }
});

test('playback changing during native cover stat protects newly in-use artwork without requiring a route lease change', async () => {
  const h = harness(); try {
    const file = `${h.root}art/waiting.jpg`;
    await h.Db.saveChannel(h.scope, { ...h.channel('waiting'), artFile: file }); h.disk.set(file, { size: 30 });
    const gate = h.blockStat(file), work = h.Service.clearPodcastStorage('covers');
    await gate.entered.promise; h.playing([{ id: 'waiting/one', podcastChannelId: 'waiting' }]); gate.release.resolve();
    const result = await work; assert.equal(result.removedFiles, 0); assert.equal(result.skippedInUse, 1); assert.equal(h.disk.has(file), true);
    assert.equal((await h.Db.getChannel(h.scope, 'waiting')).artFile, file);
  } finally { h.close(); }
});

test('cover cleanup leaves in-use show artwork and unrelated profile files; explicit clear removes only managed references', async () => {
  const h = harness(); try {
    const active = `${h.root}art/active.jpg`, unused = `${h.root}art/unused.jpg`, foreign = 'file:///somewhere/foreign.jpg';
    await h.Db.saveChannel(h.scope, { ...h.channel('active'), artFile: active });
    await h.Db.saveChannel(h.scope, { ...h.channel('unused'), artFile: unused });
    for (const file of [active, unused, foreign]) h.disk.set(file, { size: 30 });
    const release = h.lease.protectPodcastStorageChannel(h.scope, 'active');
    const result = await h.Service.clearPodcastStorage('covers'); release();
    assert.equal(result.removedFiles, 1); assert.equal(h.disk.has(active), true); assert.equal(h.disk.has(unused), false); assert.equal(h.disk.has(foreign), true);
    assert.equal((await h.Db.getChannel(h.scope, 'unused')).artFile, undefined);
    assert.equal((await h.Db.getChannel(h.scope, 'active')).artFile, active);
  } finally { h.close(); }
});
