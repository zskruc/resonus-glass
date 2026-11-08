import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as resume from '../src/lib/episodeResume';
import { createStore } from 'zustand/vanilla';

function execute(source: string, values: Record<string, unknown>, imports: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, ...values, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
function library(profile = 'A', db: Record<string, unknown> = {}): Record<string, any> {
  const auth = createStore(() => ({ auth: { name: profile }, offline: false, autoOffline: false, offlineSource: null }));
  const authModule = { profileScopeId: () => auth.getState().auth.name, useAuthStore: auth };
  const epoch = execute(readFileSync(new URL('../src/lib/lyricOwner.ts', import.meta.url), 'utf8'), {}, { '@/store/auth': authModule });
  const mod = execute(readFileSync(new URL('../src/lib/podcastLibrary.ts', import.meta.url), 'utf8'), {}, {
    './episodeResume': resume, './localLibrary': { hashKey: (value: string) => value }, './podcastDb': db,
    './lyricOwner': epoch, '@/store/auth': authModule,
  });
  return { ...mod, switch(name: string) { auth.setState({ auth: { name } }); },
    roundTrip() { const before = auth.getState().auth; auth.setState({ auth: { name: 'B' } }); auth.setState({ auth: before }); } };
}

test('the production cross-show SQL returns only subscribed shows, respects real progress and downloads, and paginates before decoding', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE podcast_channels(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE podcast_added(channel_id TEXT PRIMARY KEY);
    CREATE TABLE podcast_episodes(id TEXT PRIMARY KEY,channel_id TEXT,published_at INTEGER,url TEXT,data TEXT);
    CREATE TABLE podcast_progress(episode_id TEXT,position_sec REAL,duration_sec REAL,updated_at INTEGER);
    CREATE TABLE podcast_downloads(episode_id TEXT,file TEXT,downloaded_at INTEGER);`);
  for (const id of ['one', 'two', 'preview']) {
    db.prepare('INSERT INTO podcast_channels VALUES (?,?)').run(id, JSON.stringify({ id, title: id }));
    if (id !== 'preview') db.prepare('INSERT INTO podcast_added VALUES (?)').run(id);
  }
  const rows = [
    { id: 'partial', channel: 'one', date: 10, position: 100, duration: 600, updated: 20 },
    { id: 'finished', channel: 'one', date: 40, position: 590, duration: 600, updated: 50 },
    { id: 'new', channel: 'two', date: 30, position: 0, duration: 600, updated: 0, downloaded: 100 },
    { id: 'unknown-time', channel: 'two', date: 20, position: 50, duration: 0, updated: 40 },
    { id: 'offline-only', channel: 'two', date: 0, position: 0, duration: 300, updated: 0, downloaded: 200 },
    { id: 'not-subscribed', channel: 'preview', date: 100, position: 50, duration: 600, updated: 100, downloaded: 300 },
  ];
  for (const row of rows) {
    db.prepare('INSERT INTO podcast_episodes VALUES (?,?,?,?,?)').run(row.id, row.channel, row.date, row.id === 'offline-only' ? null : 'https://audio.test/file', JSON.stringify({ id: row.id, channelId: row.channel, title: row.id, duration: row.duration,
      description: 'n'.repeat(1000), descriptionHtml: '<p>long notes</p>', chapters: [{ startSec: 0, title: 'intro' }], transcripts: [{ url: 'https://text.test' }], season: 2, episode: 5, mimeType: 'audio/mpeg' }));
    db.prepare('INSERT INTO podcast_progress VALUES (?,?,?,?)').run(row.id, row.position, row.duration, row.updated);
    if (row.downloaded) db.prepare('INSERT INTO podcast_downloads VALUES (?,?,?)').run(row.id, 'file:///episode', row.downloaded);
  }
  const ast = ts.createSourceFile('podcastDb.ts', readFileSync(new URL('../src/lib/podcastDb.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'listLibraryEpisodes')!;
  let reads = 0;
  const production = execute(fn.getText(ast), {
    podcastDb: async () => ({ getAllAsync: async (sql: string, params: any[]) => { reads++; return db.prepare(sql).all(...params); } }),
    serialized: (read: () => unknown) => read(),
  });
  try {
    const ids = async (filter: string, limit = 80, offset = 0, search = '') => Array.from(await production.listLibraryEpisodes('A', filter, limit, offset, search), (value: any) => value.episode.id);
    assert.deepEqual(await ids('continue'), ['unknown-time', 'partial']);
    assert.deepEqual(await ids('continue', 1, 1), ['partial']);
    assert.deepEqual(await ids('unplayed'), ['new', 'unknown-time', 'partial', 'offline-only']);
    assert.deepEqual(await ids('downloaded'), ['offline-only', 'new']);
    assert.equal(reads, 4, 'each shelf page is one bounded SQL query, never one read per show');
    assert.deepEqual(await ids('unplayed', 1, 0, 'UNKNOWN-TIME'), ['unknown-time'], 'search runs before pagination, including a match beyond the original first page');
    assert.deepEqual(await ids('unplayed', 1, 1, 'two'), ['unknown-time'], 'show titles are searched in SQL across all matching pages');
    assert.deepEqual(await ids('unplayed', 80, 0, '%'), [], 'search input is literal text, not SQL wildcards');
    const compact = (await production.listLibraryEpisodes('A', 'continue', 1, 0))[0].episode;
    assert.equal(compact.description.length, 512); assert.equal(compact.descriptionHtml, undefined);
    assert.equal(compact.chapters, undefined); assert.equal(compact.transcripts, undefined);
    assert.equal(compact.season, 2); assert.equal(compact.episode, 5); assert.equal(compact.mimeType, 'audio/mpeg');
  } finally { db.close(); }
});

test('listening state and episode filters retain unknown duration, actual remaining time, seasons and completion boundaries', () => {
  const h = library(), episode = { id: 'a', title: 'A', channelId: 'show', duration: 600, season: 2 };
  assert.equal(h.podcastListeningState(episode, { positionSec: 200, durationSec: 600 }).remaining, 400);
  assert.equal(h.podcastListeningState(episode, { positionSec: 590, durationSec: 600 }).played, true);
  assert.equal(h.podcastListeningState({ ...episode, duration: undefined }, { positionSec: 90, durationSec: 0 }).resume, 90);
  const other = { ...episode, id: 'b', season: undefined }, progress = new Map([['a', { positionSec: 200, durationSec: 600 }]]);
  assert.deepEqual(Array.from(h.filterPodcastEpisodes([episode, other], 'progress', progress, {}, 2), (value: any) => value.id), ['a']);
  assert.deepEqual(Array.from(h.filterPodcastEpisodes([episode, other], 'downloaded', progress, { b: 'file:///b' }, 'other'), (value: any) => value.id), ['b']);
  assert.equal(h.podcastListeningState(episode, { positionSec: 200, durationSec: 600 }, 300).remaining, 300, 'only a real current-player position overrides saved progress');
});

test('profile-owned shelf and progress reads reject late accounts and cancellation without starting a network request', async () => {
  let finish!: (value: unknown[]) => void;
  const h = library('A', { listLibraryEpisodes: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = h.readPodcastLibrary('continue', 0, 'A'); h.switch('B'); finish([]);
  await assert.rejects(pending, /owner changed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.readPodcastShowProgress('show', 'B', controller.signal), /owner changed/);
});

test('an actual auth epoch rejects both SQL read results after A → B → the same A object', async () => {
  for (const kind of ['library', 'progress']) {
    let finish!: (value: unknown[]) => void;
    const read = () => new Promise((resolve) => { finish = resolve; });
    const h = library('A', { listLibraryEpisodes: read, listEpisodeProgress: read });
    const pending = kind === 'library' ? h.readPodcastLibrary('continue', 0, 'A') : h.readPodcastShowProgress('show', 'A');
    h.roundTrip(); finish([]); await assert.rejects(pending, /owner changed/);
  }
});
