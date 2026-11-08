import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import { completeDownloadedPlaylists } from '../src/lib/downloadedPlaylists';

test('downloaded playlist marks require every occurrence, never an empty or unknown list', () => {
  const lists = new Map([['complete', ['a', 'a', 'b']], ['partial', ['a', 'missing']], ['empty', []]]);
  assert.deepEqual([...completeDownloadedPlaylists(lists, { a: 'a.mp3', b: 'b.mp3' }, [], {}, {})], ['complete']);
  assert.equal(lists.get('complete')!.length, 3, 'checking must not deduplicate or mutate the source playlist');
});
test('same file count with a different song changes complete marks', () => {
  const lists = new Map([['one', ['a']], ['two', ['b']]]);
  assert.deepEqual([...completeDownloadedPlaylists(lists, { a: 'a' }, [], {}, {})], ['one']);
  assert.deepEqual([...completeDownloadedPlaylists(lists, { b: 'b' }, [], {}, {})], ['two']);
});
test('a stale cached membership cannot badge a fresh summary, even at the same song count', () => {
  const lists = new Map([['p', ['a']]]);
  assert.equal(completeDownloadedPlaylists(lists, { a: 'a' }, [{ id: 'p', name: 'P', songCount: 1, changed: 'new' }], { p: 'old' }, {}).size, 0);
  assert.equal(completeDownloadedPlaylists(lists, { a: 'a' }, [{ id: 'p', name: 'P', songCount: 2 }], {}, {}).size, 0);
});
test('offline replacements, creations and deletions own membership before old mirror versions', () => {
  const lists = new Map([['edited', ['missing']], ['deleted', ['a']], ['emptied', ['a']]]);
  const result = completeDownloadedPlaylists(lists, { a: 'a' }, [{ id: 'edited', name: 'P', songCount: 8, changed: 'old' }], {}, {
    edited: { songIds: ['a'] }, created: { songIds: ['a', 'a'] }, deleted: { deleted: true }, emptied: { songIds: [] },
  });
  assert.deepEqual([...result], ['edited', 'created']);
});

const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function guardHarness() {
  const first = { id: 'A' }, auth = createStore(() => ({ auth: first, offlineSource: undefined as unknown }));
  const exports: Record<string, any> = {};
  runInNewContext(compile(readFileSync(new URL('../src/lib/downloadedBrowse.ts', import.meta.url), 'utf8')), {
    exports, require: () => ({ useAuthStore: auth, profileScopeId: () => auth.getState().auth.id }),
  });
  return { read: exports.guardDownloadedRead as <T>(read: () => Promise<T>, expectedScope?: string) => Promise<T>, auth, first };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve };
}
test('late downloaded SQL results reject account/source replacement including A→B→A', async () => {
  for (const change of ['account', 'ABA', 'source']) {
    const h = guardHarness(), gate = deferred<string[]>(), work = h.read(() => gate.promise);
    const rejected = assert.rejects(work, /profile changed/);
    if (change === 'source') h.auth.setState({ offlineSource: { mode: 'folder', uris: ['new'] } });
    else {
      h.auth.setState({ auth: { id: 'B' } });
      if (change === 'ABA') h.auth.setState({ auth: h.first });
    }
    gate.resolve(['old-song']); await rejected;
  }
});
test('an old query retry rejects its departed scope before touching a new account database', async () => {
  const h = guardHarness(); let reads = 0; h.auth.setState({ auth: { id: 'B' } });
  await assert.rejects(h.read(async () => { reads++; return []; }, 'A'), /profile changed/);
  assert.equal(reads, 0);
});

test('accepted downloaded SQL reads preserve errors instead of caching a false empty result', async () => {
  const h = guardHarness(), rows = ['song'];
  assert.equal(await h.read(async () => rows), rows);
  await assert.rejects(h.read(async () => { throw new Error('SQLite failure'); }), /SQLite failure/);
});

