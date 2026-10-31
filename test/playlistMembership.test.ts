import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { Playlist, Song } from '../src/api/subsonic';
import * as rules from '../src/lib/playlistMembership';

const song = (id: string): Song => ({ id, title: id, duration: 10 });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
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

test('partial membership counts unique selected IDs; additions skip duplicates and removals cover every matching instance', () => {
  assert.deepEqual(rules.presentIn(['a', 'a', 'x'], ['a', 'b', 'a']), ['a']);
  assert.equal(rules.membershipOf(['a', 'other'], ['a', 'b', 'a']), 'some');
  assert.equal(rules.membershipOf(['a'], ['a', 'a']), 'all');
  assert.equal(rules.membershipOf([], ['a']), 'none');
  assert.deepEqual(rules.missingFrom(['a', 'a'], [song('a'), song('b'), song('b'), song('c')]).map((value) => value.id), ['b', 'c']);
  assert.deepEqual(rules.indicesToRemove(['a', 'x', 'b', 'a', 'b'], ['b', 'a', 'a']), [4, 3, 2, 0]);
  assert.equal(rules.canEditTracks({ owner: 'me' }, 'me'), true);
  assert.equal(rules.canEditTracks({ owner: 'other' }, 'me'), false);
  assert.equal(rules.canEditTracks({ readonly: true, owner: 'me' }, 'me'), false);
  assert.equal(rules.completeTracklist({ songCount: 4 }, ['a', 'b']), false);
});

test('edit queue serializes the same playlist, releases failures, and does not block an unrelated playlist', async () => {
  const queue = new rules.PlaylistEditQueue();
  const first = deferred<void>(); const events: string[] = [];
  const a = queue.run('one', async () => { events.push('a'); await first.promise; throw new Error('network'); });
  const rejected = assert.rejects(a, /network/);
  const b = queue.run('one', async () => { events.push('b'); return 2; });
  const c = queue.run('two', async () => { events.push('c'); return 3; });
  await tick(); assert.deepEqual(events, ['a', 'c']); assert.equal(await c, 3);
  first.resolve(); await rejected; assert.equal(await b, 2); assert.deepEqual(events, ['a', 'c', 'b']);
  assert.equal(await queue.run('one', async () => 4), 4);
});

