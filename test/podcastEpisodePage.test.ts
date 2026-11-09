import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import * as directory from '../src/lib/podcastDirectory';
import { createPodcastFeedPreview } from '../src/lib/podcastFeedStream';

function compile(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, AbortController, Date, setTimeout, clearTimeout, ...globals,
    require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function database() {
  const handles = new Map<string, DatabaseSync>(), reads: { sql: string; params: unknown[]; rows: number }[] = [];
  let decodedEpisodes = 0, waitWrite: (() => Promise<void>) | undefined;
  const args = (params: unknown[]) => params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  const connection = (scope: string) => handles.get(`/sandbox/podcasts/${scope}/`)!;
  const sqlite = { openDatabaseAsync: async (_file: string, _options: unknown, dir: string) => {
    let raw = handles.get(dir); if (!raw) { raw = new DatabaseSync(':memory:'); handles.set(dir, raw); }
    const db = raw;
    return { execAsync: async (sql: string) => db.exec(sql),
      runAsync: async (sql: string, ...params: unknown[]) => { if (waitWrite) { const wait = waitWrite; waitWrite = undefined; await wait(); } return db.prepare(sql).run(...args(params)); },
      getFirstAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).get(...args(params)),
      getAllAsync: async (sql: string, ...params: unknown[]) => { const values = args(params), rows = db.prepare(sql).all(...values); reads.push({ sql, params: values, rows: rows.length }); return rows; },
      withTransactionAsync: async (fn: () => Promise<void>) => { db.exec('BEGIN'); try { await fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } },
      closeAsync: async () => {},
    };
  } };
  const Db = compile('../src/lib/podcastDb.ts', { 'expo-file-system/legacy': { documentDirectory: 'file:///sandbox/', makeDirectoryAsync: async () => {}, deleteAsync: async () => {} },
    'expo-sqlite': sqlite, '@/lib/localLibrary': { hashKey: (value: string) => value }, './podcastMedia': {}, '@/api/netGate': {} }, {
    JSON: { stringify: JSON.stringify, parse(value: string) { const result = JSON.parse(value); if (result?.channelId && result?.title) decodedEpisodes++; return result; } },
  });
  return { Db, reads, connection, decoded: () => decodedEpisodes,
    gateNextWrite(fn: () => Promise<void>) { waitWrite = fn; }, close() { for (const db of handles.values()) db.close(); } };
}

function episode(id: string, date?: number, title = id, season?: number) {
  return { id, channelId: 'show', title, publishedAt: date, season, url: `https://audio.test/${id}.mp3`, duration: 600,
    description: 'n'.repeat(3000), descriptionHtml: '<p>' + 'heavy'.repeat(3000) + '</p>',
    chapters: [{ startSec: 0, title: 'Chapter' }], transcripts: [{ url: 'https://text.test/file' }], mimeType: 'audio/mpeg' };
}

test('actual detail SQL returns seven compact rows then twenty, without decoding full notes or changing full-queue reads', async () => {
  const h = database();
  try {
    const source = Array.from({ length: 31 }, (_, index) => episode(`id${String(index).padStart(2, '0')}`, index + 1));
    await h.Db.replaceEpisodes('A', 'show', source);
    await h.Db.saveEpisodeProgress('A', { id: 'id03', channelId: 'show', positionSec: 80, durationSec: 600 });
    const first = await h.Db.listEpisodePage('A', 'show');
    assert.deepEqual(plain(first.items.map((row: any) => row.id)), ['id30', 'id29', 'id28', 'id27', 'id26', 'id25', 'id24']);
    assert.equal(first.total, 31); assert.equal(first.nextOffset, 7); assert.equal(h.decoded(), 7);
    assert.equal(first.resumeId, 'id03', 'Continue is resolved across the show even when outside the first seven');
    for (const row of first.items) {
      assert.equal(row.description.length, 512); assert.equal(row.descriptionHtml, undefined);
      assert.equal(row.chapters, undefined); assert.equal(row.transcripts, undefined);
      assert.equal(row.mimeType, 'audio/mpeg'); assert.ok(row.url);
    }
    const second = await h.Db.listEpisodePage('A', 'show', { limit: 20, offset: first.nextOffset });
    assert.equal(second.items.length, 20); assert.equal(second.items[0].id, 'id23'); assert.equal(second.nextOffset, 27);
    assert.equal(second.resumeId, null, 'subsequent pages do not repeat the full-show resume lookup');
    const last = await h.Db.listEpisodePage('A', 'show', { limit: 20, offset: second.nextOffset });
    assert.equal(last.items.length, 4); assert.equal(last.nextOffset, null); assert.equal(h.decoded(), 31);
    const summaries = h.reads.filter((read) => read.sql.includes('AS data') && read.sql.includes('json_remove'));
    assert.deepEqual(summaries.map((read) => read.rows), [7, 20, 4]);
    assert.ok(summaries.every((read) => read.params.length <= 21));
    const full = await h.Db.listAllEpisodes('A', 'show');
    assert.equal(full.length, 31); assert.equal(full[0].descriptionHtml, source[0].descriptionHtml);
    assert.equal(full[0].chapters.length, 1, 'queue/bulk paths retain complete metadata');
  } finally { h.close(); }
});

