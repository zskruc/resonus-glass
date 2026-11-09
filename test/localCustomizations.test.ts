import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import type { Song, SongLyrics } from '../src/api/subsonic';
import { exportLyrics } from '../src/lib/lyricsExport';
import { cloneLyrics, editLyricLine, editLyricWord, lyricTimestamp } from '../src/lib/lyricEditing';
import { parseLrc } from '../src/lib/lrc';
import { lyricRecordingKey } from '../src/lib/lyricDocuments';
import { lyricFontFamily, lyricFontRuns } from '../src/lib/lyricFonts';
import { aliasImpactPreview, applyAlbumDisplay, applyArtistDisplay, applySongDisplay, sourceSong, validateAliasOverlap } from '../src/lib/localMetadata';
import * as models from '../src/lib/localCustomizationModels';

const song: Song = { id: 'song', title: 'Original', artist: 'Artist alias', artistId: 'artist', album: 'Album', albumId: 'album', year: 2001, duration: 60, localUri: 'file:///audio.mp3' };
const document: SongLyrics = { synced: true, lines: [
  { start: 1001, value: 'Hello 世界', translation: '你好 世界', romanization: 'Ni hao', words: [{ start: 1001, end: 1403, value: 'Hello ' }, { start: 1607, end: 2209, value: '世界' }] },
  { start: 4001, value: 'Next', translation: '下一行' },
] };
const edited = () => ({ version: 1, recording: lyricRecordingKey(song), base: cloneLyrics(document), lyrics: editLyricLine(document, 1, { translation: 'New translation' }), updatedAt: 1 });
function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, setTimeout, clearTimeout, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return exports;
}
function harness() {
  const first = { username: 'A' };
  const auth = createStore<any>(() => ({ auth: first, offline: false, autoOffline: false, offlineSource: null }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth?.username ?? 'local' };
  const owner = load('../src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const databases = new Map<string, DatabaseSync>();
  let gate: (() => Promise<void>) | undefined;
  const api = load('../src/lib/localCustomizations.ts', {
    '@/store/auth': authModule, './lyricOwner': owner, './localCustomizationModels': models,
    './localLibrary': { hashKey: (value: string) => Array.from(value).reduce((total, char) => (Math.imul(total, 31) + char.charCodeAt(0)) >>> 0, 0).toString(36), folderSetKey: (uris: string[]) => [...uris].sort().join('|') },
    './mediaCacheDb': { mediaCacheDatabase: async (profile: string) => {
      let raw = databases.get(profile); if (!raw) { raw = new DatabaseSync(':memory:'); databases.set(profile, raw); }
      const db = raw;
      return { execAsync: async (sql: string) => db.exec(sql),
        getFirstAsync: async (sql: string, ...args: any[]) => db.prepare(sql).get(...args),
        getAllAsync: async (sql: string, ...args: any[]) => db.prepare(sql).all(...args),
        runAsync: async (sql: string, ...args: any[]) => db.prepare(sql).run(...args),
        withExclusiveTransactionAsync: async (work: (transaction: any) => Promise<void>) => {
          db.exec('BEGIN IMMEDIATE');
          try { await work({ runAsync: async (sql: string, ...args: any[]) => { if (gate && sql.startsWith('INSERT')) { const wait = gate; gate = undefined; await wait(); } return db.prepare(sql).run(...args); } }); db.exec('COMMIT'); }
          catch (error) { db.exec('ROLLBACK'); throw error; }
        },
      };
    } },
  });
  return { api, auth, first, gate: (value: () => Promise<void>) => { gate = value; }, close: () => { for (const db of databases.values()) db.close(); } };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('LRC export roundtrips millisecond word timing, gaps, translations and romanization; offset is explicit and never changes the source', () => {
  const before = JSON.stringify(document), exported = exportLyrics(document, 'lrc');
  assert.deepEqual(parseLrc(exported), document);
  const offset = parseLrc(exportLyrics(document, 'lrc', { offsetMs: 250 }))!;
  assert.equal(offset.lines[0].start, 1251); assert.equal(offset.lines[0].words![0].end, 1653);
  assert.equal(JSON.stringify(document), before);
  assert.match(exportLyrics(document, 'srt', { translation: true }), /00:00:01,001 --> 00:00:04,001\nHello 世界\n你好 世界/);
  assert.equal(exportLyrics({ synced: false, lines: [{ value: 'Plain', translation: '译文' }] }, 'txt', { translation: true }), 'Plain\n译文');
  for (const format of ['srt', 'lrc'] as const) assert.throws(() => exportLyrics({ synced: false, lines: [{ value: 'Plain' }] }, format), /Synchronized/);
});

test('editing a true timed word or its line translates timestamps as a unit and preserves companion structures', () => {
  const before = JSON.stringify(document), changed = editLyricWord(document, 0, 0, 'Hi ');
  assert.equal(changed.lines[0].value, 'Hi 世界'); assert.deepEqual(changed.lines[0].words!.map(({ start, end }) => [start, end]), [[1001, 1403], [1607, 2209]]);
  assert.equal(changed.lines[0].romanization, 'Ni hao'); assert.equal(changed.lines[0].translation, '你好 世界');
  const moved = editLyricLine(document, 0, { start: 1501 }); assert.equal(moved.lines[0].words![1].end, 2709);
  assert.throws(() => editLyricLine(document, 0, { value: 'Replace timed structure' }), /protected/);
  assert.throws(() => editLyricLine(document, 0, { start: 3501 }), /overlaps/);
  assert.throws(() => editLyricLine(document, 1, { start: 500 }), /order/);
  const overlapping = cloneLyrics(document); overlapping.lines[0].words![1].end = 4500;
  assert.equal(editLyricLine(overlapping, 0, { start: 1001, translation: 'Duet translation' }).lines[0].words![1].end, 4500,
    'changing a translation at the unchanged line time must preserve valid source overlap');
  assert.equal(lyricTimestamp('01:02.003'), 62003); assert.equal(lyricTimestamp('01:70'), undefined);
  assert.equal(JSON.stringify(document), before);
});

test('script font runs respect Japanese/Korean line context, keep punctuation and leave inherited fonts unchanged', () => {
  const runs = lyricFontRuns('Music 世界 こんにちは 한국어');
  assert.equal(runs.map((run) => run.text).join(''), 'Music 世界 こんにちは 한국어');
  assert.equal(runs.find((run) => run.text.includes('世界'))!.script, 'japanese');
  assert.equal(lyricFontRuns('世界', '世界 한국어')[0].script, 'korean');
  assert.equal(lyricFontRuns('世界')[0].script, 'chinese');
  assert.equal(lyricFontFamily('chinese', { version: 1, fonts: { chinese: 'inherit' } }), undefined);
  assert.equal(lyricFontFamily('latin', { version: 1, fonts: { latin: 'custom' } }, null), undefined);
  assert.equal(lyricFontFamily('latin', { version: 1, fonts: { latin: 'serif' } }), 'serif');
});

test('display corrections and exact aliases preserve original IDs/URIs and lyric recording identity without fuzzy merges', () => {
  const aliases = [{ version: 1 as const, artistId: 'artist', canonical: 'Canonical artist', aliases: ['Artist alias'] }];
  const changes = { song: { version: 1 as const, original: { title: song.title }, patch: { title: 'Corrected', album: 'Corrected album' }, albumId: 'album' } };
  const mapped = applySongDisplay(song, changes, aliases);
  assert.equal(mapped.title, 'Corrected'); assert.equal(mapped.artist, 'Canonical artist'); assert.equal(mapped.albumId, 'album');
  assert.equal(mapped.id, song.id); assert.equal(mapped.localUri, song.localUri); assert.equal(sourceSong(mapped), song);
  assert.equal(lyricRecordingKey(mapped), lyricRecordingKey(song)); assert.equal(song.title, 'Original');
  assert.equal(applyArtistDisplay({ id: 'unrelated', name: 'Artist alias live' }, aliases).name, 'Artist alias live');
  assert.equal(applyAlbumDisplay({ id: 'album', name: 'Album', artist: 'Artist alias' }, changes, aliases).name, 'Corrected album');
  assert.throws(() => validateAliasOverlap(aliases, { version: 1, artistId: 'other', canonical: 'Other', aliases: ['Artist alias'] }));
  assert.equal(aliasImpactPreview([{ songs: [song], artists: [{ id: 'artist', name: 'Artist alias' }] }], aliases[0]).samples.length, 2);
  assert.equal(applySongDisplay(song, {}, []), song, 'undo restores the source object directly');
});

test('actual SQLite local corrections retain originals, survive reload/export/merge and remove only the chosen overlay', async () => {
  const h = harness(); try {
    const scope = h.api.customizationScope();
    await h.api.writeLocalCustomization(scope, 'lyric-edit', song.id, edited());
    await h.api.writeLocalCustomization(scope, 'song-metadata', song.id, { version: 1, patch: { title: 'Corrected' }, original: { title: song.title } });
    const saved = await h.api.readLocalCustomization(scope, 'lyric-edit', song.id);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.base)), document); assert.equal(saved.lyrics.lines[1].translation, 'New translation');
    const backup = await h.api.exportLocalCustomizations('A'); assert.equal(backup.entries.length, 2);
    await h.api.writeLocalCustomization(scope, 'lyric-edit', song.id, undefined);
    assert.equal(await h.api.readLocalCustomization(scope, 'lyric-edit', song.id), undefined);
    await h.api.restoreLocalCustomizations('A', backup); assert.equal((await h.api.readLocalCustomization(scope, 'lyric-edit', song.id)).lyrics.lines[1].translation, 'New translation');
  } finally { h.close(); }
});