function harness(initial: string[] = ['a', 'b', 'a'], localApi: Record<string, unknown> = {}) {
  const originalAuth = { url: 'https://one.test', username: 'me' };
  const state = { auth: originalAuth as typeof originalAuth | null, offline: false };
  let profile = 'one';
  let tracklist = initial.map(song);
  let playlist: Playlist = { id: 'p', name: 'Test', owner: 'me' };
  const snapshot = () => ({ playlist: { songCount: tracklist.length, ...playlist }, songs: tracklist.map((value) => ({ ...value })) });
  const calls: { action: string; owner: unknown; id: string; value?: number | string }[] = [];
  const saves: any[] = [], invalidates: any[] = [], cached: any[] = [];
  let reader = async () => snapshot();
  let afterAdd = async (_id: string) => {};
  let afterRemove = async (_index: number) => {};
  const queueData: { playlists: Record<string, any>; songMeta: Record<string, Song> } = { playlists: {}, songMeta: {} };
  const stored = new Map<string, string[]>([['p', [...initial]]]);
  const versions: Record<string, string | undefined> = {};
  const mirror = {
    load: async () => {}, flush: async () => {},
    playlists: async () => [snapshot().playlist], playlistDetail: async () => snapshot(),
    playlistSongIds: async () => stored, playlistVersions: async () => versions,
    savePlaylistDetail: (...args: unknown[]) => saves.push(plain(args)),
  };
  const backend = {
    getPlaylist: async (owner: unknown, id: string) => { calls.push({ action: 'get', owner, id }); return reader(); },
    addToPlaylist: async (owner: unknown, id: string, value: string) => {
      calls.push({ action: 'add', owner, id, value }); tracklist.push(song(value)); await afterAdd(value);
    },
    removeFromPlaylist: async (owner: unknown, id: string, value: number) => {
      calls.push({ action: 'remove', owner, id, value }); tracklist.splice(value, 1); await afterRemove(value);
    },
    reorderPlaylist: async () => { throw new Error('Must never rewrite an online playlist'); },
  };
  const dependencies: Record<string, unknown> = {
    '@/store/auth': { useAuthStore: { getState: () => state }, profileScopeId: () => profile },
    '@/store/downloads': { getDownloadShelf: async () => ({}), useDownloads: { getState: () => ({ files: {} }) } },
    '@/store/libraryMirror': { useLibraryMirror: { getState: () => mirror } },
    '@/store/offlineQueue': { useOfflineQueue: { getState: () => ({ data: queueData, load: async () => {},
      rememberSongs: (songs: Song[]) => { for (const value of songs) queueData.songMeta[value.id] = value; },
      setPlaylist: (id: string, patch: object) => { queueData.playlists[id] = { ...queueData.playlists[id], ...patch }; },
    }) } },
    '@/store/settings': { useSettings: { getState: () => ({ hideUnavailableOffline: true }) } },
    '@/lib/query': { queryClient: { invalidateQueries: (value: unknown) => invalidates.push(value),
      setQueryData: (key: unknown, update: (value: unknown) => unknown) => cached.push([key, update([playlist])]) } },
    './backend': backend,
    '@/lib/playlistMembership': rules,
    '@/lib/localQueries': localApi,
    '@/store/libraries': { enabledFolderIds: () => ['visible-library-only'] },
  };
  for (const name of ['@/lib/localLibrary', '@/lib/perfLog', '@/lib/storage', '@/store/lastPlayed',
    '@/store/playHistory', './netGate', '@/lib/localLyrics', './navidrome', './subsonic', '@/lib/mediaCacheDb',
    'expo-file-system/legacy', '@/lib/netBudget', '@/store/songCache']) dependencies[name] = {};
  const api = load('api/data.ts', dependencies);
  return { api, state, originalAuth, mirror, queueData, stored, versions, calls, saves, invalidates, cached, snapshot,
    ids: () => tracklist.map((value) => value.id),
    setIds: (ids: string[]) => { tracklist = ids.map(song); },
    setPlaylist: (value: Partial<Playlist>) => { playlist = { ...playlist, ...value }; },
    setReader: (value: typeof reader) => { reader = value; },
    setAfterAdd: (value: typeof afterAdd) => { afterAdd = value; },
    setAfterRemove: (value: typeof afterRemove) => { afterRemove = value; },
    setProfile: (value: string) => { profile = value; },
  };
}

test('the data API adds only missing selected songs and leaves other entries and duplicate instances intact', async () => {
  const h = harness();
  assert.deepEqual(plain(await h.api.addSongsToPlaylist('p', [song('b'), song('c'), song('c')])), ['b', 'c']);
  assert.deepEqual(h.ids(), ['a', 'b', 'a', 'c']);
  assert.deepEqual(h.calls.filter((value) => value.action === 'add').map((value) => value.value), ['c']);
  assert.equal(h.calls.every((value) => value.owner === h.originalAuth), true);
  assert.deepEqual(h.saves[0][2].map((value: Song) => value.id), ['a', 'b', 'a', 'c']);
});

test('removing selected songs uses unfiltered server indices, descending and duplicate aware, without rewriting', async () => {
  const h = harness(['hidden-unavailable', 'a', 'b', 'a', 'other-library']);
  assert.deepEqual(plain(await h.api.removeSongsFromPlaylist('p', ['a', 'a'])), []);
  assert.deepEqual(h.ids(), ['hidden-unavailable', 'b', 'other-library']);
  assert.deepEqual(h.calls.filter((value) => value.action === 'remove').map((value) => value.value), [3, 1]);
  assert.equal(h.calls.filter((value) => value.action === 'get').length, 2);
  assert.equal(h.saves[0][1].songCount, 3);
});

test('both mutations recheck readonly and ownership against fresh server data and refuse incomplete raw lists', async () => {
  for (const metadata of [{ readonly: true }, { owner: 'another-user' }, { songCount: 10 }]) {
    for (const action of ['addSongsToPlaylist', 'removeSongsFromPlaylist']) {
      const h = harness(); h.setPlaylist(metadata);
      await assert.rejects(h.api[action]('p', action === 'addSongsToPlaylist' ? [song('c')] : ['a']), /cannot be edited|Playlist changed/);
      assert.equal(h.calls.some((value) => value.action !== 'get'), false);
      assert.equal(h.saves.length, 0);
    }
  }
});