test('filters and seasons run before paging, preserve unknown durations, and keep unknown dates last in both directions', async () => {
  const h = database();
  try {
    const rows = [episode('new', 100, 'New', 2), episode('done', 90, 'Done', 2), episode('progress', 80, 'Progress', 1),
      { ...episode('unknown-duration', 70, 'Unknown duration', 1), duration: 0 }, episode('offline', 60), episode('undated'), episode('zero', 0), episode('negative', -1)];
    await h.Db.replaceEpisodes('A', 'show', rows);
    await h.Db.saveEpisodeProgress('A', { id: 'done', channelId: 'show', positionSec: 580, durationSec: 600 });
    await h.Db.saveEpisodeProgress('A', { id: 'progress', channelId: 'show', positionSec: 70, durationSec: 600 });
    await h.Db.saveEpisodeProgress('A', { id: 'unknown-duration', channelId: 'show', positionSec: 70, durationSec: 0 });
    await h.Db.saveDownload('A', { id: 'offline', channelId: 'show' }, 'file:///episode', 100);
    const page = (options: object) => h.Db.listEpisodePage('A', 'show', options);
    assert.deepEqual(plain((await page({ filter: 'progress', limit: 1, offset: 1 })).items.map((row: any) => row.id)), ['unknown-duration']);
    const downloaded = await page({ filter: 'downloaded', limit: 1 });
    assert.equal(downloaded.total, 1); assert.equal(downloaded.items[0].id, 'offline');
    const season = await page({ season: 2, filter: 'unplayed', limit: 1 });
    assert.equal(season.total, 1); assert.equal(season.items[0].id, 'new'); assert.deepEqual(plain(season.seasons), [2, 1]);
    assert.equal(season.resumeId, null, 'another season does not leak into the header Continue target');
    const other = await page({ season: 'other', limit: 100 }); assert.equal(other.total, 4);
    for (const order of ['recent', 'added']) {
      const all = await page({ order, limit: 100 });
      assert.deepEqual(plain(all.items.slice(-3).map((row: any) => row.id)), ['negative', 'undated', 'zero']);
    }
    assert.equal((await page({ order: 'added', limit: 1 })).items[0].id, 'offline');
    assert.equal((await page({ offset: 100 })).nextOffset, null);
  } finally { h.close(); }
});

test('alphabetical pages use actual locale collation, preserve the old base order for equal titles, and invalidate on feed replacement', async () => {
  const h = database();
  try {
    const titles = ['周杰伦', '阿杜', '陈奕迅', '张学友', 'Ångström', 'Zulu', 'é', 'e\u0301', 'Álbum', 'apple', '苹果'];
    const rows = titles.map((title, index) => episode(`id${index}`, index + 1, title));
    await h.Db.replaceEpisodes('A', 'show', rows);
    await h.Db.saveEpisodeProgress('A', { id: 'id3', channelId: 'show', positionSec: 80, durationSec: 600 });
    for (const language of ['zh', 'sv', 'en']) {
      const expected = [...rows].sort((a, b) => b.publishedAt! - a.publishedAt! || a.id.localeCompare(b.id))
        .sort((a, b) => a.title.localeCompare(b.title, language)).map((row) => row.id);
      const one = await h.Db.listEpisodePage('A', 'show', { order: 'alpha', language, limit: 4 });
      const two = await h.Db.listEpisodePage('A', 'show', { order: 'alpha', language, limit: 100, offset: 4 });
      assert.deepEqual(plain([...one.items, ...two.items].map((row: any) => row.id)), expected);
      assert.equal(one.resumeId, 'id3');
    }
    assert.equal(h.reads.filter((read) => read.sql.includes("AS title FROM podcast_episodes")).length, 3,
      'subsequent pages reuse only the bounded sorted-identity index');
    await h.Db.replaceEpisodes('A', 'show', [episode('replacement', 1, 'A new title')]);
    const updated = await h.Db.listEpisodePage('A', 'show', { order: 'alpha', language: 'en' });
    assert.equal(updated.total, 1); assert.equal(updated.items[0].id, 'replacement');
    await h.Db.replaceEpisodes('B', 'show', [episode('other-account', 1, 'A')]);
    assert.equal((await h.Db.listEpisodePage('B', 'show', { order: 'alpha', language: 'en' })).items[0].id, 'other-account');
    await h.Db.closePodcastDb('A');
    assert.equal((await h.Db.listEpisodePage('A', 'show', { order: 'alpha', language: 'en' })).items[0].id, 'replacement');
  } finally { h.close(); }
});

