import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import type { Song } from '../src/api/subsonic';
import { recommendationSong } from '../src/lib/dailyRecommendations';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  let state: any = { auth: { username: 'one', serverType: 'navidrome' }, offline: false, offlineSource: null };
  let active = 0, peak = 0, current = true;
  const calls = { song: [] as string[], album: [] as string[], downloads: [] as string[][], local: [] as unknown[][] };
  const fresh = new Map<string, Song>();
  const imports: Record<string, unknown> = {
    '@/api/data': { getAlbum: async (id: string) => {
      calls.album.push(id); await turn(); return { album: { id }, songs: [...fresh.values()].filter((song) => song.albumId === id) };
    }, markUnplayableOffline: (songs: Song[]) => songs },
    '@/api/subsonic': { getSong: async (_owner: unknown, id: string) => {
      calls.song.push(id); active++; peak = Math.max(peak, active); await turn(); active--; return fresh.get(id) ?? null;
    } },
    '@/lib/downloadsDb': { songsByIds: async (_dir: string, ids: string[]) => { calls.downloads.push(ids); return fresh; } },
    '@/lib/localDb': { songsByIds: async (source: unknown, ids: string[]) => { calls.local.push([source, ids]); return fresh; } },
    '@/lib/localLibrary': { folderSetKey: (uris: string[]) => [...uris].sort().join('|'), localSource: (mode: string, key: string) => ({ mode, key }) },
    '@/lib/dailyRecommendations': { recommendationSong },
    '@/store/downloads': { activeServerDir: () => 'file:///current-profile/' },
    '@/store/auth': { useAuthStore: { getState: () => state } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/recommendationPlaybackSource.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Map, Set, Promise, require(id: string) { const customization = defaultCustomizationBoundary(id); if (customization) return customization; assert.ok(Object.hasOwn(imports, id), id); return imports[id]; } });
  return { fresh, calls, peak: () => peak, setState: (value: unknown) => { state = value; }, stop: () => { current = false; },
    resolve: (saved: Song[]) => exports.currentRecommendationSongs(saved, () => current) as Promise<Map<string, Song>> };
}

test('the real online recommendation source admits safe same-profile IDs without delaying playback for metadata requests', async () => {
  const h = harness(), saved = Array.from({ length: 24 }, (_, index) => ({ id: String(index), title: String(index) }));
  for (const item of saved) h.fresh.set(item.id, { ...item, title: `Current ${item.id}` });
  const resolved = await h.resolve(saved);
  assert.equal(h.peak(), 0); assert.equal(h.calls.song.length, 0); assert.equal(resolved.size, 24);
  assert.equal(h.calls.album.length + h.calls.downloads.length + h.calls.local.length, 0);
  assert.equal(resolved.get('0')!.title, '0');
});

test('offline and local recommendation playback uses one exact-ID SQL read and current file paths', async () => {
  const saved = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const downloaded = harness(); downloaded.setState({ auth: { username: 'one' }, offline: true });
  downloaded.fresh.set('a', { id: 'a', title: 'A', localUri: 'file:///current/a.mp3' });
  const offline = await downloaded.resolve(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(downloaded.calls.downloads)), [['a', 'b']]);
  assert.equal(offline.get('a')!.localUri, 'file:///current/a.mp3'); assert.equal(downloaded.calls.song.length, 0);
  const local = harness(); local.setState({ auth: null, offline: true, offlineSource: { mode: 'folder', uris: ['b', 'a'] } });
  local.fresh.set('b', { id: 'b', title: 'B', localUri: 'content://current/b' });
  const resolved = await local.resolve(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(local.calls.local)), [[{ mode: 'folder', key: 'a|b' }, ['a', 'b']]]);
  assert.equal(resolved.get('b')!.localUri, 'content://current/b'); assert.equal(local.calls.song.length, 0);
});

test('Jellyfin also uses safe IDs without album lookups and an already changed owner is rejected', async () => {
  const h = harness(); h.setState({ auth: { username: 'one', serverType: 'jellyfin' }, offline: false });
  const saved = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: String(index), albumId: `album-${index % 2}` }));
  for (const item of saved) h.fresh.set(item.id, item);
  assert.equal((await h.resolve(saved)).size, 6);
  assert.deepEqual(h.calls.album, []); assert.equal(h.calls.song.length, 0);
  const old = harness(); for (const item of saved) old.fresh.set(item.id, item);
  old.stop(); await assert.rejects(old.resolve(saved), /profile changed/);
  assert.equal(old.calls.song.length, 0);
});
import { defaultCustomizationBoundary } from './helpers/defaultCustomizationBoundary';
