/** Execute the production restore pipeline against a fault-injected server and local journal. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import type { Song } from '../src/api/subsonic';
import type { PersonalRestorePreview } from '../src/lib/personalBackup';
const one: Song = { id: 'one', title: 'One' }, two: Song = { id: 'two', title: 'Two' };
function fixture(fault: 'create-response' | 'insert-response' | 'manifest' | 'rename' | 'none') {
  const lists = new Map<string, { id: string; name: string; songs: Song[] }>(), journals = new Map<string, Record<string, unknown>>();
  const manifests = new Map<string, any>(), ledger = new Map<string, string>(), events: string[] = [];
  let fail = fault, valid = true, next = 0;
  const check = () => { if (!valid) throw new Error('Library changed'); };
  const api = {
    getStarred: async () => ({ songs: [], albums: [], artists: [] }), canEditPlaylist: () => true,
    getPlaylists: async () => [...lists.values()].map(({ songs, ...list }) => ({ ...list, songCount: songs.length })),
    createPlaylist: async (name: string) => {
      events.push('create'); const id = `new-${++next}`; lists.set(id, { id, name, songs: [] });
      if (fail === 'create-response') { fail = 'none'; throw new Error('Response lost after server accepted creation'); } return id;
    },
    getPlaylistForEditing: async (id: string) => { const list = lists.get(id)!; return { playlist: { id, name: list.name, songCount: list.songs.length }, songs: [...list.songs] }; },
    insertRecoveredPlaylistTracks: async (id: string, added: { before: number; song: Song }[], expected: string[]) => {
      events.push('insert'); const list = lists.get(id)!; assert.deepEqual([...expected], list.songs.map((s) => s.id));
      for (const row of added) assert.equal(row.before, list.songs.length);
      list.songs.push(...added.map((r) => r.song));
      if (fail === 'insert-response') { fail = 'none'; throw new Error('Response lost after insert'); } return list.songs;
    },
    updatePlaylist: async (id: string, changes: { name: string }) => { events.push('rename'); if (fail === 'rename') { fail = 'none'; throw new Error('Rename interrupted'); } lists.get(id)!.name = changes.name; },
  };
  const modules: Record<string, unknown> = {
    '@/api/data': api,
    '@/store/playlistRecovery': {
      exportPlaylistRecovery: async () => [...manifests.values()], restoredPlaylistId: async (key: string) => ledger.get(key),
      saveRecoveryPlaylist: async (value: any) => { events.push('manifest'); if (fail === 'manifest') { fail = 'none'; throw new Error('Disk unavailable'); } manifests.set(value.playlistId, JSON.parse(JSON.stringify(value))); },
      rememberRestoredPlaylist: async (key: string, id: string) => { events.push('ledger'); ledger.set(key, id); },
    },
    '@/store/playlistRecoveryJournal': {
      readRecoveryJournal: async (key: string) => journals.get(key),
      saveRecoveryJournal: async (key: string, value: Record<string, unknown>) => { events.push('journal'); journals.set(key, JSON.parse(JSON.stringify(value))); },
      deleteRecoveryJournal: async (key: string) => { events.push('complete'); journals.delete(key); },
    },
    '@/store/pendingSongMarks': { validatePendingSongMarks: (value: unknown) => value, savePendingSongMarks: async () => {} },
    './query': { queryClient: { invalidateQueries: async () => {} } },
  };
  const exports: Record<string, any> = {};
  const js = ts.transpileModule(readFileSync(new URL('../src/lib/personalBackup.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require: (name: string) => modules[name] ?? {}, setTimeout, console, Date, Map, Set, Promise });
  const owner = { profile: 'account', source: 'server', library: 'same', current: () => valid, check };
  const preview = { owner, sameLibrary: false, songs: [one, two], tracks: [{ track: one, selected: one, candidates: [one] }, { track: two, selected: two, candidates: [two] }],
    favoriteIndices: [], ratingIndices: [], playlistIndices: [[0, 1]], albums: [], artists: [], conflicts: 0,
    backup: { format: 'resonus-personal-backup', version: 1, createdAt: '2026-11-09', library: 'origin', settings: {}, favorites: { songs: [], albums: [], artists: [] }, ratings: [], extras: {},
      playlists: [{ key: 'original', name: 'Test playlist', entries: [{ key: 'first', track: one }, { key: 'second', track: two }] }] },
  } as unknown as PersonalRestorePreview;
  const apply = () => exports.applyPersonalRestore(preview, { personal: true, local: false, appearance: false, replaceRatings: false }, () => {});
  return { lists, journals, manifests, ledger, events, apply, preview, invalidate: () => { valid = false; } };
}
for (const fault of ['create-response', 'insert-response', 'manifest', 'rename'] as const) test(`restore resumes ${fault} without duplicate playlists or tracks`, async () => {
  const f = fixture(fault);
  await assert.rejects(f.apply()); assert.equal(f.lists.size, 1); assert.equal(f.journals.size, 1);
  await f.apply(); assert.equal(f.lists.size, 1); const list = [...f.lists.values()][0];
  assert.deepEqual(list.songs.map((s) => s.id), ['one', 'two']); assert.equal(list.name, 'Test playlist');
  assert.equal(f.journals.size, 0); assert.equal(f.manifests.size, 1); assert.equal(f.ledger.size, 1);
  assert.ok(f.events.indexOf('journal') < f.events.indexOf('create'));
  await f.apply(); assert.equal(f.lists.size, 1); assert.equal(f.events.filter((e) => e === 'insert').length, 1);
});
test('a changed partial playlist or abandoned owner is never rewritten by restore', async () => {
  const f = fixture('manifest'); await assert.rejects(f.apply());
  const list = [...f.lists.values()][0]; list.songs.push({ id: 'added-elsewhere', title: 'User added' });
  await assert.rejects(f.apply(), /changed/); assert.equal(list.songs.at(-1)?.id, 'added-elsewhere'); assert.equal(f.lists.size, 1);
  const other = fixture('none'); other.invalidate(); await assert.rejects(other.apply(), /Library changed/); assert.equal(other.lists.size, 0);
});
