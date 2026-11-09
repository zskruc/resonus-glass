import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { create } from 'zustand';
import { createProfilePlayCounts } from '../src/lib/profilePlayCounts';
import { createShufflePreference } from '../src/lib/shufflePreference';
import * as countModel from '../src/lib/profilePlayCounts';
import * as shuffleModel from '../src/lib/weightedShuffle';
function execute(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, setTimeout, clearTimeout, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } }); return exports;
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function history() {
  const a = { serverUrl: 'https://a.test', username: 'A' }, b = { serverUrl: 'https://b.test', username: 'B' };
  const auth = create(() => ({ auth: a, offline: false, autoOffline: false, offlineSource: null }));
  const profile = () => `${auth.getState().auth.serverUrl}|${auth.getState().auth.username}`;
  const authModule = { useAuthStore: auth, profileScopeId: profile }, disk = new Map<string, string>(), writes: string[] = [];
  let failRead = false, hold = false, held: (() => void) | undefined;
  const owner = execute('../src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const mod = execute('../src/store/playHistory.ts', { zustand: { create }, '@/lib/serverUrls': { primaryUrl: (value: any) => value.serverUrl },
    '@/lib/storage': { getItem: async (key: string) => { if (failRead) throw new Error('Locked'); return disk.get(key) ?? null; },
      setItemStrict: async (key: string, value: string) => { if (hold) { hold = false; await new Promise<void>((resolve) => { held = resolve; }); } disk.set(key, value); writes.push(key); }, deleteItem: async (key: string) => { disk.delete(key); } },
    '@/lib/lyricOwner': owner, './auth': authModule,
  });
  const key = (user: 'A' | 'B') => `resonus.playHistory.server.https___${user.toLowerCase()}.test.${user}`;
  return { mod, disk, writes, key, a, profile, switch(user: 'A' | 'B') { auth.setState({ auth: user === 'A' ? a : b }); }, failRead(value: boolean) { failRead = value; },
    holdWrite() { hold = true; }, async waitHeld() { for (let i = 0; i < 100 && !held; i++) await turn(); assert.ok(held); }, release() { assert.ok(held); held(); held = undefined; } };
}

test('actual recent-play store merges by latest timestamp, keeps order on repeat restore and never writes an empty history after a failed read', async () => {
  const h = history(), store = h.mod.usePlayHistory;
  h.disk.set(h.key('A'), JSON.stringify([{ song: { id: 'current', title: 'Current' }, playedAt: 200 }, { song: { id: 'same', title: 'Existing' }, playedAt: 150 }]));
  await store.getState().hydrate();
  const imported = [{ song: { id: 'old', title: 'Old' }, playedAt: 100 }, { song: { id: 'same', title: 'Older backup' }, playedAt: 120 }];
  await h.mod.importPlayHistory(imported, () => true); await h.mod.importPlayHistory(imported, () => true);
  const rows = await h.mod.exportPlayHistory(); assert.deepEqual(Array.from(rows, (row: any) => row.song.id), ['current', 'same', 'old']); assert.equal(rows[1].song.title, 'Existing');
  h.switch('B'); h.disk.set(h.key('B'), JSON.stringify([{ song: { id: 'protected', title: 'Protected' }, playedAt: 1 }])); h.failRead(true);
  await store.getState().hydrate(); store.getState().record({ id: 'fresh', title: 'Fresh' }); await h.mod.flushPlayHistory();
  await assert.rejects(h.mod.exportPlayHistory(), /unavailable/); assert.equal(JSON.parse(h.disk.get(h.key('B'))!)[0].song.id, 'protected');
  h.failRead(false); await store.getState().hydrate(); await h.mod.flushPlayHistory();
  assert.deepEqual(Array.from(await h.mod.exportPlayHistory(), (row: any) => row.song.id), ['fresh', 'protected']);
});

