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
  const auth = { url: 'https://server.test', username: 'one', serverType: 'navidrome' as string | undefined };
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
  let fileGate: Promise<void> | undefined;
  const covers = new Map<string, string>();
  const coverRequests: { id: string; size: number }[] = [];
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
    'expo-file-system/legacy': { getInfoAsync: async () => { await fileGate; return { exists: fileExists }; } },
    './backend': {
      COVER: { full: 1200 },
      coverArtUrl: (_owner: unknown, id: string, size: number) => {
        coverRequests.push({ id, size }); return `https://server.test/art/${id}?size=${size}`;
      },
      getArtist: async () => { calls.detail++; return fetchDetail(); },
      getArtistInfo: async () => { calls.info++; return fetchInfo(); },
      getLyricsBySongId: async () => { calls.structured++; return fetchLyrics(); },
      getLyrics: async () => { calls.classic++; return ''; }, SubsonicRequestError: ApiError,
    },
    '@/lib/localQueries': { serverArtistId: async () => undefined, coverUrl: (id: string) => covers.get(id) },
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
  return { api: exported, state, calls, writes, published, files, covers, coverRequests,
    save: (value: any) => { saved = value; }, saveLyrics: (value: any) => { savedLyrics = value; },
    cacheReader: (work: typeof cacheRead) => { cacheRead = work; },
    detailRequest: (work: typeof fetchDetail) => { fetchDetail = work; },
    infoRequest: (work: typeof fetchInfo) => { fetchInfo = work; },
    lyricsRequest: (work: typeof fetchLyrics) => { fetchLyrics = work; },
    local: (value: unknown) => { localLyrics = value; }, online: (value: unknown) => { onlineLyrics = value; },
    fileExists: (value: boolean) => { fileExists = value; },
    fileGate: (value: Promise<void>) => { fileGate = value; },
    refresh: async () => { for (const callback of timers.splice(0)) callback(); await tick(); },
  };
}

test('the actual artist queries return complete saved metadata and the durable full hero before network, online or offline', async () => {
  for (const offline of [false, true]) {
    const h = harness(); h.state.offline = offline;
    h.save({ detail, info, coverKey: 'ar-hash', heroUri: 'file:///managed/full.jpg', detailAt: Date.now(), infoAt: Date.now() });
    assert.deepEqual(plain(await h.api.getArtist('artist')), { ...detail, portraitUri: 'file:///managed/full.jpg' });
    assert.deepEqual(plain(await h.api.getArtistInfo('artist')), { ...info, imageUrl: 'file:///managed/full.jpg' });
    assert.equal(h.calls.detail + h.calls.info, 0);
    h.fileExists(false);
    assert.deepEqual(plain(await h.api.getArtist('artist')), detail, 'an evicted full hero is not advertised as reusable');
    assert.equal((await h.api.getArtistInfo('artist')).imageUrl, offline ? undefined : info.imageUrl,
      'a removed local file falls back online without bypassing manual offline');
  }
});

test('Navidrome artist heroes bypass a lower-quality local cover online while preserving offline and other providers', () => {
  const h = harness(); h.covers.set('ar-hash', 'file:///mirror/600.jpg');
  assert.equal(h.api.coverArtUrl('ar-hash', 1200), 'file:///mirror/600.jpg', 'ordinary cover policy is unchanged');
  assert.equal(h.api.artistPortraitUrl(detail.artist), 'https://server.test/art/ar-hash?size=1200');
  assert.deepEqual(plain(h.coverRequests), [{ id: 'ar-hash', size: 1200 }]);
  h.state.offline = true;
  assert.equal(h.api.artistPortraitUrl(detail.artist), 'file:///mirror/600.jpg');
  assert.equal(h.coverRequests.length, 1, 'offline local lookup does not initiate a cover request');
  h.state.offline = false; h.state.auth!.serverType = 'jellyfin';
  assert.equal(h.api.artistPortraitUrl(detail.artist), 'file:///mirror/600.jpg');
  h.state.auth!.serverType = 'navidrome';
  assert.equal(h.api.artistPortraitUrl({ id: 'artist', coverArt: 'https://external.test/full.jpg' }), 'https://external.test/full.jpg');
  assert.equal(h.coverRequests.length, 1, 'external artwork URLs are never passed as native artwork IDs');
});

test('the saved full hero is available with artist detail without waiting for artistInfo', async () => {
  const h = harness(); const waiting = deferred<typeof info>(); h.infoRequest(() => waiting.promise);
  h.save({ detail, coverKey: 'ar-hash', heroUri: 'file:///managed/full.jpg', detailAt: Date.now() });
  assert.equal((await h.api.getArtist('artist')).portraitUri, 'file:///managed/full.jpg');
  assert.equal(h.calls.info, 0); assert.equal(h.calls.detail, 0);
});

test('a changed artwork hash cannot reuse a cached full hero belonging to the previous photograph', async () => {
  const h = harness();
  h.save({ detail, info, coverKey: 'ar-old-hash', heroUri: 'file:///managed/old-photo.jpg', detailAt: Date.now(), infoAt: Date.now() });
  assert.deepEqual(plain(await h.api.getArtist('artist')), detail);
  assert.equal((await h.api.getArtistInfo('artist')).imageUrl, info.imageUrl);
});

test('background detail refresh preserves a matching full hero but publishes changed art without the old file', async () => {
  for (const changed of [false, true]) {
    const h = harness();
    h.save({ detail, info, coverKey: 'ar-hash', heroUri: 'file:///managed/full.jpg', detailAt: 0, infoAt: Date.now() });
    const fresh = { ...detail, artist: { ...detail.artist, name: 'Refreshed artist', coverArt: changed ? 'ar-new-hash' : 'ar-hash' } };
    h.detailRequest(async () => fresh);
    assert.equal((await h.api.getArtist('artist')).portraitUri, 'file:///managed/full.jpg');
    await h.refresh();
    const published = h.published.find((entry) => plain(entry[0]).join('|') === 'artist|artist');
    assert.ok(published);
    assert.deepEqual(plain(published[1]), changed ? fresh : { ...fresh, portraitUri: 'file:///managed/full.jpg' });
  }
});

test('cached full-photo file checks cannot publish to a replacement account', async () => {
  for (const query of ['getArtist', 'getArtistInfo']) {
    const h = harness(), file = deferred<void>();
    h.save({ detail, info, coverKey: 'ar-hash', heroUri: 'file:///managed/full.jpg', detailAt: Date.now(), infoAt: Date.now() });
    h.fileGate(file.promise); const read = h.api[query]('artist'); await tick();
    h.state.auth = { ...h.state.auth! }; file.resolve();
    await assert.rejects(read, /profile changed/);
    assert.equal(h.writes.length, 0); assert.equal(h.published.length, 0);
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
