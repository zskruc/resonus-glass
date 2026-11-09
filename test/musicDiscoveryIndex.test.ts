import { defaultCustomizationBoundary } from './helpers/defaultCustomizationBoundary';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { pinyin } from 'pinyin-pro';
import { createStore } from 'zustand/vanilla';
function execute(source: string, imports: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, console, URL, setTimeout, clearTimeout, ...values, require(name: string) { const customization = defaultCustomizationBoundary(name); if (customization) return customization; assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
function harness(page: (count: number, offset: number, source: number) => Promise<unknown>) {
  const auth = createStore(() => ({ auth: { name: 'A' }, offline: false, autoOffline: false, offlineSource: 'local' }));
  const folders = { disabled: [] }, databases = new Map<string, DatabaseSync>();
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth.name };
  const owner = execute(readFileSync(new URL('../src/lib/lyricOwner.ts', import.meta.url), 'utf8'), { '@/store/auth': authModule });
  const sql = { openDatabaseAsync: async (name: string) => { let raw = databases.get(name); if (!raw) { raw = new DatabaseSync(':memory:'); databases.set(name, raw); }
    const statement = (query: string, values: unknown[]) => { const params = values.length === 1 && Array.isArray(values[0]) ? values[0] : values; return { query: raw!.prepare(query), params }; };
    const handle = { execAsync: async (query: string) => { raw!.exec(query); },
      runAsync: async (query: string, ...values: unknown[]) => { const s = statement(query, values); return s.query.run(...s.params as any[]); },
      getFirstAsync: async (query: string, ...values: unknown[]) => { const s = statement(query, values); return s.query.get(...s.params as any[]); },
      getAllAsync: async (query: string, ...values: unknown[]) => { const s = statement(query, values); return s.query.all(...s.params as any[]); },
      withExclusiveTransactionAsync: async (work: (tx: unknown) => Promise<void>) => { raw!.exec('BEGIN'); try { await work(handle); raw!.exec('COMMIT'); } catch (e) { raw!.exec('ROLLBACK'); throw e; } },
    }; return handle; } };
  const mod = execute(readFileSync(new URL('../src/lib/musicDiscoveryIndex.ts', import.meta.url), 'utf8'), {
    'expo-sqlite': sql, 'expo-file-system/legacy': { cacheDirectory: 'file:///cache/', makeDirectoryAsync: async () => {} }, 'pinyin-pro': { pinyin }, '@/api/data': { getCatalogSongPage: page }, '@/store/playCounts': { ownedPlayCounts: () => ({}) },
    '@/store/auth': authModule, '@/store/libraries': { useLibraries: { getState: () => folders } }, '@/lib/localLibrary': { hashKey: (text: string) => Buffer.from(text).toString('hex') }, '@/lib/lyricOwner': owner,
  });
  return { mod, close() { databases.forEach((db) => db.close()); }, roundTrip() { const before = auth.getState().auth; auth.setState({ auth: { name: 'B' } }); auth.setState({ auth: before }); } };
}
test('real SQLite index handles capped pages, Chinese full pinyin/initials/mixed text, paths and actual intent rules', async () => {
  const songs = [{ id: 'zhou', title: '晴天', artist: '周杰伦', artistId: 'jay', album: '叶惠美', albumId: 'album', year: 2003, duration: 260, genre: 'pop', path: 'Mandarin/Jay/晴天.flac' },
    { id: 'beyond', title: 'Beyond 海阔天空', artist: 'Beyond', duration: 240, genre: 'Rock', year: 1993, playCount: 3 },
    { id: 'focus', title: 'Piano', artist: 'Artist', duration: 700, genre: 'instrumental', bpm: 90, starred: 'yes' }];
  const offsets: number[] = [];
  const h = harness(async (_count, offset) => { offsets.push(offset); return { songs: songs.slice(offset, offset + 1), sourceCount: 1 }; });
  try {
    assert.equal(await h.mod.rebuildMusicIndex(), 3); assert.deepEqual(offsets, [0, 1, 2, 3]);
    assert.equal((await h.mod.musicIndexStatus()).count, 3);
    for (const query of ['zhoujielun', 'zjl', '周杰伦', 'yehuimei', 'Mandarin/Jay', 'Beyond 海阔']) {
      const results = await h.mod.searchMusicIndex(query); assert.ok(results.songs.length, query);
    }
    assert.equal((await h.mod.searchMusicIndex('%')).songs.length, 0);
    assert.equal((await h.mod.searchMusicIndex('zjl')).artists[0].id, 'jay');
    assert.deepEqual(Array.from(await h.mod.readListeningIntent('focus'), (song: any) => song.id), ['focus']);
    assert.deepEqual(Array.from(await h.mod.readListeningIntent('nineties'), (song: any) => song.id), ['beyond']);
    assert.deepEqual(Array.from(await h.mod.readListeningIntent('favorites'), (song: any) => song.id), ['focus']);
  } finally { h.close(); }
});
test('cancelled/repeated pages never publish a partial index and A → B → same A is rejected', async () => {
  let mode = 'ok', release!: (data: unknown) => void;
  const h = harness(async (_count, offset) => mode === 'wait' ? new Promise((resolve) => { release = resolve; }) : { songs: offset === 0 || mode === 'repeat' ? [{ id: 'one', title: 'Complete' }] : [], sourceCount: 1 });
  try {
    await h.mod.rebuildMusicIndex(); mode = 'repeat'; await assert.rejects(h.mod.rebuildMusicIndex(), /repeated/); assert.equal((await h.mod.musicIndexStatus()).count, 1);
    mode = 'wait'; const pending = h.mod.rebuildMusicIndex(); while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    h.roundTrip(); release({ songs: [{ id: 'late', title: 'Wrong' }], sourceCount: 1 }); await assert.rejects(pending, /cancelled/);
    assert.equal((await h.mod.searchMusicIndex('Complete')).songs[0].id, 'one'); assert.equal((await h.mod.searchMusicIndex('Wrong')).songs.length, 0);
  } finally { h.close(); }
});
