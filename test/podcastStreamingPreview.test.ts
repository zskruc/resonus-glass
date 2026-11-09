/** Real RSS reader → canonical episode parser → actual SQLite partial/full snapshots. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import { parseFeed, parseFeedAsync, sortEpisodes } from '../src/lib/podcastFeed';
import { podcastUrlExtension } from '../src/lib/podcastMedia';
import * as directory from '../src/lib/podcastDirectory';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const hash = (value: string) => [...value].reduce((total, letter) => Math.imul(total ^ letter.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
async function within<T>(value: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try { return await Promise.race([value, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Expected streaming milestone did not occur')), 5000); })]); }
  finally { clearTimeout(timer); }
}
function compile(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, AbortController, Date, TextDecoder, TextEncoder, Uint8Array, setTimeout, clearTimeout,
    require(name: string) { assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`); return imports[name]; } });
  return exports;
}
const feedUrl = 'https://feed.test/stream.xml';
const header = '<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Real streamed show</title><itunes:author>Publisher</itunes:author>';
const item = (index: number) => `<item><guid>stable-${index}</guid><title>Episode ${index}</title><pubDate>${new Date(Date.UTC(2026, 10, 10 - index)).toUTCString()}</pubDate><itunes:duration>600</itunes:duration><enclosure url="https://audio.test/${index}.mp3" type="audio/mpeg"/></item>`;
const prefix = header + Array.from({ length: 7 }, (_, index) => item(index)).join('');
const tail = Array.from({ length: 5 }, (_, index) => item(index + 7)).join('') + '</channel></rss>';
const complete = prefix + tail;

function response(first = prefix) {
  const rest = deferred<ReadableStreamReadResult<Uint8Array>>(), waiting = deferred<void>();
  let reads = 0, canceled = 0, released = 0, textReads = 0;
  const reader = {
    read: async () => {
      if (reads++ === 0) return { done: false as const, value: new TextEncoder().encode(first) };
      if (reads === 2) { waiting.resolve(); return rest.promise; }
      return { done: true as const, value: undefined };
    },
    cancel: async () => { canceled++; rest.resolve({ done: true, value: undefined }); },
    releaseLock: () => { released++; },
  };
  return { value: { ok: true, status: 200, headers: { get: (name: string) => name.toLowerCase() === 'etag' ? 'fresh-validator' : null },
    body: { getReader: () => reader }, text: async () => { textReads++; const last = await rest.promise; return first + (last.value ? new TextDecoder().decode(last.value) : ''); } },
  waiting: waiting.promise, finish: (last = tail) => rest.resolve({ done: false, value: new TextEncoder().encode(last) }),
  fail: (reason = new Error('Publisher disconnected')) => rest.reject(reason),
  stats: () => ({ reads, canceled, released, textReads }) };
}

function harness() {
  const first = { username: 'A', serverUrl: 'https://account.test' };
  const auth = createStore(() => ({ auth: first, offline: false, autoOffline: false }));
  const profile = hash('A'), channelId = hash(feedUrl);
  const databases = new Map<string, DatabaseSync>(), files = new Map<string, number>();
  let gate: { matches(sql: string): boolean; run(): Promise<void> } | undefined;
  const args = (values: any[]) => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  const fs = { documentDirectory: 'file:///sandbox/', makeDirectoryAsync: async () => {},
    getInfoAsync: async (uri: string) => ({ exists: files.has(uri), size: files.get(uri) ?? 0 }),
    deleteAsync: async (uri: string) => { files.delete(uri); }, readDirectoryAsync: async () => [] };
  const Db = compile('../src/lib/podcastDb.ts', {
    'expo-file-system/legacy': fs, '@/lib/localLibrary': { hashKey: hash }, './podcastMedia': { podcastUrlExtension },
    '@/api/netGate': { isManualOffline: () => false },
    'expo-sqlite': { openDatabaseAsync: async (_name: string, _options: unknown, dir: string) => {
      let raw = databases.get(dir); if (!raw) { raw = new DatabaseSync(':memory:'); databases.set(dir, raw); }
      const db = raw;
      return { execAsync: async (sql: string) => db.exec(sql),
        getFirstAsync: async (sql: string, ...values: any[]) => db.prepare(sql).get(...args(values)) ?? null,
        getAllAsync: async (sql: string, ...values: any[]) => db.prepare(sql).all(...args(values)),
        runAsync: async (sql: string, ...values: any[]) => {
          const result = db.prepare(sql).run(...args(values));
          if (gate?.matches(sql)) { const block = gate.run; gate = undefined; await block(); }
          return result;
        },
        withTransactionAsync: async (work: () => Promise<void>) => {
          db.exec('BEGIN'); try { await work(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
        }, closeAsync: async () => {},
      };
    } },
  });
  const manual = () => auth.getState().offline && !auth.getState().autoOffline;
  const responses: ReturnType<typeof response>[] = [], requests: any[] = [], downloaded: any[] = [];
  const imports: Record<string, unknown> = {
    'expo/fetch': { fetch: async (url: string, options: any) => {
      requests.push({ url, ...options }); const next = responses.shift(); assert.ok(next, 'unexpected extra request'); return next.value;
    } },
    './netGate': { assertCanRequest() { if (manual()) throw new Error('Offline'); }, isManualOffline: manual, OfflineError: class extends Error {} },
    '@/store/auth': { profileScopeId: () => auth.getState().auth.username, useAuthStore: auth },
    '@/lib/localLibrary': { hashKey: hash },
    '@/store/podcastDownloads': { usePodcastDownloads: { getState: () => ({ download: async (...values: any[]) => { downloaded.push(values); }, deleteShow: async () => {} }) } },
    '@/store/player': {}, '@/lib/podcastProgress': {}, '@/lib/episodeResume': {},
    '@/lib/query': { queryClient: { invalidateQueries: async () => {} } },
    '@/lib/podcastDb': Db, '@/lib/podcastFeed': { parseFeed, parseFeedAsync, sortEpisodes }, '@/lib/podcastDirectory': directory,
  };
  // Run the production lexical stream reader too; transport and filesystem are the only fakes.
  imports['@/lib/podcastFeedStream'] = compile('../src/lib/podcastFeedStream.ts', { '@/lib/podcastFeed': imports['@/lib/podcastFeed'], './podcastFeed': imports['@/lib/podcastFeed'], './podcastXml': compile('../src/lib/podcastXml.ts', {}) });
  const Api = compile('../src/api/podcasts.ts', imports);
  const controller = new AbortController();
  return { Api, Db, auth, first, profile, channelId, files, requests, downloaded, controller,
    enqueue: (next: ReturnType<typeof response>) => { responses.push(next); },
    gate: (matches: (sql: string) => boolean, run: () => Promise<void>) => { gate = { matches, run }; },
    close: async () => { controller.abort(); for (const db of databases.values()) db.close(); } };
}

// The callback's occurrence, not a fixed sleep, proves rows landed before the second chunk.
test('first seven canonical playable RSS episodes commit and publish while the remaining network body is held', async () => {
  const h = harness(), stream = response(), preview = deferred<any>(); h.enqueue(stream);
  let finished = false;
  const work: Promise<any> = h.Api.refreshChannel(feedUrl, { signal: h.controller.signal, onPreview: (channel: any) => preview.resolve(channel) });
  void work.then(() => { finished = true; }, () => {});
  try {
    const partial = await within(preview.promise);
    assert.equal(finished, false); assert.equal(partial.id, h.channelId); assert.equal(partial.syncComplete, false);
    assert.equal(partial.etag, undefined); assert.equal(partial.lastModified, undefined); assert.equal(partial.refreshedAt, undefined);
    const first = await h.Db.listAllEpisodes(h.profile, h.channelId);
    assert.equal(first.length, 7); assert.equal(first[0].id, `${h.channelId}/stable-0`); assert.equal(first[6].id, `${h.channelId}/stable-6`);
    assert.equal(first.every((episode: any) => episode.url?.startsWith('https://audio.test/')), true);
    assert.equal(first.every((episode: any) => Number.isFinite(episode.firstSeenAt) && episode.firstSeenAt > 0), true);
    const playable = h.Api.episodeToSong(first[0], partial);
    assert.equal(playable.id, first[0].id, 'first-page playback uses the eventual RSS identity');
    assert.equal(playable.url, first[0].url); assert.equal(playable.podcastChannelId, h.channelId);
    assert.equal(h.requests.length, 1); assert.equal(stream.stats().textReads, 0);
    const seen = new Map(first.map((episode: any) => [episode.id, episode.firstSeenAt]));
    await h.Db.saveEpisodeProgress(h.profile, { id: first[0].id, channelId: h.channelId, positionSec: 140, durationSec: 600 });
    h.files.set('file:///saved.mp3', 80); await h.Db.saveDownload(h.profile, first[0], 'file:///saved.mp3', 80);
    await h.Db.setAutoDownload(h.profile, h.channelId, true);
    stream.finish(); const full = await within(work);
    assert.equal(full.syncComplete, true); assert.equal(full.etag, 'fresh-validator'); assert.equal(full.episodeCount, 12);
    assert.equal(full.newSinceAt, undefined); assert.equal(h.downloaded.length, 0, 'historic remainder of a first partial sync is not a new automatic-download batch');
    const all = await h.Db.listAllEpisodes(h.profile, h.channelId); assert.equal(all.length, 12);
    for (const episode of all.slice(0, 7)) assert.equal(episode.firstSeenAt, seen.get(episode.id));
    assert.equal((await h.Db.getEpisodeProgress(h.profile, first[0].id)).positionSec, 140);
    assert.equal((await h.Db.listDownloads(h.profile))[first[0].id], 'file:///saved.mp3');
    assert.equal(h.files.has('file:///saved.mp3'), true);
  } finally { h.controller.abort(); await work.catch(() => {}); await h.close(); }
});

test('disconnect or cancellation after the first seven keeps an incomplete usable snapshot and never sends partial validators', async () => {
  for (const operation of ['failure', 'abort', 'account'] as const) {
    const h = harness(), firstStream = response(), preview = deferred<any>(); h.enqueue(firstStream);
    const work: Promise<any> = h.Api.refreshChannel(feedUrl, { signal: h.controller.signal, onPreview: (channel: any) => preview.resolve(channel) });
    const rejected = assert.rejects(work);
    try {
      await within(preview.promise);
      if (operation === 'failure') firstStream.fail();
      else if (operation === 'abort') h.controller.abort();
      else { h.auth.setState({ auth: { username: 'B', serverUrl: 'https://other.test' } }); h.auth.setState({ auth: h.first }); }
      await within(rejected);
      const partial = await h.Db.getChannel(h.profile, h.channelId);
      assert.equal(partial.syncComplete, false); assert.equal(partial.etag, undefined); assert.equal(partial.lastModified, undefined);
      assert.equal((await h.Db.listAllEpisodes(h.profile, h.channelId)).length, 7);
      const retryStream = response(complete); retryStream.finish(''); h.enqueue(retryStream);
      const full = await h.Api.refreshChannel(feedUrl);
      assert.equal(full.syncComplete, true); assert.equal(full.episodeCount, 12);
      assert.equal(h.requests[1].headers['if-none-match'], undefined); assert.equal(h.requests[1].headers['if-modified-since'], undefined);
    } finally { h.controller.abort(); await work.catch(() => {}); await h.close(); }
  }
});

test('an existing full catalog is never downgraded or pruned by a later first-seven stream preview', async () => {
  const h = harness(), initial = response(complete); initial.finish(''); h.enqueue(initial);
  await h.Api.refreshChannel(feedUrl);
  const original = await h.Db.getChannel(h.profile, h.channelId), before = await h.Db.listAllEpisodes(h.profile, h.channelId);
  const next = response(prefix.replace('Real streamed show', 'New partial title')); h.enqueue(next);
  const work: Promise<any> = h.Api.refreshChannel(feedUrl, { signal: h.controller.signal, onPreview() {} });
  const rejected = assert.rejects(work);
  try {
    await within(next.waiting);
    assert.equal((await h.Db.getChannel(h.profile, h.channelId)).syncComplete, true);
    assert.equal((await h.Db.getChannel(h.profile, h.channelId)).title, original.title);
    assert.deepEqual((await h.Db.listAllEpisodes(h.profile, h.channelId)).map((episode: any) => episode.id), before.map((episode: any) => episode.id));
    h.controller.abort(); await within(rejected);
    assert.equal((await h.Db.listAllEpisodes(h.profile, h.channelId)).length, 12);
  } finally { h.controller.abort(); await work.catch(() => {}); await h.close(); }
});

test('full queue and completeness reads wait for a promotion transaction instead of observing its cleared episode table', async () => {
  const h = harness(), entered = deferred<void>(), release = deferred<void>();
  const parsed = await parseFeedAsync(complete, h.channelId, feedUrl);
  const before = parsed.items.map((episode) => ({ ...episode, channelId: h.channelId }));
  await h.Db.saveFeedSnapshot(h.profile, { id: h.channelId, title: 'Before', feedUrl }, before);
  h.gate((sql) => sql.startsWith('DELETE FROM podcast_episodes WHERE channel_id'), async () => { entered.resolve(); await release.promise; });
  const reads: Promise<unknown>[] = [];
  const promotion: Promise<void> = h.Db.saveFeedSnapshot(h.profile, { id: h.channelId, title: 'After', feedUrl }, before);
  try {
    await within(entered.promise);
    let queueRead = false, channelRead = false;
    const queue: Promise<any[]> = h.Db.listAllEpisodes(h.profile, h.channelId).then((value: any[]) => { queueRead = true; return value; });
    const channel: Promise<any> = h.Db.getChannel(h.profile, h.channelId).then((value: any) => { channelRead = true; return value; });
    reads.push(queue, channel);
    await turn();
    assert.equal(queueRead, false, 'playback cannot observe the DELETE-to-INSERT gap on the shared SQLite connection');
    assert.equal(channelRead, false, 'completeness metadata cannot escape the uncommitted generation');
    release.resolve(); await promotion;
    assert.equal((await queue).length, 12); assert.equal((await channel).title, 'After');
    assert.equal((await channel).syncComplete, true);
  } finally { release.resolve(); await promotion.catch(() => {}); await Promise.allSettled(reads); await h.close(); }
});

test('an onPreview-only caller also receives the first seven without requiring an abort or profile option', async () => {
  const h = harness(), stream = response(), preview = deferred<any>(); h.enqueue(stream);
  const work: Promise<any> = h.Api.refreshChannel(feedUrl, { onPreview: (channel: any) => preview.resolve(channel) });
  void work.catch(() => {});
  try {
    const partial = await within(preview.promise);
    assert.equal(partial.syncComplete, false); assert.equal(partial.id, h.channelId);
    assert.equal((await h.Db.listAllEpisodes(h.profile, h.channelId)).length, 7);
    assert.equal(h.requests.length, 1); assert.equal(stream.stats().textReads, 0);
    stream.finish(); assert.equal((await within(work)).syncComplete, true);
  } finally { stream.finish(); await work.catch(() => {}); await h.close(); }
});
