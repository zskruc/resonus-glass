import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as documents from '../src/lib/lyricDocuments';
import { parseLrc, serializeLrc } from '../src/lib/lrc';
import { parseTtml } from '../src/lib/ttml';
import { shiftSongLyrics } from '../src/lib/lyricTiming';
import type { Song, SongLyrics } from '../src/api/subsonic';

const song = (id = 'song'): Song => ({ id, title: `Title ${id}`, artist: 'Singer', album: 'Album', duration: 120 });
const lyrics: SongLyrics = { synced: true, lines: [{ start: 1000, value: 'Hello wonderful world', translation: '你好美丽世界', romanization: 'nǐ hǎo shì jiè',
  words: [{ start: 1000, end: 1500, value: 'Hello ' }, { start: 1500, end: 2200, value: 'wonderful world' }] }] };
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function compiled(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  } }); return exports;
}
function harness() {
  const databases = new Map<string, DatabaseSync>(), connections = new Map<string, any>(), queries: string[] = [], files = new Map<string, string>();
  const mirror = new Map<string, Song>();
  let fail = false, beforeRun: ((sql: string) => void) | undefined;
  const connection = (profile: string) => {
    if (connections.has(profile)) return connections.get(profile);
    const raw = new DatabaseSync(':memory:'); databases.set(profile, raw);
    raw.exec(`CREATE TABLE saved_lyrics(id TEXT,source TEXT,data TEXT,updated_at INTEGER,PRIMARY KEY(id,source));
      CREATE TABLE cache_tasks(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id));`);
    const params = (args: any[]) => args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    const value = { execAsync: async (sql: string) => { raw.exec(sql); },
      runAsync: async (sql: string, ...args: any[]) => {
        queries.push(sql); beforeRun?.(sql); if (fail) throw new Error('disk full');
        return raw.prepare(sql).run(...params(args));
      },
      getFirstAsync: async (sql: string, ...args: any[]) => { queries.push(sql); return raw.prepare(sql).get(...params(args)); },
      getAllAsync: async (sql: string, ...args: any[]) => { queries.push(sql); return raw.prepare(sql).all(...params(args)); },
      withExclusiveTransactionAsync: async (work: (transaction: any) => Promise<void>) => {
        raw.exec('BEGIN'); try { await work(value); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
      } };
    connections.set(profile, value); return value;
  };
  const sidecars: { cursor: number; song: Song }[] = [];
  const dependencies = {
    './mediaCacheDb': { mediaCacheDatabase: async (profile: string) => connection(profile) },
    'expo-file-system/legacy': { documentDirectory: 'file:///private/', getInfoAsync: async (uri: string) => ({ exists: files.has(uri), size: files.get(uri)?.length ?? 0 }), readAsStringAsync: async (uri: string) => {
      if (!files.has(uri)) throw new Error('not found'); return files.get(uri);
    } },
    './mirrorDb': { getSongs: async (_dir: string, _profile: string, ids: string[]) => new Map(ids.flatMap((id) => mirror.has(id) ? [[id, mirror.get(id)!]] : [])) },
    './downloadsDb': { lyricSidecarPage: async (_dir: string, after: number) => sidecars.filter((item) => item.cursor > after).slice(0, 20) },
    './lrc': { parseLrc }, './lyricDocuments': documents,
  };
  return { api: compiled('../src/lib/lyricLibraryDb.ts', dependencies), reload: () => compiled('../src/lib/lyricLibraryDb.ts', dependencies),
    connection, databases, queries, files, mirror, sidecars, fail: (value: boolean) => { fail = value; },
    beforeRun: (read: typeof beforeRun) => { beforeRun = read; } };
}

test('TTML inline companions and Apple head companions keep lead words and timing intact', () => {
  const inline = parseTtml('<tt><body><p begin="1s"><span begin="1s">Hello</span><span ttm:role="x-translation">你好</span>'
    + '<span ttm:role="x-roman"><span>ni hao</span></span><span ttm:role="x-bg">(echo)</span></p></body></tt>')!;
  assert.equal(inline.lines[0].value, 'Hello'); assert.equal(inline.lines[0].translation, '你好');
  assert.equal(inline.lines[0].romanization, 'ni hao'); assert.equal(inline.lines[0].words?.[0].start, 1000);
  const head = parseTtml('<tt><head><metadata><translations><translation xml:lang="zh"><text for="L1">你好 &amp; 世界</text></translation></translations>'
    + '<transliterations><transliteration><text for="L1">ni hao</text></transliteration></transliterations></metadata></head>'
    + '<body><p begin="1s" itunes:key="L1">Hello world</p></body></tt>')!;
  assert.deepEqual(head.lines[0], { start: 1000, value: 'Hello world', translation: '你好 & 世界', romanization: 'ni hao' });
});

test('offline sidecar serialization preserves companions, lead word timing and per-song presentation offsets', () => {
  const read = parseLrc(serializeLrc(lyrics))!;
  assert.deepEqual(read.lines.map(({ words, ...line }) => line), lyrics.lines.map(({ words, ...line }) => line));
  assert.deepEqual(read.lines[0].words?.map((word) => [word.start, word.value]), lyrics.lines[0].words?.map((word) => [word.start, word.value]));
  assert.equal(read.lines[0].words?.at(-1)?.end, 2200, 'enhanced LRC retains its explicit final word end');
  const shifted = shiftSongLyrics(read, 250)!;
  assert.equal(shifted.lines[0].start, 1250); assert.equal(shifted.lines[0].words?.[1].end, 2450);
  assert.equal(shifted.lines[0].translation, lyrics.lines[0].translation);
  assert.equal(documents.plainLyricText(read, 'original'), 'Hello wonderful world');
  assert.equal(documents.plainLyricText(read, 'translation'), 'Hello wonderful world\n你好美丽世界');
  assert.equal(documents.lyricCompanions(read.lines[0], 'both').length, 2);
  assert.deepEqual(documents.lyricCompanions({ value: 'hello', translation: 'hello', romanization: 'hello' }, 'both'), []);
  const stanza: SongLyrics = { synced: false, lines: [{ value: 'One', translation: '一' }, { value: '' }, { value: 'Two', translation: '二' }] };
  assert.deepEqual(parseLrc(serializeLrc(stanza))?.lines, [{ value: 'One', translation: '一' }, { value: 'Two', translation: '二' }]);
  const unordered: SongLyrics = { synced: true, lines: [{ start: 2000, value: 'Two', translation: '二' }, { start: 1000, value: 'One', translation: '一' }] };
  assert.deepEqual(parseLrc(serializeLrc(unordered))?.lines.map((line) => line.translation), ['一', '二']);
});

test('persisted document validation rejects malformed words and clocks instead of crashing rendering', () => {
  for (const data of [null, { synced: true, lines: [null] }, { synced: true, lines: [{ value: 'a', words: [null] }] },
    { synced: true, lines: [{ value: 'a', start: NaN }] }, { synced: true, lines: [{ value: 'a', words: [{ value: 'a', start: 100, end: 0 }] }] },
    { synced: false, lines: [{ value: 'a', translation: {} }] }]) assert.equal(documents.validLyricDocument(data), false);
});

test('a stale same-id download/cache URI is never adopted from another account folder', () => {
  const api = compiled('../src/lib/lyricAudioUri.ts', { 'expo-file-system/legacy': { documentDirectory: 'file:///private/' } });
  assert.equal(api.ownedLyricAudioUri('B', 'file:///private/downloads/A/song.flac', 'file:///private/song-cache/A/song.mp3'), undefined);
  assert.equal(api.ownedLyricAudioUri('B', 'file:///private/downloads/B/song.flac'), 'file:///private/downloads/B/song.flac');
  assert.equal(api.ownedLyricAudioUri('B', 'file:///private/downloads/BB/song.flac', 'file:///private/song-cache/B/song.mp3'), 'file:///private/song-cache/B/song.mp3');
});

test('a chosen real candidate survives restart and offline reads without crossing profile or recording identity', async () => {
  const h = harness(), candidate = { id: 'server', kind: 'server', lyrics };
  await h.api.saveLyricCandidate('A', song(), candidate); await h.api.selectLyricCandidate('A', song(), candidate);
  assert.deepEqual(plain(await h.reload().selectedLyrics('A', song())), lyrics);
  assert.equal(await h.api.selectedLyrics('B', song()), null);
  assert.equal(await h.api.selectedLyrics('A', { ...song(), title: 'Different recording' }), null);
  assert.equal((await h.api.cachedLyricCandidates('A', song())).length, 1);
  await h.api.selectLyricCandidate('A', song(), null); assert.equal(await h.api.selectedLyrics('A', song()), null);
});

test('choice/index commit atomically and stale/failed selections preserve the previous document', async () => {
  const h = harness(), first = { id: 'first', kind: 'server', lyrics }, second = { id: 'second', kind: 'lrclib', lyrics: { synced: false, lines: [{ value: 'replacement' }] } };
  await h.api.saveLyricCandidate('A', song(), first); await h.api.saveLyricCandidate('A', song(), second);
  await h.api.selectLyricCandidate('A', song(), first);
  h.fail(true); await assert.rejects(h.api.selectLyricCandidate('A', song(), second), /disk full/); h.fail(false);
  assert.equal(await h.api.chosenLyricSource('A', song()), 'first');
  let current = true; h.beforeRun((sql) => { if (sql.startsWith('INSERT INTO lyric_search')) current = false; });
  await assert.rejects(h.api.selectLyricCandidate('A', song(), second, () => current), /profile changed/);
  h.beforeRun(undefined);
  assert.equal(await h.api.chosenLyricSource('A', song()), 'first');
  assert.equal((await h.api.searchCachedLyrics('A', 'wonderful')).length, 1);
  assert.equal((await h.api.searchCachedLyrics('A', 'replacement')).length, 0);
});

test('real SQLite FTS finds original, provided translation and romanization with bounded results and literal queries', async () => {
  const h = harness();
  for (let at = 0; at < 26; at++) await h.api.indexSongLyrics('A', song(String(at)), lyrics);
  for (const query of ['wonder', '美丽', '你好美丽', 'shì jiè']) {
    const found = await h.api.searchCachedLyrics('A', query); assert.equal(found.length, 20, query);
    assert.ok(found.every((item: any) => item.excerpt.length <= 220 && item.song.title));
  }
  assert.equal((await h.api.searchCachedLyrics('B', 'wonderful')).length, 0);
  assert.equal((await h.api.searchCachedLyrics('A', '" OR *')).length, 0);
  assert.equal((await h.api.searchCachedLyrics('A', "';DROP TABLE lyric_search;--")).length, 0);
  assert.equal((await h.api.searchCachedLyrics('A', 'x')).length, 0);
  assert.ok(h.queries.filter((sql) => sql.includes('lyric_search MATCH')).every((sql) => sql.includes('LIMIT 20') && !sql.includes('LIKE')));
});

test('old bulk cache backfills at most twenty documents per page, continues after restart and never replaces a selected index', async () => {
  const h = harness(), raw = h.connection('A');
  for (let at = 0; at < 43; at++) {
    const item = song(String(at)); h.mirror.set(item.id, item);
    await raw.runAsync('INSERT INTO saved_lyrics(id,source,data,updated_at) VALUES(?,?,?,?)', item.id, 'local', JSON.stringify(lyrics), 1);
  }
  await h.api.indexSongLyrics('A', song('0'), { synced: false, lines: [{ value: 'chosen exclusive' }] });
  assert.equal(await h.api.indexSavedLyricsPage('A'), true);
  assert.equal(h.databases.get('A')!.prepare('SELECT COUNT(*) AS count FROM lyric_search_songs').get()!.count, 20);
  const restarted = h.reload(); assert.equal(await restarted.indexSavedLyricsPage('A'), true); assert.equal(await restarted.indexSavedLyricsPage('A'), false);
  assert.equal(h.databases.get('A')!.prepare('SELECT COUNT(*) AS count FROM lyric_search_songs').get()!.count, 43);
  assert.equal((await restarted.searchCachedLyrics('A', 'exclusive')).length, 1);
  assert.equal(await restarted.indexSavedLyricsPage('A'), false, 'the durable cursor avoids rescanning old JSON on every search');
});

test('old downloaded sidecars upgrade in bounded pages and stopped work cannot publish later files', async () => {
  const h = harness();
  for (let at = 1; at <= 25; at++) {
    const item = { ...song(String(at)), localUri: `file:///audio/${at}.m4a` };
    h.sidecars.push({ cursor: at, song: item }); h.files.set(`file:///audio/${at}.lrc`, serializeLrc(lyrics));
  }
  assert.equal(await h.api.indexDownloadedLyricsPage('A', 'dir'), true);
  assert.equal(h.databases.get('A')!.prepare('SELECT COUNT(*) AS count FROM lyric_search_songs').get()!.count, 20);
  assert.equal(await h.reload().indexDownloadedLyricsPage('A', 'dir'), false);
  assert.equal(h.databases.get('A')!.prepare('SELECT COUNT(*) AS count FROM lyric_search_songs').get()!.count, 25);
  await assert.rejects(h.api.indexDownloadedLyricsPage('B', 'dir', () => false), /profile changed/);
  assert.equal((await h.api.searchCachedLyrics('B', 'wonderful')).length, 0);
});