test('an external playlist change between duplicate removals stops the batch before a wrong positional deletion', async () => {
  const h = harness(['a', 'x', 'a']);
  h.setAfterRemove(async () => { h.setIds(['someone-else-added', ...h.ids()]); });
  await assert.rejects(h.api.removeSongsFromPlaylist('p', ['a']), /Playlist changed/);
  assert.deepEqual(h.calls.filter((value) => value.action === 'remove').map((value) => value.value), [2]);
  assert.deepEqual(h.ids(), ['someone-else-added', 'a', 'x']);
  assert.equal(h.saves.length, 0);
});

test('late server reads cannot mutate or publish after account, profile, mode or menu replacement', async () => {
  for (const changed of ['auth', 'profile', 'offline', 'menu']) {
    for (const action of ['addSongsToPlaylist', 'removeSongsFromPlaylist']) {
      const h = harness(); const pending = deferred<ReturnType<typeof h.snapshot>>(); h.setReader(() => pending.promise);
      let menu = true;
      const work = h.api[action]('p', action === 'addSongsToPlaylist' ? [song('c')] : ['a'], { stillCurrent: () => menu });
      const rejected = assert.rejects(work, /Playlist (profile|menu) changed/); await tick();
      if (changed === 'auth') h.state.auth = { url: 'https://two.test', username: 'two' };
      else if (changed === 'profile') h.setProfile('two');
      else if (changed === 'offline') h.state.offline = true;
      else menu = false;
      pending.resolve(h.snapshot()); await rejected;
      assert.equal(h.calls.some((value) => value.action !== 'get'), false);
      assert.equal(h.saves.length, 0); assert.equal(h.cached.length, 0);
    }
  }
});

test('closing a menu after the first accepted add completes the original batch; switching accounts stops it', async () => {
  for (const switchAccount of [false, true]) {
    const h = harness(['a']); let menu = true;
    h.setAfterAdd(async () => { menu = false; if (switchAccount) h.state.auth = { url: 'https://two.test', username: 'two' }; });
    const work = h.api.addSongsToPlaylist('p', [song('b'), song('c')], { stillCurrent: () => menu });
    if (switchAccount) await assert.rejects(work, /Playlist profile changed/);
    else assert.deepEqual(plain(await work), ['b', 'c']);
    assert.deepEqual(h.ids(), switchAccount ? ['a', 'b'] : ['a', 'b', 'c']);
    assert.equal(h.calls.every((value) => value.owner === h.originalAuth), true);
    if (switchAccount) assert.equal(h.saves.length, 0);
  }
});

test('a rejected add remains retryable without duplicating an already committed entry', async () => {
  const h = harness(['a']); let fail = true;
  h.setAfterAdd(async () => { if (fail) { fail = false; throw new Error('response lost after commit'); } });
  await assert.rejects(h.api.addSongsToPlaylist('p', [song('b'), song('c')]), /response lost/);
  assert.deepEqual(h.ids(), ['a', 'b']);
  assert.deepEqual(plain(await h.api.addSongsToPlaylist('p', [song('b'), song('c')])), ['b', 'c']);
  assert.deepEqual(h.ids(), ['a', 'b', 'c']);
});

test('concurrent same-playlist additions serialize and do not duplicate a newly added selected song', async () => {
  const h = harness(['a']);
  await Promise.all([h.api.addSongsToPlaylist('p', [song('b')]), h.api.addSongsToPlaylist('p', [song('b'), song('c')])]);
  assert.deepEqual(h.ids(), ['a', 'b', 'c']);
  assert.equal(h.calls.filter((value) => value.action === 'add' && value.value === 'b').length, 1);
});

test('offline server edits preserve raw outbox IDs including missing files and enforce cached permissions', async () => {
  const h = harness(['a', 'unknown-file', 'a', 'x']); h.state.offline = true;
  h.queueData.playlists.p = { songIds: ['unknown-file', 'a', 'x', 'a'] };
  assert.deepEqual(plain(await h.api.removeSongsFromPlaylist('p', ['a'])), []);
  assert.deepEqual(plain(h.queueData.playlists.p.songIds), ['unknown-file', 'x']);
  assert.deepEqual(plain(await h.api.addSongsToPlaylist('p', [song('x'), song('b'), song('b')])), ['x', 'b']);
  assert.deepEqual(plain(h.queueData.playlists.p.songIds), ['unknown-file', 'x', 'b']);
  assert.ok(h.queueData.songMeta.b); assert.equal(h.calls.length, 0);
  h.setPlaylist({ readonly: true });
  await assert.rejects(h.api.removeSongsFromPlaylist('p', ['x']), /cannot be edited/);
  assert.deepEqual(plain(h.queueData.playlists.p.songIds), ['unknown-file', 'x', 'b']);
});

