import { completeDownloadedPlaylists } from '../src/lib/downloadedPlaylists';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { create as createStore } from 'zustand';

import { createCoverIndex } from '../src/lib/coverIndex';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function compile(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, __DEV__: false, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  } });
  return exports;
}

type Owner = { url: string; username: string; serverType: string };
function harness() {
  const owner = { url: 'https://one.test', username: 'one', serverType: 'navidrome' };
  const useAuthStore = createStore<{ auth: Owner | null; offline: boolean }>(() => ({ auth: owner, offline: false }));
  const index = createCoverIndex();
  const requests: { owner: Owner; id: string; size: number }[] = [];
  const imports: Record<string, unknown> = {
    '@/lib/downloadsDb': {},
    '@/lib/downloadedPlaylists': { completeDownloadedPlaylists },
    '@/lib/downloadedBrowse': { guardDownloadedRead: async (read: () => Promise<unknown>) => read() },
    '@/store/auth': { useAuthStore },
    '@/lib/localLibrary': { localCoverSize: index.size },
    '@/lib/localQueries': { coverUrl: index.uri },
    './backend': {
      COVER: { thumb: 200, card: 600, full: 1200 },
      coverArtUrl: (auth: Owner, id: string, size: number) => {
        requests.push({ owner: auth, id, size });
        return `${auth.url}/art/${id}?size=${size}`;
      },
    },
  };
  for (const name of ['@/store/downloads', '@/store/libraries', '@/lib/perfLog', '@/lib/query', '@/lib/storage',
    '@/store/lastPlayed', '@/store/libraryMirror', '@/store/offlineQueue', '@/store/playHistory', './netGate',
    '@/lib/localLyrics', '@/store/settings', '@/store/songCache', './navidrome', './subsonic', '@/lib/mediaCacheDb',
    'expo-file-system/legacy', '@/lib/netBudget', '@/lib/lyricsLookupError']) imports[name] = {};
  const data = compile('../src/api/data.ts', imports);
  const hook = compile('../src/hooks/usePlaylistCover.ts', {
    react: React,
    '@/api/data': data,
    '@/store/auth': { useAuthStore },
    '@/lib/localLibrary': { localCoverUrl: index.uri, subscribeLocalCover: index.subscribe },
  });
  return { data, hook, index, requests, useAuthStore };
}

test('the cover index preserves first registration, records replacement resolution and notifies only interested readers', () => {
  const index = createCoverIndex();
  let playlistChanges = 0, otherChanges = 0;
  const stop = index.subscribe('playlist', () => { playlistChanges++; });
  index.subscribe('other', () => { otherChanges++; });
  index.register('playlist', 'file:///legacy-600.jpg');
  assert.equal(index.size('playlist'), 0, 'old index entries are unknown resolution, never presumed HD');
  index.register('playlist', 'file:///scan-thumbnail.jpg', 600);
  assert.equal(index.uri('playlist'), 'file:///legacy-600.jpg', 'a later scan cannot replace the current image');
  assert.equal(playlistChanges, 1);
  index.replace('playlist', 'file:///hd-1200.jpg', 1200);
  assert.equal(index.uri('playlist'), 'file:///hd-1200.jpg');
  assert.equal(index.size('playlist'), 1200);
  assert.equal(playlistChanges, 2);
  index.replace('playlist', 'file:///hd-1200.jpg', 1200);
  assert.equal(playlistChanges, 2, 'identical cache registrations do not wake the image');
  assert.equal(otherChanges, 0, 'unrelated artwork is not invalidated by the upgrade');
  index.forget('playlist');
  assert.equal(index.uri('playlist'), undefined);
  assert.equal(index.size('playlist'), 0);
  assert.equal(playlistChanges, 3);
  stop(); index.register('playlist', 'file:///again.jpg', 1200);
  assert.equal(playlistChanges, 3, 'unmounted image listeners are released');
  index.register('other', 'file:///other.jpg', 600);
  index.clear();
  assert.equal(index.uri('playlist'), undefined);
  assert.equal(index.uri('other'), undefined);
  assert.equal(otherChanges, 2, 'profile clearing invalidates the other image once');
  assert.equal(index.uri('file:///direct.jpg'), 'file:///direct.jpg');
  assert.equal(index.uri('content://media/cover'), 'content://media/cover');
});

test('online playlist HD requests bypass both legacy and known 600px local files but reuse a completed 1200px upgrade', () => {
  for (const oldSize of [0, 600]) {
    const h = harness();
    h.index.register('pl-hash', 'file:///legacy-600.jpg', oldSize);
    assert.equal(h.data.playlistCoverUrl('pl-hash'), 'https://one.test/art/pl-hash?size=1200');
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].size, 1200);
    h.index.replace('pl-hash', 'file:///upgraded-1200.jpg', 1200);
    assert.equal(h.data.playlistCoverUrl('pl-hash'), 'file:///upgraded-1200.jpg');
    assert.equal(h.requests.length, 1, 'a completed HD file prevents repeated network image URLs');
  }
});