test('an old queued page never starts its SQL after ownership is invalidated', async () => {
  const h = database();
  try {
    await h.Db.replaceEpisodes('A', 'show', [episode('one', 1)]);
    let release!: () => void;
    h.gateNextWrite(() => new Promise<void>((resolve) => { release = resolve; }));
    const blocker = h.Db.addChannel('A', 'show'); await turn();
    let current = true;
    const before = h.reads.length, pending = h.Db.listEpisodePage('A', 'show', {}, () => current);
    const rejected = assert.rejects(pending, /scope changed/); current = false; release(); await blocker; await rejected;
    assert.equal(h.reads.length, before);
    assert.equal((await h.Db.listEpisodePage('A', 'show')).items.length, 1, 'a canceled read does not poison future reads');
  } finally { h.close(); }
});

test('a large alphabetical detail page yields during metadata sorting and aborts before publishing decoded notes', async () => {
  const h = database();
  try {
    await h.Db.replaceEpisodes('A', 'show', Array.from({ length: 800 }, (_, index) => episode(`id${index}`, index, `Name ${800 - index}`)));
    let current = true;
    const pending = h.Db.listEpisodePage('A', 'show', { order: 'alpha' }, () => current);
    const rejected = assert.rejects(pending, /scope changed/);
    setTimeout(() => { current = false; }, 0); await rejected;
    assert.equal(h.decoded(), 0, 'only id/title metadata may cross before the requested summary page');
    const valid = await h.Db.listEpisodePage('A', 'show', { order: 'alpha' });
    assert.equal(valid.items.length, 7); assert.equal(valid.total, 800);
    assert.equal(h.decoded(), 7);
  } finally { h.close(); }
});

test('the actual page API rejects wrong owners, caller abort and A to B to the same A object, while allowing cached manual-offline reads', async () => {
  const auth = createStore(() => ({ auth: { username: 'A' }, offline: false, autoOffline: false }));
  let finish!: (value: unknown) => void, calls = 0;
  const api = compile('../src/api/podcasts.ts', {
    'expo/fetch': {}, './netGate': { isManualOffline: () => auth.getState().offline && !auth.getState().autoOffline },
    '@/store/auth': { profileScopeId: () => auth.getState().auth.username, useAuthStore: auth },
    '@/store/podcastDownloads': {}, '@/store/player': {}, '@/lib/podcastProgress': {}, '@/lib/episodeResume': {},
    '@/lib/localLibrary': { hashKey: (value: string) => value }, '@/lib/query': {},
    '@/lib/podcastFeed': {}, '@/lib/podcastDirectory': directory,
    '@/lib/podcastFeedStream': { createPodcastFeedPreview },
    '@/lib/podcastDb': { listEpisodePage: async (_scope: string, _id: string, _options: unknown, current: () => boolean) => {
      calls++; const value = await new Promise((resolve) => { finish = resolve; }); if (!current()) throw new Error('stale'); return value;
    } },
  });
  await assert.rejects(api.listEpisodePage('show', {}, { expectedProfile: 'B' })); assert.equal(calls, 0);
  for (const mode of ['aba', 'abort']) {
    const ctl = new AbortController(), pending = api.listEpisodePage('show', { limit: 7 }, { expectedProfile: 'A', signal: ctl.signal });
    const rejected = assert.rejects(pending);
    if (mode === 'aba') { const before = auth.getState().auth; auth.setState({ auth: { username: 'B' } }); auth.setState({ auth: before }); }
    else ctl.abort();
    finish({ items: [], total: 0, nextOffset: null, seasons: [] }); await rejected;
  }
  auth.setState({ offline: true });
  const offline = api.listEpisodePage('show', {}, { expectedProfile: 'A' });
  finish({ items: [{ id: 'cached' }], total: 1, nextOffset: null, seasons: [] });
  assert.equal((await offline).items[0].id, 'cached');
});