test('membership previews use raw cached or fresh IDs, bound request concurrency and ignore stale owners', async () => {
  const h = harness(['a', 'a', 'hidden']); const reports: unknown[] = [];
  h.versions.p = 'old'; h.stored.set('p', ['b']);
  const pending = deferred<ReturnType<typeof h.snapshot>>(); h.setReader(() => pending.promise);
  const work = h.api.playlistMembership([{ id: 'p', name: 'Test', changed: 'new' }], ['a', 'b', 'a'], (id: string, ids: string[]) => reports.push([id, ids]), () => false);
  await tick(); assert.deepEqual(plain(reports), [['p', ['b']]]);
  pending.resolve(h.snapshot()); await work; assert.deepEqual(plain(reports), [['p', ['b']], ['p', ['a']]]);
  const stale = deferred<ReturnType<typeof h.snapshot>>(); h.setReader(() => stale.promise);
  const staleWork = h.api.playlistMembership([{ id: 'p', name: 'Test', changed: 'new' }], ['a'], () => { throw new Error('old account publication'); }, () => false);
  // The cached mark is synchronous after storage reads, so stop its owner before those reads complete.
  h.setProfile('two'); stale.resolve(h.snapshot()); await staleWork;
});

function localHarness() {
  let profile = 'local';
  const records = (ids: string[]) => [{ id: 'lp_p', name: 'One', songIds: ids, createdAt: 1 },
    { id: 'lp_other', name: 'Other', songIds: ['keep-me'], createdAt: 2 }];
  const storage = new Map<string, string>([
    ['resonus.localPlaylists.local', JSON.stringify(records(['missing', 'a', 'x', 'a']))],
    ['resonus.localPlaylists.two', JSON.stringify(records(['two-account']))],
  ]);
  let reader = async (key: string) => storage.get(key) ?? null;
  let writer = async (key: string, value: string) => { storage.set(key, value); };
  const dependencies: Record<string, unknown> = {
    'expo-file-system/legacy': { documentDirectory: 'file:///app/' }, '@/i18n': {},
    '@/store/auth': { profileScopeId: () => profile, useAuthStore: { getState: () => ({ auth: null }) } },
    '@/store/playCounts': {}, '@/store/playHistory': {}, '@/lib/query': {}, '@/store/downloads': {}, './downloadsDb': {}, './localDb': {},
    '@/lib/storage': { getItem: (key: string) => reader(key), setItem: (key: string, value: string) => writer(key, value) },
    './localLibrary': { hashKey: (value: string) => value },
  };
  const api = load('lib/localQueries.ts', dependencies);
  return { api, storage, setProfile: (value: string) => { profile = value; },
    setReader: (value: typeof reader) => { reader = value; }, setWriter: (value: typeof writer) => { writer = value; } };
}

test('raw local membership/edit APIs preserve missing tracks, duplicate instances, and unrelated playlists', async () => {
  const h = localHarness();
  const lists: Map<string, string[]> = await h.api.playlistTracklists();
  assert.deepEqual(plain(lists.get('lp_p')), ['missing', 'a', 'x', 'a']);
  await h.api.editPlaylistTracklist('lp_p', (ids: string[]) => ids.filter((id) => id !== 'a'), () => true);
  const records = JSON.parse(h.storage.get('resonus.localPlaylists.local')!);
  assert.deepEqual(records[0].songIds, ['missing', 'x']); assert.deepEqual(records[1].songIds, ['keep-me']);
  await assert.rejects(h.api.editPlaylistTracklist('absent', () => [], () => true), /Playlist changed/);
});

