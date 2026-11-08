import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Query from '@tanstack/react-query';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import type { Album, Song } from '../src/api/subsonic';
import { firstArtistSongs, loadArtistSongPreview, ARTIST_SONG_PREVIEW_ALBUM_BUDGET } from '../src/lib/artistSongPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const song = (id: string): Song => ({ id, title: id });
const albums = (...ids: string[]): Album[] => ids.map((id) => ({ id, name: id }));
const ticks = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 1)); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, setTimeout, clearTimeout, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unknown ${path} dependency ${name}`); return dependencies[name];
  } }); return exports;
}

test('a warm complete artist list supplies seven unique tracks without copying or visiting its remaining catalogue', async () => {
  const complete = [...Array.from({ length: 8 }, (_, i) => song(String(i)))];
  Object.defineProperty(complete, 7, { get() { throw new Error('Should not scan a large catalogue past seven'); } });
  const result = await loadArtistSongPreview(albums('one', 'two'), {
    current: () => true, complete: () => complete, read: async () => { throw new Error('No album request needed'); },
  });
  assert.deepEqual(result.map((track) => track.id), ['0', '1', '2', '3', '4', '5', '6']);
  assert.deepEqual(firstArtistSongs([song('a'), song('a'), song('b')]).map((track) => track.id), ['a', 'b']);
});

test('cold preview reads only enough own albums in running order, never starts concurrent excess requests, and leaves full-list cache untouched', async () => {
  const calls: string[] = []; let running = 0, peak = 0;
  const result = await loadArtistSongPreview(albums('one', 'two', 'never'), {
    current: () => true, complete: () => undefined,
    read: async (album) => { calls.push(album.id); running++; peak = Math.max(peak, running); await Promise.resolve(); running--;
      return (album.id === 'one' ? ['a', 'b', 'a'] : ['c', 'd', 'e', 'f', 'g', 'h']).map(song); },
  });
  assert.deepEqual(calls, ['one', 'two']); assert.equal(peak, 1);
  assert.deepEqual(result.map((track) => track.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('empty/corrupt catalogues have a finite album budget, failures preserve the first-seven gap, and cancellation stops further albums', async () => {
  let reads = 0;
  assert.deepEqual(await loadArtistSongPreview(albums(...Array.from({ length: 1000 }, (_, i) => String(i))), {
    current: () => true, complete: () => undefined, read: async () => { reads++; return []; },
  }), []); assert.equal(reads, ARTIST_SONG_PREVIEW_ALBUM_BUDGET);
  reads = 0; await assert.rejects(loadArtistSongPreview(albums('failed', 'must-not-skip'), {
    current: () => true, complete: () => undefined, read: async () => { reads++; throw new Error('Offline'); },
  }), /Offline/); assert.equal(reads, 1);
  let current = true; reads = 0;
  await assert.rejects(loadArtistSongPreview(albums('one', 'two'), {
    current: () => current, complete: () => undefined, read: async () => { reads++; current = false; return [song('a')]; },
  }), /changed/); assert.equal(reads, 1);
});

function hookHarness(own = albums('one', 'two', 'never')) {
  const first = { username: 'A' };
  const auth = createStore<any>(() => ({ auth: first, offline: false, autoOffline: false, offlineSource: null }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth?.username ?? 'local' };
  const owner = load('../src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: Infinity } } });
  const reads: string[] = [];
  let read = async (id: string) => ({ album: { id, name: id }, songs: (id === 'one' ? ['a', 'b', 'a'] : ['c', 'd', 'e', 'f', 'g', 'h']).map(song) });
  const api = load('../src/hooks/useArtistSongPreview.ts', { react: React, '@tanstack/react-query': Query,
    '@/api/data': { getAlbum: (id: string) => { reads.push(id); return read(id); } }, '@/lib/artistSongPreview': { loadArtistSongPreview },
    '@/lib/localLibrary': { folderSetKey: (uris: string[]) => [...uris].sort().join('|') }, '@/lib/lyricOwner': owner, '@/store/auth': authModule });
  let enabled = true, latest: any;
  function Probe() { latest = api.useArtistSongPreview('artist', own, enabled); return null; }
  const tree = () => React.createElement(QueryClientProvider, { client }, React.createElement(Probe));
  return { first, auth, client, own, reads, tree, latest: () => latest,
    enable: (value: boolean) => { enabled = value; }, read: (value: typeof read) => { read = value; } };
}

test('the actual hook reuses the existing full-list and album query keys without fetching or writing a partial full list', async () => {
  for (const complete of [true, false]) {
    const h = hookHarness(); let root!: ReactTestRenderer;
    const key = ['artistSongs', 'artist', 'one,two,never'];
    const all = Array.from({ length: 2000 }, (_, i) => song(String(i)));
    if (complete) h.client.setQueryData(key, all);
    else for (const [id, ids] of [['one', ['a', 'b']], ['two', ['c', 'd', 'e', 'f', 'g', 'h']]] as const) {
      h.client.setQueryData(['album', id], { album: { id, name: id }, songs: ids.map(song) });
    }
    try {
      await act(async () => { root = create(h.tree()); });
      await act(ticks);
      assert.equal(h.latest().songs.length, 7); assert.deepEqual(h.reads, []);
      assert.equal(h.client.getQueryData(key), complete ? all : undefined);
    } finally { await act(async () => root?.unmount()); h.client.clear(); }
  }
});

test('the actual hook stops on blur and rejects A to B to A instead of publishing old rows or reading the next album', async () => {
  for (const cancel of ['blur', 'aba'] as const) {
    const h = hookHarness(), waiting = deferred<any>(); h.read(() => waiting.promise); let root!: ReactTestRenderer;
    try {
      await act(async () => { root = create(h.tree()); }); await act(ticks); assert.deepEqual(h.reads, ['one']);
      await act(async () => {
        if (cancel === 'blur') { h.enable(false); root.update(h.tree()); }
        else { h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.first }); }
      });
      await act(async () => { waiting.resolve({ album: { id: 'one' }, songs: [song('old')] }); await ticks(); });
      assert.deepEqual(h.reads, ['one']); assert.equal(h.latest().songs.length, 0);
      if (cancel === 'aba') assert.equal(h.client.getQueryData(['album', 'one']), undefined, 'old account response cannot become shared album data');
      else assert.equal(h.latest().isPending, false);
    } finally { await act(async () => root?.unmount()); h.client.clear(); }
  }
});

test('local-folder previews reread the active offline catalogue instead of borrowing another folder set legacy cache', async () => {
  const h = hookHarness(albums('one')); let root!: ReactTestRenderer;
  h.auth.setState({ auth: null, offline: true, offlineSource: { mode: 'folder', uris: ['content://new'] } });
  h.client.setQueryData(['artistSongs', 'artist', 'one'], [song('stale-full')]);
  h.client.setQueryData(['album', 'one'], { album: { id: 'one' }, songs: [song('stale-album')] });
  h.read(async () => ({ album: { id: 'one', name: 'one' }, songs: [song('current-local')] }));
  try {
    await act(async () => { root = create(h.tree()); }); await act(ticks);
    assert.deepEqual(h.reads, ['one']); assert.deepEqual(h.latest().songs.map((value: Song) => value.id), ['current-local']);
  } finally { await act(async () => root?.unmount()); h.client.clear(); }
});

test('the production data getAlbum checks auth epoch before mirror/download writes and uses the original account on success', async () => {
  for (const change of ['none', 'other', 'aba'] as const) {
    const first = { username: 'A' }, state = createStore<any>(() => ({ auth: first, offline: false, offlineSource: null }));
    const authModule = { useAuthStore: state, profileScopeId: () => state.getState().auth.username };
    const guard = load('../src/lib/downloadedBrowse.ts', { '@/store/auth': authModule });
    const waiting = deferred<any>(), writes: unknown[] = [], requests: unknown[] = [];
    const source = ts.createSourceFile('data.ts', readFileSync(new URL('../src/api/data.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'getAlbum')!;
    const exported: Record<string, any> = {};
    runInNewContext(ts.transpileModule(fn.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      exports: exported, isOffline: () => state.getState().offline, auth: () => state.getState().auth,
      guardDownloadedRead: guard.guardDownloadedRead, Subsonic: { getAlbum: (owner: unknown) => { requests.push(owner); return waiting.promise; } },
      useLibraryMirror: { getState: () => ({ saveAlbum: () => writes.push('mirror') }) }, useDownloads: { getState: () => ({}) },
      noteDownloadedAlbum: (owner: unknown) => writes.push(owner),
    });
    const work = exported.getAlbum('one');
    const rejected = change === 'none' ? undefined : assert.rejects(work, /changed/);
    if (change !== 'none') state.setState({ auth: { username: 'B' } });
    if (change === 'aba') state.setState({ auth: first });
    waiting.resolve({ album: { id: 'one' }, songs: [song('a')] });
    if (rejected) await rejected; else await work;
    assert.deepEqual(requests, [first]); assert.deepEqual(writes, change === 'none' ? ['mirror', first] : []);
  }
});

test('the production data getAlbum remains a local-only read in offline mode', async () => {
  const source = ts.createSourceFile('data.ts', readFileSync(new URL('../src/api/data.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'getAlbum')!;
  const exported: Record<string, any> = {}; let local = 0;
  runInNewContext(ts.transpileModule(fn.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: exported, isOffline: () => true, serverOffline: () => false,
    guardDownloadedRead: (read: () => Promise<unknown>) => read(), Local: { getAlbum: async () => { local++; return { songs: [song('local')] }; } },
    Subsonic: { getAlbum: () => { throw new Error('Offline preview cannot use HTTP'); } },
  });
  assert.equal((await exported.getAlbum('one')).songs[0].id, 'local'); assert.equal(local, 1);
});