test('server account overrides ignore a leftover folder source, while local folder sets and profiles stay isolated', async () => {
  const h = harness(); try {
    h.auth.setState({ offlineSource: { mode: 'folder', uris: ['old'] } }); assert.equal(h.api.customizationScope().source, 'server');
    const a = h.api.customizationScope(); await h.api.writeLocalCustomization(a, 'lyric-edit', song.id, edited());
    h.auth.setState({ auth: { username: 'B' } }); assert.equal(await h.api.readLocalCustomization(h.api.customizationScope(), 'lyric-edit', song.id), undefined);
    h.auth.setState({ auth: null, offline: true, offlineSource: { mode: 'folder', uris: ['one'] } });
    const one = h.api.customizationScope(); await h.api.writeLocalCustomization(one, 'lyric-edit', song.id, edited());
    h.auth.setState({ offlineSource: { mode: 'folder', uris: ['two'] } });
    assert.equal(await h.api.readLocalCustomization(h.api.customizationScope(), 'lyric-edit', song.id), undefined);
  } finally { h.close(); }
});

test('A to B to A during an actual SQL write rolls back, and profile removal drains/tombstones old work before clearing', async () => {
  for (const change of ['aba', 'delete'] as const) {
    const h = harness(); try {
      let release!: () => void, entered = false; const waiting = new Promise<void>((resolve) => { release = resolve; });
      h.gate(async () => { entered = true; await waiting; });
      const scope = h.api.customizationScope(), work = h.api.writeLocalCustomization(scope, 'lyric-edit', song.id, edited()), rejected = assert.rejects(work, /changed/);
      while (!entered) await turn();
      let clearing: Promise<void> | undefined;
      if (change === 'aba') { h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.first }); }
      else clearing = h.api.clearLocalCustomizationsProfile('A');
      release(); await rejected; await clearing;
      if (change === 'delete') {
        await assert.rejects(h.api.writeLocalCustomization(scope, 'lyric-edit', song.id, edited()), /changed/, 'a stale still-mounted caller cannot resurrect deleted data');
        h.auth.setState({ auth: { username: 'A' } });
      }
      assert.equal(await h.api.readLocalCustomization(h.api.customizationScope(), 'lyric-edit', song.id), undefined);
    } finally { h.close(); }
  }
});