test('late raw local reads do not contaminate the replacement profile cache or authorize an obsolete write', async () => {
  const h = localHarness(); const pending = deferred<string | null>();
  h.setReader(async (key) => key.endsWith('.local') ? pending.promise : h.storage.get(key) ?? null);
  const read = h.api.playlistTracklists(); const rejectedRead = assert.rejects(read, /Playlist profile changed/);
  const edit = h.api.editPlaylistTracklist('lp_p', () => [], () => true); const rejectedEdit = assert.rejects(edit, /Playlist profile changed/);
  await tick(); h.setProfile('two');
  assert.deepEqual(plain((await h.api.playlistTracklists()).get('lp_p')), ['two-account']);
  pending.resolve(h.storage.get('resonus.localPlaylists.local')!); await rejectedRead; await rejectedEdit;
  assert.deepEqual(plain((await h.api.playlistTracklists()).get('lp_p')), ['two-account']);
  assert.deepEqual(JSON.parse(h.storage.get('resonus.localPlaylists.local')!)[0].songIds, ['missing', 'a', 'x', 'a']);
});

test('an accepted local write captures its original storage key even if the account changes during persistence', async () => {
  const h = localHarness(); const entered = deferred<void>(), release = deferred<void>();
  h.setWriter(async (key, value) => { entered.resolve(); await release.promise; h.storage.set(key, value); });
  const work = h.api.editPlaylistTracklist('lp_p', (ids: string[]) => [...ids, 'accepted'], () => true);
  await entered.promise; h.setProfile('two'); release.resolve(); await work;
  assert.deepEqual(JSON.parse(h.storage.get('resonus.localPlaylists.two')!)[0].songIds, ['two-account']);
  assert.equal(JSON.parse(h.storage.get('resonus.localPlaylists.local')!)[0].songIds.at(-1), 'accepted');
  assert.deepEqual(plain((await h.api.playlistTracklists()).get('lp_p')), ['two-account']);
});

test('partial-failure recovery bypasses an unchanged mirror version and reads actual server membership', async () => {
  const h = harness(['a', 'b']); h.versions.p = 'same-version'; h.stored.set('p', ['a']);
  const reports: unknown[] = [];
  await h.api.playlistMembership([{ id: 'p', name: 'Test', changed: 'same-version' }], ['a', 'b'],
    (id: string, ids: string[]) => reports.push([id, ids]), () => false, { fresh: true });
  assert.equal(h.calls.filter((value) => value.action === 'get').length, 1);
  assert.deepEqual(plain(reports), [['p', ['a', 'b']]]);
});

test('the membership loader caps simultaneous server reads at three', async () => {
  const h = harness(['a']); let running = 0, peak = 0;
  const gates = Array.from({ length: 7 }, () => deferred<ReturnType<typeof h.snapshot>>()); let index = 0;
  h.setReader(async () => {
    const gate = gates[index++]; peak = Math.max(peak, ++running);
    const result = await gate.promise; running--; return result;
  });
  const lists = gates.map((_, n) => ({ id: `p-${n}`, name: `List ${n}` }));
  const work = h.api.playlistMembership(lists, ['a'], () => {}, () => false);
  await tick(); assert.equal(index, 3); assert.equal(peak, 3);
  for (let n = 0; n < gates.length; n++) { gates[n].resolve(h.snapshot()); await tick(); }
  await work; assert.equal(index, 7); assert.equal(peak, 3);
});

test('local playlist creation refuses a late old-profile read instead of writing it into another profile', async () => {
  const h = localHarness(); const pending = deferred<string | null>();
  h.setReader(async (key) => key.endsWith('.local') ? pending.promise : h.storage.get(key) ?? null);
  const work = h.api.createPlaylist('From old profile'); const rejected = assert.rejects(work, /Playlist profile changed/);
  await tick(); h.setProfile('two'); pending.resolve(h.storage.get('resonus.localPlaylists.local')!); await rejected;
  assert.equal(JSON.parse(h.storage.get('resonus.localPlaylists.two')!).length, 2);
});

test('pure local picker edits to different playlists share a profile lock and preserve both accepted changes', async () => {
  const local = localHarness(); const h = harness([], local.api);
  h.state.auth = null; h.state.offline = true;
  await Promise.all([
    h.api.addSongsToPlaylist('lp_p', [song('new')]),
    h.api.removeSongsFromPlaylist('lp_other', ['keep-me']),
  ]);
  const records = JSON.parse(local.storage.get('resonus.localPlaylists.local')!);
  assert.deepEqual(records[0].songIds, ['missing', 'a', 'x', 'a', 'new']);
  assert.deepEqual(records[1].songIds, []);
  assert.equal(h.calls.length, 0);
});
