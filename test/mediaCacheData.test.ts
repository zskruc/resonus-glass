import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const executable = ts.transpileModule(readFileSync(new URL('../src/api/data.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const detail = { artist: { id: 'artist', name: 'Artist', coverArt: 'ar-hash' }, albums: [{ id: 'album', name: 'Album' }] };
const info = { imageUrl: 'https://images.test/signed-artwork', biography: 'Saved bio' };
const lyrics = { synced: true, lines: [{ start: 100, value: 'word by word', words: [
  { start: 100, end: 230, value: 'word ' }, { start: 230, end: 290, value: 'by ' }, { start: 290, end: 400, value: 'word' },
] }] };

function harness() {
  const auth = { url: 'https://server.test', username: 'one' };
  const state = { auth: auth as typeof auth | null, offline: false };
  const files: Record<string, string> = {};
  let saved: any = undefined;
  let savedLyrics: any = undefined;
  let cacheRead = async () => saved;
  let fetchDetail = async () => detail;
  let fetchInfo = async () => info;
  let fetchLyrics: () => Promise<any> = async () => lyrics;
  let localLyrics: any = null;
  let onlineLyrics: any = null;
  let fileExists = true;
  const calls = { detail: 0, info: 0, structured: 0, classic: 0, online: 0, sidecar: 0 };
  const writes: unknown[][] = [], published: unknown[][] = [], timers: (() => void)[] = [];
  class ApiError extends Error { network = true; code?: number; }
  const dependencies: Record<string, unknown> = {
    '@/store/auth': { useAuthStore: { getState: () => state } },
    '@/store/downloads': { useDownloads: { getState: () => ({ files }) }, noteDownloadedArtist: () => {} },
    '@/store/libraryMirror': { useLibraryMirror: { getState: () => ({ saveArtist: () => {} }) } },
    '@/store/settings': { useSettings: { getState: () => ({}) } },
    '@/store/songCache': { cachedUri: () => undefined },
    '@/lib/query': { queryClient: { setQueryData: (...args: unknown[]) => published.push(args) } },
    '@/lib/mediaCacheDb': {
      mediaCacheProfile: (owner: typeof auth) => owner.username,
      readSavedArtist: () => cacheRead(),
      saveArtistDetail: async (...args: unknown[]) => { writes.push(['detail', ...args]); },
      saveArtistInfo: async (...args: unknown[]) => { writes.push(['info', ...args]); },
      readSavedLyrics: async (_profile: string, _id: string, source: string) => savedLyrics?.[source],
      saveLyrics: async (...args: unknown[]) => { writes.push(['lyrics', ...args.slice(0, 4)]); },
    },
    '@/lib/netBudget': { withSpeculativeSlot: async (current: () => boolean, work: () => Promise<unknown>) => current() ? work() : undefined },
    'expo-file-system/legacy': { getInfoAsync: async () => ({ exists: fileExists }) },
    './backend': {
      getArtist: async () => { calls.detail++; return fetchDetail(); },
      getArtistInfo: async () => { calls.info++; return fetchInfo(); },
      getLyricsBySongId: async () => { calls.structured++; return fetchLyrics(); },
      getLyrics: async () => { calls.classic++; return ''; }, SubsonicRequestError: ApiError,
    },
    '@/lib/localQueries': { serverArtistId: async () => undefined },
    './netGate': { isManualOffline: () => state.offline },
    '@/lib/localLyrics': { getLocalLyrics: async () => { calls.sidecar++; return localLyrics; },
      getOnlineLyrics: async () => { calls.online++; return onlineLyrics; } },
  };
  for (const name of ['@/store/libraries', '@/lib/localLibrary', '@/lib/perfLog', '@/lib/storage', '@/store/lastPlayed',
    '@/store/playHistory', '@/store/offlineQueue', './navidrome', './subsonic']) dependencies[name] = {};
  const exported: Record<string, any> = {};
  runInNewContext(executable, { exports: exported, __DEV__: false,
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { api: exported, state, calls, writes, published, files,
    save: (value: any) => { saved = value; }, saveLyrics: (value: any) => { savedLyrics = value; },
    cacheReader: (work: typeof cacheRead) => { cacheRead = work; },
    detailRequest: (work: typeof fetchDetail) => { fetchDetail = work; },
    infoRequest: (work: typeof fetchInfo) => { fetchInfo = work; },
    lyricsRequest: (work: typeof fetchLyrics) => { fetchLyrics = work; },
    local: (value: unknown) => { localLyrics = value; }, online: (value: unknown) => { onlineLyrics = value; },
    fileExists: (value: boolean) => { fileExists = value; },
    refresh: async () => { for (const callback of timers.splice(0)) callback(); await tick(); },
  };
}

test('the actual artist queries return complete saved metadata and the durable full hero before network, online or offline', async () => {
  for (const offline of [false, true]) {
    const h = harness(); h.state.offline = offline;
    h.save({ detail, info, heroUri: 'file:///managed/full.jpg', detailAt: Date.now(), infoAt: Date.now() });
    assert.deepEqual(plain(await h.api.getArtist('artist')), detail);
    assert.deepEqual(plain(await h.api.getArtistInfo('artist')), { ...info, imageUrl: 'file:///managed/full.jpg' });
    assert.equal(h.calls.detail + h.calls.info, 0);
    h.fileExists(false);
    assert.equal((await h.api.getArtistInfo('artist')).imageUrl, offline ? undefined : info.imageUrl,
      'a removed local file falls back online without bypassing manual offline');
  }
});

test('stale artist refresh is deduplicated and an old auth generation cannot write or publish its response', async () => {
  const h = harness(), pending = deferred<typeof detail>();
  h.save({ detail, info, detailAt: 0, infoAt: 0 }); h.detailRequest(() => pending.promise);
  await h.api.getArtist('artist'); await h.api.getArtist('artist'); await h.refresh();
  assert.equal(h.calls.detail, 1);
  h.state.auth = { ...h.state.auth! };
  pending.resolve(detail); await tick();
  assert.equal(h.writes.length, 0); assert.equal(h.published.length, 0);
  const disk = deferred<any>(); h.cacheReader(() => disk.promise);
  const read = h.api.getArtistInfo('artist'); h.state.auth = { ...h.state.auth! };
  disk.resolve({ info, infoAt: Date.now() });
  await assert.rejects(read, /profile changed/);
});

test('server lyrics retain complete word timing and source selection in the persistent data query', async () => {
  const h = harness(), song = { id: 'song', artist: 'Artist', title: 'Song' };
  assert.deepEqual(plain(await h.api.getSongLyrics(song, 'off', { strict: true })), lyrics);
  assert.deepEqual(plain(h.writes[0]), ['lyrics', 'one', 'song', 'off', lyrics]);
  h.saveLyrics({ off: lyrics }); h.state.offline = true;
  assert.deepEqual(plain(await h.api.getSongLyrics(song, 'off')), lyrics);
  assert.equal(h.calls.structured, 1); assert.equal(h.calls.online, 0);
  h.files.song = 'file:///downloads/song.mp3';
  const own = { synced: true, lines: [{ start: 20, value: 'Sidecar wins offline' }] }; h.local(own);
  assert.deepEqual(plain(await h.api.getSongLyrics(song, 'off')), own);
});

test('bulk strict lyrics distinguish a failed provider from a confirmed absent lyric', async () => {
  const h = harness(), song = { id: 'song', artist: 'Artist', title: 'Song' };
  h.lyricsRequest(async () => { throw new Error('HTTP 503'); });
  await assert.rejects(h.api.getSongLyrics(song, 'local', { strict: true }), /503/);
  assert.equal(h.calls.classic, 0); assert.equal(h.calls.online, 0); assert.equal(h.writes.length, 0);
  h.lyricsRequest(async () => null);
  assert.equal(await h.api.getSongLyrics(song, 'local', { strict: true }), null);
  assert.equal(h.calls.online, 1); assert.equal(h.writes.length, 0);
});

test('a lyric response after replacing credentials is neither cached nor delivered to the new owner', async () => {
  const h = harness(), pending = deferred<typeof lyrics>(); h.lyricsRequest(() => pending.promise);
  const work = h.api.getSongLyrics({ id: 'song', artist: 'Artist', title: 'Song' }, 'off', { strict: true });
  await tick(); h.state.auth = { ...h.state.auth! }; pending.resolve(lyrics);
  await assert.rejects(work, /profile changed/); assert.equal(h.writes.length, 0);
});