test('captured-key background writes, stale Undo and deletion cannot cross a profile or resurrect deleted history', async () => {
  const h = history(), store = h.mod.usePlayHistory; await store.getState().hydrate();
  store.getState().record({ id: 'a', title: 'A' }); const undo = store.getState().clear();
  h.switch('B'); await store.getState().hydrate(); undo?.(); store.getState().record({ id: 'b', title: 'B' }); await h.mod.flushPlayHistory();
  assert.deepEqual(JSON.parse(h.disk.get(h.key('B'))!).map((row: any) => row.song.id), ['b']); assert.deepEqual(JSON.parse(h.disk.get(h.key('A'))!), []);
  h.switch('A'); await store.getState().hydrate(); store.getState().record({ id: 'late', title: 'Late' }); h.holdWrite();
  const write = h.mod.flushPlayHistory(); await h.waitHeld(); const cleared = h.mod.clearPlayHistoryProfile(h.profile(), h.a); h.release(); await write; await cleared;
  assert.equal(h.disk.has(h.key('A')), false); assert.ok(h.disk.has(h.key('B')));
});

test('production local-count repository uses MAX on repeated imports, surfaces failed reads and fences deletes', async () => {
  const disk = new Map<string, string>([['resonus.localPlayCounts.A', '{"old":7,"same":5}']]); let current: Record<string, number> = {}, fail = false;
  const counts = createProfilePlayCounts({ currentProfile: () => 'A', delay: 60000, read: async (key) => { if (fail) throw new Error('Locked'); return disk.get(key) ?? null; },
    write: async (key, value) => { disk.set(key, value); }, remove: async (key) => { disk.delete(key); }, publish: (value) => { current = value; } });
  await counts.hydrate('A'); await counts.importCounts('A', { same: 3, fresh: 4 }, () => true); await counts.importCounts('A', { same: 3, fresh: 4 }, () => true);
  assert.deepEqual(current, { old: 7, same: 5, fresh: 4 }); assert.deepEqual(await counts.exportCounts('A', () => true), current);
  await counts.clear('A'); assert.equal(disk.has('resonus.localPlayCounts.A'), false);
  fail = true; await assert.rejects(counts.importCounts('A', { bad: 1 }, () => true), /unavailable/); assert.equal(disk.has('resonus.localPlayCounts.A'), false);
});

test('production shuffle restore fills only an unset choice and preserves an explicitly saved uniform or weighted mode', async () => {
  const disk = new Map<string, string>(); let mode = '';
  const controller = createShufflePreference({ profile: () => 'A', read: async (key) => disk.get(key) ?? null, write: async (key, value) => { disk.set(key, value); }, remove: async (key) => { disk.delete(key); }, publish: (value) => { mode = value.mode; } });
  await controller.importMode('rareSongs', () => true); assert.equal(mode, 'rareSongs');
  await controller.importMode('frequentSongs', () => true); assert.equal(mode, 'rareSongs');
  await controller.setMode('uniform'); await controller.importMode('rareArtists', () => true); assert.equal(mode, 'uniform');
  await controller.clear('A'); assert.equal(disk.has('resonus.shufflePolicy.A'), false);
  await controller.importMode('frequentArtists', () => true); assert.equal(await controller.exportMode(() => true), 'frequentArtists');
});

test('actual playback backup validator strips Song URLs, files, comments and credentials while retaining stable IDs and metadata', () => {
  const mod = execute('../src/lib/personalPlaybackBackup.ts', { '@/store/playHistory': {}, '@/store/playCounts': {}, '@/store/shufflePreferences': {}, './profilePlayCounts': countModel, './weightedShuffle': shuffleModel, '@/store/playlistRecovery': {} });
  const value = mod.validatePersonalPlaybackBackup({ version: 1, history: [{ playedAt: 20, song: { id: 'one', title: 'One', artist: 'Artist', albumId: 'album', coverArt: 'https://private.test/art', localUri: 'file:///private', url: 'https://private.test/audio?token=secret', comment: 'private', headers: { Authorization: 'secret' }, auth: { token: 'secret' } } }], counts: { one: 4 }, shuffleMode: 'rareSongs' });
  assert.equal(value.history[0].song.id, 'one'); assert.equal(value.history[0].song.artist, 'Artist'); assert.equal(value.history[0].song.albumId, 'album');
  assert.equal(JSON.stringify(value).includes('private'), false); assert.equal(JSON.stringify(value).includes('secret'), false);
  assert.throws(() => mod.validatePersonalPlaybackBackup({ ...value, counts: { 'https://secret': 2 } }), /Invalid/);
});