test('malformed backups are rejected before any write, including fake word data, identity changes and conflicting aliases', async () => {
  const h = harness(); try {
    for (const value of [
      { source: 'server', kind: 'lyric-edit', id: 'x', value: { ...edited(), lyrics: { synced: true, lines: [null] } } },
      { source: 'server', kind: 'song-metadata', id: 'x', value: { version: 1, original: {}, patch: { id: 'replaced' } } },
      { source: 'server', kind: 'artist-alias', id: 'wrong', value: { version: 1, artistId: 'actual', canonical: 'Name', aliases: [] } },
    ]) assert.throws(() => h.api.validateLocalCustomizations({ version: 1, entries: [value] }));
    const entries = ['one', 'two'].map((id) => ({ source: 'server', kind: 'artist-alias', id, value: { version: 1, artistId: id, canonical: id, aliases: ['Same exact alias'] } }));
    assert.throws(() => h.api.validateLocalCustomizations({ version: 1, entries }), /Conflicting/);
    assert.equal((await h.api.exportLocalCustomizations('A')).entries.length, 0);
  } finally { h.close(); }
});

test('actual display store replaces an obsolete ABA hydration and a forced refresh never adopts pre-save rows', async () => {
  const h = harness();
  try {
    const scope = h.api.customizationScope();
    await h.api.writeLocalCustomization(scope, 'song-metadata', song.id, { version: 1, patch: { title: 'Old correction' }, original: { title: song.title } });
    let release!: () => void, paused = false, gateNext = true;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const api = { ...h.api, listLocalCustomizations: async (...args: any[]) => {
      const value = await h.api.listLocalCustomizations(...args);
      if (args[1] === 'song-metadata' && gateNext) { gateNext = false; paused = true; await waiting; }
      return value;
    } };
    const store = load('../src/store/localMetadata.ts', { zustand: { create: createStore }, '@/lib/localCustomizations': api, '@/lib/localCustomizationModels': models }).useLocalMetadata;
    const old = store.getState().hydrate(); while (!paused) await turn();
    h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.first });
    await store.getState().hydrate();
    assert.equal(store.getState().ready, true, 'a fresh A read does not reuse the permanently invalid old A task');
    await h.api.writeLocalCustomization(scope, 'song-metadata', song.id, { version: 1, patch: { title: 'After save' }, original: { title: song.title } });
    await store.getState().hydrate(scope, true); release(); await old;
    assert.equal(store.getState().songs.song.patch.title, 'After save', 'old completion cannot restore the pre-save rows');
    // The same owner still needs a new read when an explicit save forces one.
    let releaseSecond!: () => void, pausedSecond = false;
    const secondWait = new Promise<void>((resolve) => { releaseSecond = resolve; });
    api.listLocalCustomizations = async (...args: any[]) => {
      const value = await h.api.listLocalCustomizations(...args);
      if (args[1] === 'song-metadata' && !pausedSecond) { pausedSecond = true; await secondWait; }
      return value;
    };
    const beforeSave = store.getState().hydrate(scope, true); while (!pausedSecond) await turn();
    await h.api.writeLocalCustomization(scope, 'song-metadata', song.id, { version: 1, patch: { title: 'Latest correction' }, original: { title: song.title } });
    await store.getState().hydrate(scope, true); releaseSecond(); await beforeSave;
    assert.equal(store.getState().songs.song.patch.title, 'Latest correction');
    await h.api.clearLocalCustomizationsProfile('A'); await store.getState().hydrate(scope, true);
    assert.deepEqual(Object.keys(store.getState().songs), [], 'profile removal also clears its in-memory corrections');
  } finally { h.close(); }
});