function playlistReader(sqlFiles: Record<string, string> = { a: 'a' }) {
  const h = guardHarness(), gate = deferred<void>();
  let reads = 0;
  const directories: string[] = [];
  const files = sqlFiles, mirror = { flush: () => gate.promise,
    playlistSongIds: async () => { reads++; return new Map([['p', ['a']]]); },
    playlistVersions: async () => ({ p: 'v1' }), playlists: async () => [{ id: 'p', name: 'P', songCount: 1, changed: 'v1' }],
  };
  const ast = ts.createSourceFile('data.ts', readFileSync(new URL('../src/api/data.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'downloadedPlaylistIds')!;
  const api: Record<string, any> = {};
  runInNewContext(compile(fn.getText(ast)), { exports: api, guardDownloadedRead: h.read, useAuthStore: h.auth, profileScopeId: () => h.auth.getState().auth.id,
    loadMirror: async () => {}, useLibraryMirror: { getState: () => mirror },
    activeServerDir: () => h.auth.getState().auth.id, downloadedFiles: async (dir: string) => { directories.push(dir); return files; },
    // The store is deliberately stale from account A while B's SQL is ready.
    useDownloads: { getState: () => ({ files: { a: 'old-A-file' }, hydrated: true }) }, useOfflineQueue: { getState: () => ({ data: { playlists: {} } }) },
    queryClient: { getQueryData: () => undefined }, completeDownloadedPlaylists });
  return { ...h, start: () => api.downloadedPlaylistIds() as Promise<Set<string>>, release: () => gate.resolve(), reads: () => reads, directories };
}
test('the real downloaded playlist reader flushes pending membership then reads SQL ids only', async () => {
  const h = playlistReader(), work = h.start(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.reads(), 0); h.release(); assert.deepEqual([...(await work)], ['p']); assert.equal(h.reads(), 1);
});
test('a newly active account badges from its own SQL files, never the previous hydrated store with colliding ids', async () => {
  const h = playlistReader({ b: 'B-file' }); h.auth.setState({ auth: { id: 'B' } });
  const work = h.start(); h.release();
  assert.deepEqual([...(await work)], []);
  assert.deepEqual(h.directories, ['B']);
});
test('the real downloaded playlist reader abandons a profile change during its flush', async () => {
  const h = playlistReader(), work = h.start(), rejected = assert.rejects(work, /profile changed/);
  await Promise.resolve(); await Promise.resolve(); h.auth.setState({ auth: { id: 'B' } }); h.release();
  await rejected; assert.equal(h.reads(), 0);
});

function summariesReader() {
  const h = guardHarness(), gate = deferred<{ id: string; name: string }[]>(), writes: string[] = [];
  let offline = false;
  const ast = ts.createSourceFile('data.ts', readFileSync(new URL('../src/api/data.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'getPlaylists')!;
  const api: Record<string, any> = {};
  runInNewContext(compile(fn.getText(ast)), { exports: api, guardDownloadedRead: h.read, useAuthStore: h.auth,
    auth: () => h.auth.getState().auth, isOffline: () => offline, profileScopeId: () => h.auth.getState().auth.id,
    Subsonic: { getPlaylists: (owner: unknown) => { assert.equal(owner, h.first); return gate.promise; } },
    useLibraryMirror: { getState: () => ({ savePlaylists: () => writes.push('mirror') }) },
    useLastPlayed: { getState: () => ({ forgetMissing: () => writes.push('history') }) },
    prefetchPlaylistDetails: async () => { writes.push('prefetch'); },
  });
  return { ...h, writes, start: () => api.getPlaylists() as Promise<unknown>,
    complete: () => gate.resolve([{ id: 'p', name: 'P' }]), offline: () => { offline = true; } };
}
test('the real playlist summary request rejects departed accounts before mirror, history or prefetch writes', async () => {
  for (const change of ['account', 'ABA', 'credentials', 'offline']) {
    const h = summariesReader(), work = h.start(), rejected = assert.rejects(work, /profile changed/);
    if (change === 'offline') h.offline();
    else {
      h.auth.setState({ auth: { id: change === 'credentials' ? 'A' : 'B' } });
      if (change === 'ABA') h.auth.setState({ auth: h.first });
    }
    h.complete(); await rejected; assert.deepEqual(h.writes, []);
  }
});
test('an accepted playlist summary still populates the correct mirror and schedules its normal prefetch', async () => {
  const h = summariesReader(), work = h.start(); h.complete(); await work;
  assert.deepEqual(h.writes, ['mirror', 'history', 'prefetch']);
});

function hookHarness() {
  let state = { auth: {}, files: { a: 'file' }, hydrated: true, data: { playlists: {} } }, profile = 'A';
  const invalidated: unknown[][] = [], options: any[] = [], slots: any[] = [];
  let cursor = 0, listener: ((event: any) => void) | undefined;
  const client = { invalidateQueries: ({ queryKey }: any) => { invalidated.push(queryKey); return Promise.resolve(); },
    getQueryCache: () => ({ subscribe: (next: (event: any) => void) => { listener = next; return () => { listener = undefined; }; } }) };
  const select = (selector: (value: unknown) => unknown) => selector(state);
  const imports: Record<string, unknown> = {
    '@tanstack/react-query': { useQueryClient: () => client, useQuery: (value: unknown) => { options.push(value); return { data: undefined }; } },
    react: { useEffect: (create: () => unknown, deps: unknown[]) => {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.cleanup?.(); slot.cleanup = create(); slot.deps = deps;
      }
    } },
    '@/api/data': { downloadedPlaylistIds: () => Promise.resolve(new Set()) },
    '@/store/auth': { useAuthStore: select, profileScopeId: () => profile },
    '@/store/downloads': { useDownloads: select }, '@/store/offlineQueue': { useOfflineQueue: select },
  };
  const api: Record<string, any> = {};
  runInNewContext(compile(readFileSync(new URL('../src/hooks/useDownloadedPlaylists.ts', import.meta.url), 'utf8')), {
    exports: api, require: (name: string) => { assert.ok(name in imports, name); return imports[name]; },
  });
  return { render: () => { cursor = 0; return api.useDownloadedPlaylistState(); }, invalidated, options,
    files: () => { state = { ...state, files: { b: 'file' } as any }; },
    membership: () => { state = { ...state, data: { playlists: { p: { songIds: ['b'] } } } }; },
    switch: () => { profile = 'B'; state = { ...state, auth: {} }; },
    event: (key: string, action = 'success') => listener?.({ type: 'updated', action: { type: action }, query: { queryKey: [key] } }),
  };
}
test('the real mark hook invalidates equal-count file swaps and offline membership edits', () => {
  const h = hookHarness(); h.render(); h.invalidated.length = 0; h.render(); assert.equal(h.invalidated.length, 0);
  h.files(); h.render(); assert.equal(h.invalidated.length, 1);
  h.membership(); h.render(); assert.equal(h.invalidated.length, 2);
});
test('playlist query success invalidates marks, never download-query completion or unrelated events', () => {
  const h = hookHarness(); h.render(); h.invalidated.length = 0;
  h.event('downloadedPlaylists'); h.event('playlist', 'fetch'); h.event('album'); assert.equal(h.invalidated.length, 0);
  h.event('playlist'); h.event('playlists'); assert.equal(h.invalidated.length, 2);
  h.switch(); h.render(); assert.equal(h.options.at(-1).queryKey[1], 'B');
  h.invalidated.length = 0; h.event('playlist'); assert.equal(h.invalidated[0][1], 'B');
});
