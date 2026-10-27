import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import ts from 'typescript';
import type { Song } from '../src/api/subsonic';

const song = (id: string): Song => ({ id, title: `Title ${id}`, artist: 'Artist', albumId: 'album', duration: 200 });
const detail = (songs = [song('b'), song('a'), song('b')]) => ({ playlist: { id: 'all', name: 'AllMusic', songCount: songs.length }, songs });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function load(path: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported: Record<string, any> = {};
  runInNewContext(output, { exports: exported, setTimeout, clearTimeout, __DEV__: false,
    require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected ${path} import ${name}`);
      return dependencies[name];
    } });
  return exported;
}

// The actual unified data layer runs against the installed TanStack cache.
// Native persistence and HTTP are controllable boundaries, never replacement
// playlist/annotation/cache policy. Network and mirror may finish in either order.
function serverHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } } });
  const state = { auth: { url: 'https://server.test', username: 'one' }, offline: false };
  let scope = 'server-one';
  const request = deferred<ReturnType<typeof detail>>();
  let saved: ReturnType<typeof detail> | undefined = detail();
  let readMirror = async () => saved;
  const queried: string[][] = [];
  const writes: unknown[][] = [];
  const mirrorSongs = new Map<string, Song>();
  const queue: { playlists?: Record<string, any>; songMeta?: Record<string, Song>; ratings?: Record<string, number> } = {};
  const files: Record<string, string> = {};
  const settings = { hideUnavailableOffline: false };
  let catalogReads = 0;
  const mirror = { load: async () => {}, playlistDetail: () => readMirror(), playlists: async () => [],
    songs: async (ids: string[]) => {
      queried.push(ids);
      const known = new Map((saved?.songs ?? []).map((value) => [value.id, value]));
      for (const [id, value] of mirrorSongs) known.set(id, value);
      return new Map(ids.filter((id) => known.has(id)).map((id) => [id, known.get(id)!]));
    },
    savePlaylistDetail: (...args: unknown[]) => { writes.push(args); } };
  const dependencies: Record<string, unknown> = {
    '@/store/auth': { useAuthStore: { getState: () => state }, profileScopeId: () => scope },
    '@/store/downloads': { useDownloads: { getState: () => ({ files }) }, getDownloadShelf: async () => ({}),
      getDownloadsCatalog: async () => { catalogReads++; return { songs: [], albums: [], artists: [] }; } },
    '@/store/libraryMirror': { useLibraryMirror: { getState: () => mirror } },
    '@/store/offlineQueue': { useOfflineQueue: { getState: () => ({ data: queue, load: async () => {} }) } },
    '@/store/settings': { useSettings: { getState: () => settings } },
    '@/store/songCache': { cachedUri: () => undefined },
    '@/lib/query': { queryClient: client },
    './backend': { getPlaylist: () => request.promise },
    '@/lib/localQueries': { coverUrl: () => undefined },
  };
  for (const name of ['@/store/libraries', '@/lib/localLibrary', '@/lib/perfLog', '@/lib/storage', '@/store/lastPlayed',
    '@/store/playHistory', './netGate', '@/lib/localLyrics', './navidrome', './subsonic']) dependencies[name] = {};
  const data = load('api/data.ts', dependencies);
  return { client, state, request, queue, queried, writes, mirrorSongs, files, settings,
    catalogReads: () => catalogReads, setScope: (value: string) => { scope = value; },
    setMirror: (value: ReturnType<typeof detail> | undefined) => { saved = value; },
    setReader: (reader: typeof readMirror) => { readMirror = reader; },
    getPlaylist: () => data.getPlaylist('all') as Promise<ReturnType<typeof detail>>,
    fetch: () => {
      const work = client.fetchQuery({ queryKey: ['playlist', 'all'], queryFn: () => data.getPlaylist('all') });
      // A failed assertion still runs cache cleanup, which cancels pending HTTP.
      // Keep that expected cancellation from becoming an unrelated rejection.
      void work.catch(() => {});
      return work;
    },
  };
}

test('a live playlist query shows the complete saved order before HTTP, then accepts the server refresh', async (t) => {
  const h = serverHarness(); t.after(() => h.client.clear());
  const observer = new QueryObserver(h.client, { queryKey: ['playlist', 'all'], enabled: false });
  const unsubscribe = observer.subscribe(() => {}); t.after(unsubscribe);
  const work = h.fetch(); await tick();
  assert.deepEqual(h.client.getQueryData(['playlist', 'all']), detail());
  assert.equal(observer.getCurrentResult().isLoading, false);
  assert.equal(observer.getCurrentResult().isFetching, true);
  assert.equal(h.client.getQueryState(['playlist', 'all'])!.dataUpdatedAt, 0, 'saved data cannot suppress server freshness');
  const fresh = detail([song('c'), song('b'), song('a'), song('b')]);
  h.request.resolve(fresh); await work;
  assert.deepEqual(h.client.getQueryData(['playlist', 'all']), fresh);
  assert.equal(h.writes.length, 1);
});

test('late disk data never overwrites a newer server result or an optimistic edit', async (t) => {
  for (const optimistic of [false, true]) {
    const h = serverHarness(); t.after(() => h.client.clear());
    const disk = deferred<ReturnType<typeof detail> | undefined>(); h.setReader(() => disk.promise);
    const work = h.fetch();
    const latest = detail([song('new'), song('new')]);
    if (optimistic) h.client.setQueryData(['playlist', 'all'], latest);
    else { h.request.resolve(latest); await work; }
    disk.resolve(detail()); await tick();
    assert.deepEqual(h.client.getQueryData(['playlist', 'all']), latest);
    if (optimistic) { h.request.resolve(latest); await work; }
  }
});

test('a warm query and a direct API caller do not read the large mirror again', async (t) => {
  for (const direct of [false, true]) {
    const h = serverHarness(); t.after(() => h.client.clear());
    let reads = 0; h.setReader(async () => { reads++; return detail(); });
    if (!direct) h.client.setQueryData(['playlist', 'all'], detail());
    const work = direct ? h.getPlaylist() : h.fetch(); await tick();
    assert.equal(reads, 0);
    h.request.resolve(detail()); await work;
  }
});

test('an unsuccessful refresh retains complete saved data, while a missing mirror invents no rows', async (t) => {
  for (const saved of [detail(), undefined]) {
    const h = serverHarness(); t.after(() => h.client.clear()); h.setMirror(saved);
    const work = h.fetch(); await tick();
    assert.deepEqual(h.client.getQueryData(['playlist', 'all']), saved);
    h.request.reject(new Error('offline transport'));
    await assert.rejects(work, /offline transport/);
    assert.deepEqual(h.client.getQueryData(['playlist', 'all']), saved);
    assert.equal(h.client.getQueryState(['playlist', 'all'])!.fetchStatus, 'idle');
  }
});

test('an account or mode change prevents a pending mirror read from publishing into the new query', async (t) => {
  for (const changed of ['profile', 'offline']) {
    const h = serverHarness(); t.after(() => h.client.clear());
    const disk = deferred<ReturnType<typeof detail> | undefined>(); h.setReader(() => disk.promise);
    const work = h.fetch();
    if (changed === 'profile') h.setScope('server-two'); else h.state.offline = true;
    disk.resolve(detail()); await tick();
    assert.equal(h.client.getQueryData(['playlist', 'all']), undefined);
    h.request.resolve(detail([song('fresh')])); await work;
    if (changed === 'profile') assert.equal(h.writes.length, 0, 'the old server cannot write the new profile mirror');
  }
});

test('an offline complete mirror resolves no song rows twice and retains duplicate order, local files and rating edits', async (t) => {
  const h = serverHarness(); t.after(() => h.client.clear()); h.state.offline = true;
  const songs = Array.from({ length: 20_000 }, (_, index) => song(String(index % 10_000)));
  h.setMirror(detail(songs)); h.files['0'] = 'file:///download/0'; h.queue.ratings = { '0': 4 };
  const result = await h.getPlaylist();
  assert.equal(result.songs.length, 20_000);
  assert.deepEqual(result.songs.map((value) => value.id), songs.map((value) => value.id));
  assert.equal(result.songs[0].localUri, 'file:///download/0');
  assert.equal(result.songs[0].userRating, 4);
  assert.equal(result.songs[1].unavailable, true);
  assert.equal(result.playlist.songCount, 20_000);
  assert.equal(h.queried.length, 0);
  assert.equal(h.catalogReads(), 0);
});

test('offline reordered and added occurrences reuse known metadata and query only genuinely missing ids', async (t) => {
  const h = serverHarness(); t.after(() => h.client.clear()); h.state.offline = true;
  h.queue.playlists = { all: { name: 'Offline edit', songIds: ['b', 'c', 'b', 'd', 'a'] } };
  h.queue.songMeta = { c: song('c'), b: { ...song('b'), title: 'Outbox title' } };
  h.mirrorSongs.set('d', song('d'));
  const result = await h.getPlaylist();
  assert.deepEqual(plain(h.queried), [['d']]);
  assert.equal(h.catalogReads(), 0);
  assert.deepEqual(result.songs.map((value) => value.id), ['b', 'c', 'b', 'd', 'a']);
  assert.equal(result.songs[0].title, 'Outbox title');
  assert.equal(result.playlist.name, 'Offline edit');
  h.queue.playlists.all.songIds = [];
  const empty = await h.getPlaylist();
  assert.equal(empty.songs.length, 0);
  assert.equal(empty.playlist.songCount, 0);
  assert.equal(h.queried.length, 1, 'empty edits cannot fall back to the old tracklist');
});

test('hide-unavailable still applies after reusing the complete offline mirror', async (t) => {
  const h = serverHarness(); t.after(() => h.client.clear()); h.state.offline = true;
  h.settings.hideUnavailableOffline = true; h.files.b = 'file:///b';
  const result = await h.getPlaylist();
  assert.deepEqual(result.songs.map((value) => value.id), ['b', 'b']);
  assert.equal(result.playlist.songCount, 2);
});

test('the actual local playlist query asks only for this list, retaining duplicates and skipping removed source songs', async () => {
  const requested: string[][] = [];
  let scans = 0;
  const lists = [{ id: 'all', name: 'AllMusic', songIds: ['b', 'a', 'b', 'removed'], createdAt: 1 },
    { id: 'other', name: 'Other', songIds: Array.from({ length: 20_000 }, (_, i) => `other-${i}`), createdAt: 2 },
    { id: 'empty', name: 'Empty', songIds: [], createdAt: 3 }];
  const dependencies: Record<string, unknown> = {
    'expo-file-system/legacy': { documentDirectory: 'file:///app/' }, '@/i18n': {},
    '@/store/auth': { profileScopeId: () => 'local', useAuthStore: { getState: () => ({ auth: null, offlineSource: { mode: 'device' } }) } },
    '@/store/playCounts': {}, '@/store/playHistory': {}, '@/lib/query': { queryClient: { invalidateQueries() {} } },
    '@/lib/storage': { getItem: async () => JSON.stringify(lists) }, '@/store/downloads': {}, './downloadsDb': {},
    './localDb': { songsByIds: async (_source: unknown, ids: string[]) => {
      requested.push(ids); return new Map([['a', song('a')], ['b', song('b')]]);
    } },
    './localLibrary': { hashKey: (value: string) => value, ensureScanned: async () => {
      scans++; return { src: { mode: 'device' }, scanned: false };
    } },
  };
  const local = load('lib/localQueries.ts', dependencies);
  const result = await local.getPlaylist('all');
  assert.equal(requested.length, 1);
  assert.equal(requested[0].length, 4, 'other playlists must not be transferred or parsed for this screen');
  assert.deepEqual(plain(requested), [['b', 'a', 'b', 'removed']]);
  assert.deepEqual(plain(result.songs.map((value: Song) => value.id)), ['b', 'a', 'b']);
  assert.equal(result.playlist.songCount, 3);
  await local.getPlaylist('empty');
  assert.equal(scans, 1, 'an empty list need not open or scan the catalog');
  assert.equal(requested.length, 1);
});