test('offline playlists retain their usable old artwork and direct artwork URIs never become server IDs', () => {
  const h = harness();
  h.index.register('pl-hash', 'file:///legacy-600.jpg', 600);
  h.useAuthStore.setState({ offline: true });
  assert.equal(h.data.playlistCoverUrl('pl-hash'), 'file:///legacy-600.jpg');
  assert.equal(h.requests.length, 0, 'an offline old file never starts a replacement request');
  for (const uri of ['https://covers.test/original.png', 'http://covers.test/original.jpg',
    'file:///direct-cover.jpg', 'content://media/pictures/123']) {
    assert.equal(h.data.playlistCoverUrl(uri), uri);
  }
  assert.equal(h.data.playlistCoverUrl(undefined), undefined);
  assert.equal(h.requests.length, 0, 'direct and absent artwork does not use the server cover endpoint');
  h.useAuthStore.setState({ auth: null, offline: false });
  assert.equal(h.data.playlistCoverUrl('pl-hash'), 'file:///legacy-600.jpg');
  assert.equal(h.data.playlistCoverUrl('no-local-file'), undefined);
  assert.equal(h.requests.length, 0, 'a local-only profile cannot create authenticated cover requests');
});

test('an already-open playlist switches to its newly committed HD URI without remounting or repainting for other covers', async () => {
  const h = harness(); h.index.register('pl-hash', 'file:///legacy-600.jpg', 600);
  let renders = 0, mounts = 0;
  function Probe() {
    const uri = h.hook.usePlaylistCover('pl-hash'); renders++;
    React.useEffect(() => { mounts++; return () => { mounts--; }; }, []);
    return React.createElement('image', { uri });
  }
  let renderer!: ReactTestRenderer;
  const shown = () => renderer.root.findByType('image').props.uri;
  try {
    await act(async () => { renderer = create(React.createElement(Probe)); });
    assert.equal(shown(), 'https://one.test/art/pl-hash?size=1200');
    const beforeUnrelated = renders;
    await act(async () => { h.index.replace('different-playlist', 'file:///other-1200.jpg', 1200); });
    assert.equal(renders, beforeUnrelated, 'one cover commit does not repaint every playlist');
    await act(async () => { h.index.replace('pl-hash', 'file:///committed-hd-v2.jpg', 1200); });
    assert.equal(shown(), 'file:///committed-hd-v2.jpg');
    assert.equal(mounts, 1, 'the existing page image updates without a screen remount');
    const afterUpgrade = renders;
    await act(async () => { h.index.replace('pl-hash', 'file:///committed-hd-v2.jpg', 1200); });
    assert.equal(renders, afterUpgrade, 'an unchanged cache identity leaves the page stable');
  } finally { await act(async () => { renderer?.unmount(); }); }
  assert.equal(mounts, 0);
});

test('mounted playlist artwork responds to offline changes and replacement-account credentials', async () => {
  const h = harness(); h.index.register('pl-hash', 'file:///legacy-600.jpg', 600);
  function Probe() { return React.createElement('image', { uri: h.hook.usePlaylistCover('pl-hash') }); }
  let renderer!: ReactTestRenderer;
  const shown = () => renderer.root.findByType('image').props.uri;
  try {
    await act(async () => { renderer = create(React.createElement(Probe)); });
    assert.equal(shown(), 'https://one.test/art/pl-hash?size=1200');
    const onlineLookups = h.requests.length;
    await act(async () => { h.useAuthStore.setState({ offline: true }); });
    assert.equal(shown(), 'file:///legacy-600.jpg');
    assert.equal(h.requests.length, onlineLookups, 'offline transition does not request any server artwork');
    await act(async () => { h.useAuthStore.setState({ offline: false }); });
    assert.equal(shown(), 'https://one.test/art/pl-hash?size=1200');
    const replacement = { url: 'https://two.test', username: 'two', serverType: 'navidrome' };
    await act(async () => { h.index.clear(); h.useAuthStore.setState({ auth: replacement }); });
    assert.equal(shown(), 'https://two.test/art/pl-hash?size=1200');
    assert.equal(h.requests.at(-1)?.owner, replacement);
    await act(async () => { h.useAuthStore.setState({ auth: null }); });
    assert.equal(shown(), undefined, 'signed-out pages cannot keep the previous authenticated image URL');
  } finally { await act(async () => { renderer?.unmount(); }); }
});
