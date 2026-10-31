import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { Playlist, Song, SubsonicAuth } from '../src/api/subsonic';

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const song = (id: string): Song => ({ id, title: id, duration: 180 });
function actualFunctions(path: string, names: string[]) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return names.map((name) => {
    const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node, `Missing production function ${name}`);
    return node.getText(ast);
  }).join('\n');
}
const functions = actualFunctions('api/data.ts', ['isOffline', 'auth', 'serverOffline', 'playlistEditContext',
  'canGoIntoPlaylist', 'createFreshServerPlaylist', 'createPlaylistFromSongs', 'flushOutbox', 'getCatalogSongPage']);
const dataExecutable = ts.transpileModule(`${functions}\nexports.fresh = createFreshServerPlaylist; exports.flush = flushOutbox;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const catalogExecutable = ts.transpileModule(`${actualFunctions('lib/musicToolsCatalog.ts', ['collectCatalogPages'])}\nexports.collect = collectCatalogPages;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type Call = { action: string; owner?: SubsonicAuth; id?: string; ids?: string[]; value?: unknown };
function harness() {
  const owner = { serverUrl: 'https://original.test', username: 'me', token: 'test-token', salt: 'test-salt' } as SubsonicAuth;
  const state = { auth: owner as SubsonicAuth | null, offline: false };
  const calls: Call[] = [], invalidations: unknown[] = [];
  let profile = 'original', helperCalls = 0;
  const server = { existing: [{ id: 'old', name: 'Imported', owner: 'me' }] as Playlist[],
    createdId: 'new', metadata: { id: 'new', name: 'Imported', owner: 'me', readonly: false } as Playlist,
    ids: [] as string[], transform: (ids: string[]) => [...ids],
    onList: async () => {}, onCreate: async () => {}, onGet: async (_index: number) => {}, gets: 0,
    onReorder: async () => {} };
  const folder = { ids: ['one', 'two'] as string[] | undefined, cap: 2,
    songs: { one: ['a', 'b', 'c', 'd', 'e'], two: ['f', 'g', 'h'] } as Record<string, string[]> };
  const outboxFile = (auth: SubsonicAuth) => `${auth.serverUrl}|${auth.username}`;
  const queued = { playlists: {} as Record<string, any>, favs: {}, ratings: {}, plays: [] };
  const queue = { data: queued, loadedFile: outboxFile(owner), load: async () => {}, isEmpty: () => false,
    clearPlaylists() { calls.push({ action: 'clear-outbox' }); queued.playlists = {}; },
    setPlaylist(id: string, edit: object) { calls.push({ action: 'retain-outbox', id }); queued.playlists[id] = plain(edit); },
    rememberSongs: (_songs: Song[]) => {}, clearFavs: () => assert.fail('no favorites are pending'),
    clearRatings: () => assert.fail('no ratings are pending'), removePlays: () => assert.fail('no plays are pending') };
  const backend = {
    async getPlaylists(auth: SubsonicAuth) { calls.push({ action: 'list', owner: auth }); await server.onList(); return plain(server.existing); },
    async createPlaylist(auth: SubsonicAuth, title: string) { calls.push({ action: 'create', owner: auth, value: title }); await server.onCreate(); return server.createdId; },
    async getPlaylist(auth: SubsonicAuth, id: string) {
      calls.push({ action: 'get', owner: auth, id });
      const detail = { playlist: { songCount: server.ids.length, ...server.metadata }, songs: server.ids.map(song) };
      await server.onGet(++server.gets); return plain(detail);
    },
    async reorderPlaylist(auth: SubsonicAuth, id: string, ids: string[]) {
      calls.push({ action: 'reorder', owner: auth, id, ids: [...ids] });
      server.ids = server.transform([...ids]); await server.onReorder();
    },
    async updatePlaylist(auth: SubsonicAuth, id: string, changes: unknown) { calls.push({ action: 'update', owner: auth, id, value: plain(changes) }); },
    async deletePlaylist(auth: SubsonicAuth, id: string) { calls.push({ action: 'delete', owner: auth, id }); },
    async getSongList(auth: SubsonicAuth, sort: string, count: number, offset: number, folderId?: string) {
      calls.push({ action: 'songs', owner: auth, id: folderId, value: { sort, count, offset } });
      return (folder.songs[folderId ?? 'all'] ?? []).slice(offset, offset + Math.min(count, folder.cap)).map(song);
    },
  };
  const context: Record<string, any> = { exports: {}, Subsonic: backend, Local: { getSongList: async (_sort: string, count: number, offset: number) => ['local-one', 'local-two'].slice(offset, offset + count).map(song) },
    profileScopeId: () => profile, useAuthStore: { getState: () => state }, useOfflineQueue: { getState: () => queue },
    queryClient: { invalidateQueries: (key: unknown) => { invalidations.push(plain(key)); } },
    enabledFolderIds: (auth: SubsonicAuth) => { assert.equal(auth, owner); return folder.ids; }, outboxFileFor: outboxFile,
    bump: () => {}, setTimeout, clearTimeout,
    require(name: string) { assert.equal(name, '@/lib/navidromeRepair'); return { repairIfMigrated: async () => {} }; } };
  runInNewContext(dataExecutable, context);
  const realFresh = context.createFreshServerPlaylist;
  context.createFreshServerPlaylist = (...args: unknown[]) => { helperCalls++; return realFresh(...args); };
  const mutations = () => calls.filter((call) => ['reorder', 'update', 'delete'].includes(call.action));
  const check = () => { if (state.auth !== owner || state.offline || profile !== 'original') throw new Error('Playlist profile changed'); };
  return { api: context.exports as Record<string, any>, context, owner, state, server, folder, queued, queue, calls, mutations, invalidations,
    check, helperCalls: () => helperCalls, file: outboxFile(owner), setProfile: (value: string) => { profile = value; } };
}

test('online imports trim the title and preserve ordered duplicate instances through fresh-create and verification', async () => {
  const h = harness(), ids = ['c', 'a', 'c', 'b'];
  assert.equal(await h.api.createPlaylistFromSongs('  Imported  ', ids.map(song)), 'new');
  assert.equal(h.helperCalls(), 1, 'online import must use the guarded shared creator');
  assert.deepEqual(h.calls.map((call) => call.action), ['list', 'create', 'get', 'reorder', 'get']);
  assert.deepEqual(h.mutations()[0].ids, ids); assert.deepEqual(h.server.ids, ids);
  assert.equal(h.calls.find((call) => call.action === 'create')?.value, 'Imported');
  assert.ok(h.calls.every((call) => call.owner === h.owner), 'all requests retain the captured account');
  assert.deepEqual(h.invalidations, [{ queryKey: ['playlists'] }, { queryKey: ['playlist', 'new'] }]);
});

test('legacy same-name ID fallback never rewrites the pre-existing playlist', async () => {
  const h = harness(); h.server.createdId = 'old';
  await assert.rejects(h.api.createPlaylistFromSongs('Imported', [song('a')]), /did not return a new playlist/);
  assert.deepEqual(h.calls.map((call) => call.action), ['list', 'create']);
  assert.deepEqual(h.mutations(), []); assert.deepEqual(h.invalidations, []);
});

test('a fresh ID must still be empty, writable, exact-title/exact-ID and owned by the captured user when owner is supplied', async () => {
  for (const variant of ['songs', 'count', 'readonly', 'owner', 'name', 'id']) {
    const h = harness();
    if (variant === 'songs') h.server.ids = ['someone-added-this'];
    if (variant === 'count') h.server.metadata.songCount = 5;
    if (variant === 'readonly') h.server.metadata.readonly = true;
    if (variant === 'owner') h.server.metadata.owner = 'another-account';
    if (variant === 'name') h.server.metadata.name = 'Other';
    if (variant === 'id') h.server.metadata.id = 'different';
    await assert.rejects(h.api.createPlaylistFromSongs('Imported', [song('a')]), /new playlist changed/, variant);
    assert.deepEqual(h.mutations(), [], variant); assert.deepEqual(h.invalidations, [], variant);
  }
  const legacy = harness(); delete legacy.server.metadata.owner;
  assert.equal(await legacy.api.createPlaylistFromSongs('Imported', [song('a')]), 'new', 'missing owner remains compatible only after new-ID and empty-list checks');
});

test('account/profile/offline changes during each pre-mutation await stop imports before any track write', async () => {
  for (const stage of ['list', 'create', 'get']) for (const change of ['account', 'profile', 'offline']) {
    const h = harness();
    const switchOwner = async () => {
      if (change === 'account') h.state.auth = { ...h.owner, serverUrl: 'https://different.test', username: 'other' };
      if (change === 'profile') h.setProfile('other');
      if (change === 'offline') h.state.offline = true;
    };
    if (stage === 'list') h.server.onList = switchOwner;
    if (stage === 'create') h.server.onCreate = switchOwner;
    if (stage === 'get') h.server.onGet = switchOwner;
    await assert.rejects(h.api.createPlaylistFromSongs('Imported', [song('a')]), /Playlist profile changed/, `${stage}/${change}`);
    assert.deepEqual(h.mutations(), [], `${stage}/${change}`);
    assert.ok(h.calls.every((call) => call.owner === h.owner)); assert.deepEqual(h.invalidations, []);
  }
});

test('the shared helper checks its initial owner and verifies a truly empty offline-created list without reordering', async () => {
  const stale = harness(); stale.state.auth = null;
  await assert.rejects(stale.api.fresh(stale.owner, 'Imported', ['a'], stale.check), /Playlist profile changed/);
  assert.deepEqual(stale.calls, []);
  const h = harness(); assert.equal(await h.api.fresh(h.owner, 'Imported', [], h.check), 'new');
  assert.deepEqual(h.calls.map((call) => call.action), ['list', 'create', 'get', 'get']);
  assert.deepEqual(h.mutations(), []);
});

test('servers that reorder or remove duplicate entries fail verification and never publish success', async () => {
  for (const transform of [(ids: string[]) => [...ids].sort(), (ids: string[]) => [...new Set(ids)]]) {
    const h = harness(); h.server.transform = transform;
    await assert.rejects(h.api.createPlaylistFromSongs('Imported', ['c', 'a', 'c'].map(song)), /could not be verified/);
    assert.equal(h.mutations().length, 1); assert.deepEqual(h.invalidations, []);
  }
});

test('invalid online imports issue no server mutation or read', async () => {
  for (const [title, songs] of [[' ', [song('a')]], ['Imported', []], ['Imported', [{ ...song('a'), url: 'https://radio.test' }]],
    ['Imported', [song('')]], ['Imported', Array.from({ length: 10001 }, () => song('a'))]] as [string, Song[]][]) {
    const h = harness(); await assert.rejects(h.api.createPlaylistFromSongs(title, songs), /Invalid playlist import/);
    assert.deepEqual(h.calls, []);
  }
});

test('reconnect creates offline imports through the same guard, then applies metadata only after order verification', async () => {
  const h = harness(), edit = { created: true, name: 'Imported', songIds: ['b', 'a', 'b'], comment: 'offline note', public: false };
  h.queued.playlists.tmp_local = edit;
  await h.api.flush(h.owner, h.file);
  assert.equal(h.helperCalls(), 1);
  assert.deepEqual(h.calls.map((call) => call.action), ['list', 'create', 'get', 'reorder', 'get', 'update', 'clear-outbox']);
  assert.deepEqual(h.mutations().map((call) => [call.action, call.id]), [['reorder', 'new'], ['update', 'new']]);
  assert.deepEqual(h.server.ids, edit.songIds); assert.deepEqual(h.queued.playlists, {});
});

test('outbox legacy-ID collisions and invalid fresh playlists retain the complete retryable edit without writing old tracks or metadata', async () => {
  for (const variant of ['legacy', 'nonempty', 'readonly', 'owner', 'verification']) {
    const h = harness(), edit = { created: true, name: 'Imported', songIds: ['b', 'a', 'b'], comment: 'keep', public: true };
    h.queued.playlists.tmp_local = plain(edit);
    if (variant === 'legacy') h.server.createdId = 'old';
    if (variant === 'nonempty') h.server.ids = ['other'];
    if (variant === 'readonly') h.server.metadata.readonly = true;
    if (variant === 'owner') h.server.metadata.owner = 'other';
    if (variant === 'verification') h.server.transform = (ids) => [...new Set(ids)];
    await h.api.flush(h.owner, h.file);
    assert.equal(h.helperCalls(), 1, variant);
    assert.deepEqual(h.queued.playlists, { tmp_local: edit }, variant);
    assert.equal(h.calls.some((call) => call.action === 'update'), false, variant);
    assert.equal(h.mutations().length, variant === 'verification' ? 1 : 0, variant);
  }
});

test('outbox account/offline/file handovers block track writes and never clear the new profile’s queue', async () => {
  for (const variant of ['account', 'offline', 'file']) {
    const h = harness(), edit = { created: true, name: 'Imported', songIds: ['a', 'a'] };
    h.queued.playlists.tmp_local = plain(edit);
    h.server.onList = async () => {
      if (variant === 'account') h.state.auth = { ...h.owner, serverUrl: 'https://other.test', username: 'other' };
      if (variant === 'offline') h.state.offline = true;
      if (variant === 'file') { h.queue.loadedFile = 'new-profile'; h.queued.playlists = { new_profile: { name: 'untouched' } }; }
    };
    await h.api.flush(h.owner, h.file);
    assert.equal(h.helperCalls(), 1, variant); assert.deepEqual(h.mutations(), [], variant);
    assert.equal(h.calls.some((call) => call.action === 'create'), false, variant);
    assert.deepEqual(h.queued.playlists, variant === 'file' ? { new_profile: { name: 'untouched' } } : { tmp_local: edit }, variant);
    if (variant === 'file') assert.equal(h.calls.some((call) => call.action === 'clear-outbox'), false);
  }
});

test('catalogue pages walk every enabled folder with actual short-page offsets instead of truncating a merged page', async () => {
  const h = harness(), context = { exports: {} as Record<string, any>, setTimeout };
  runInNewContext(catalogExecutable, context);
  const songs: Song[] = await context.exports.collect(h.api.getCatalogSongPage, () => true);
  assert.deepEqual(plain(songs.map((track) => track.id)), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.deepEqual(h.calls.map((call) => [call.id, (call.value as { offset: number }).offset]),
    [['one', 0], ['one', 2], ['one', 4], ['one', 5], ['two', 0], ['two', 2], ['two', 3]]);
  assert.ok(h.calls.every((call) => call.owner === h.owner));
});

test('empty enabled libraries and invalid/out-of-range catalogue requests cannot issue server reads', async () => {
  const h = harness(); h.folder.ids = [];
  assert.deepEqual(plain(await h.api.getCatalogSongPage(200, 0, 0)), { songs: [], sourceCount: 1 });
  h.folder.ids = ['one'];
  assert.deepEqual(plain(await h.api.getCatalogSongPage(200, 0, 1)), { songs: [], sourceCount: 1 });
  for (const args of [[0, 0, 0], [501, 0, 0], [2, -1, 0], [2, 0, -1], [2.5, 0, 0]])
    await assert.rejects(h.api.getCatalogSongPage(...args), /Invalid catalogue page/);
  assert.deepEqual(h.calls, []);
  h.state.offline = true;
  assert.deepEqual(plain(await h.api.getCatalogSongPage(1, 1, 0)), { songs: [song('local-two')], sourceCount: 1 });
  assert.deepEqual(plain(await h.api.getCatalogSongPage(1, 0, 1)), { songs: [], sourceCount: 1 });
  assert.deepEqual(h.calls, []);
});
