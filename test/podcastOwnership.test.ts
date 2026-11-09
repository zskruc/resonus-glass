import * as podcastStorageLease from '../src/lib/podcastStorageLease';
/** Production RSS + SQLite boundaries used by the discovery preview and Subscribe. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import { parseFeedAsync, sortEpisodes } from '../src/lib/podcastFeed';
import { createPodcastFeedPreview } from '../src/lib/podcastFeedStream';
import { podcastUrlExtension } from '../src/lib/podcastMedia';
import * as directory from '../src/lib/podcastDirectory';

const hash = (value: string) => [...value].reduce((total, letter) => Math.imul(total ^ letter.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
function compile(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, AbortController, Date, setTimeout, clearTimeout,
    require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
function harness() {
  const first = { username: 'A', serverUrl: 'https://account-a.test' };
  const auth = createStore(() => ({ auth: first, offline: false, autoOffline: false }));
  const scope = () => auth.getState().auth.username;
  const manual = () => auth.getState().offline && !auth.getState().autoOffline;
  class OfflineError extends Error {}
  const databases = new Map<string, DatabaseSync>();
  let gate: { matches: (sql: string) => boolean; work: () => Promise<void> } | undefined;
  const params = (values: any[]) => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  const fs = { documentDirectory: 'file:///sandbox/', makeDirectoryAsync: async () => {}, getInfoAsync: async () => ({ exists: false }),
    deleteAsync: async () => {}, readDirectoryAsync: async () => [] };
  const Db = compile('../src/lib/podcastDb.ts', {
    'expo-file-system/legacy': fs, '@/lib/localLibrary': { hashKey: hash }, './podcastMedia': { podcastUrlExtension }, '@/api/netGate': { isManualOffline: manual },
    'expo-sqlite': { openDatabaseAsync: async (_name: string, _options: unknown, dir: string) => {
      let raw = databases.get(dir); if (!raw) { raw = new DatabaseSync(':memory:'); databases.set(dir, raw); }
      const database = raw;
      return { execAsync: async (sql: string) => database.exec(sql),
        getFirstAsync: async (sql: string, ...values: any[]) => database.prepare(sql).get(...params(values)),
        getAllAsync: async (sql: string, ...values: any[]) => database.prepare(sql).all(...params(values)),
        runAsync: async (sql: string, ...values: any[]) => {
          if (gate?.matches(sql)) { const work = gate.work; gate = undefined; await work(); }
          return database.prepare(sql).run(...params(values));
        },
        withTransactionAsync: async (work: () => Promise<void>) => {
          database.exec('BEGIN'); try { await work(); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
        }, closeAsync: async () => {},
      };
    } },
  });
  const requests: { url: string; signal: AbortSignal }[] = [], invalidated: string[] = [];
  let bodyGate: Promise<void> | undefined;
  let xml = '<rss><channel><title>Preview Show</title><item><guid>first</guid><title>Episode</title>'
    + '<enclosure url="https://audio.test/one.mp3" type="audio/mpeg"/></item></channel></rss>';
  const Api = compile('../src/api/podcasts.ts', {
    'expo/fetch': { fetch: async (url: string, options: any) => {
      requests.push({ url, signal: options.signal });
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => { await bodyGate; return xml; } };
    } },
    './netGate': { isManualOffline: manual, OfflineError, assertCanRequest: (allow = false) => { if (manual() && !allow) throw new OfflineError(); } },
    '@/store/auth': { profileScopeId: scope, useAuthStore: auth }, '@/lib/localLibrary': { hashKey: hash },
    '@/store/podcastDownloads': { usePodcastDownloads: { getState: () => ({ download: async () => {}, deleteShow: async () => {} }) } },
    '@/store/player': {}, '@/lib/podcastProgress': {}, '@/lib/episodeResume': {},
    '@/lib/query': { queryClient: { invalidateQueries: async ({ queryKey }: any) => { invalidated.push(queryKey[0]); } } },
    '@/lib/podcastDb': Db, '@/lib/podcastFeed': { parseFeedAsync, sortEpisodes }, '@/lib/podcastDirectory': directory,
    '@/lib/podcastStorageLease': podcastStorageLease,
    '@/lib/podcastFeedStream': { createPodcastFeedPreview },
  });
  return { Api, Db, first, auth, requests, invalidated, profile: hash('A'),
    setXml: (value: string) => { xml = value; },
    switchTo: (username: string) => auth.setState({ auth: username === 'A' ? first : { username, serverUrl: `https://${username}.test` } }),
    body: (value?: Promise<void>) => { bodyGate = value; },
    gate: (matches: (sql: string) => boolean, work: () => Promise<void>) => { gate = { matches, work }; } };
}

test('publisher notes and chapter metadata survive the real RSS/API/SQLite roundtrip without automatically fetching companion files', async () => {
  const h = harness();
  h.setXml('<rss><channel><title>Show</title><itunes:type>serial</itunes:type><description><![CDATA[<p>Show notes</p>]]></description>'
    + '<item><guid>rich</guid><title>Episode</title><itunes:season>2</itunes:season><itunes:episode>3</itunes:episode><itunes:episodeType>bonus</itunes:episodeType>'
    + '<content:encoded><![CDATA[<h2>Topics</h2><p>00:30 Introduction</p>]]></content:encoded>'
    + '<psc:chapters><psc:chapter start="00:30" title="Topic"/></psc:chapters>'
    + '<podcast:chapters url="/chapters.json" type="application/json+chapters"/>'
    + '<podcast:transcript url="/notes.vtt" type="text/vtt" language="zh"/>'
    + '<enclosure url="https://audio.test/rich.mp3" type="audio/mpeg" length="1234"/></item></channel></rss>');
  const channel = await h.Api.refreshChannel('https://feed.test/rss');
  const stored = await h.Db.getChannel(h.profile, channel.id), episode = await h.Db.getEpisode(h.profile, `${channel.id}/rich`);
  assert.equal(stored.showType, 'serial'); assert.match(stored.descriptionHtml, /<p>Show notes<\/p>/);
  assert.equal(episode.season, 2); assert.equal(episode.episode, 3); assert.equal(episode.episodeType, 'bonus');
  assert.match(episode.descriptionHtml, /<h2>Topics<\/h2>/); assert.equal(episode.chapters[0].startSec, 30);
  assert.equal(episode.chaptersUrl, 'https://feed.test/chapters.json');
  assert.equal(episode.transcripts[0].url, 'https://feed.test/notes.vtt'); assert.equal(episode.size, 1234);
  assert.deepEqual(h.requests.map(({ url }) => url), ['https://feed.test/rss']);
});

test('an opened preview is stored but never appears in Home recent episodes or refresh-all subscription feeds', async () => {
  const h = harness(), preview = await h.Api.refreshChannel('https://feed.test/rss');
  assert.equal((await h.Api.getStoredChannel('feed.test/rss')).id, preview.id, 'same normalization as the RSS read');
  assert.equal((await h.Api.addedChannelIds()).size, 0);
  assert.equal((await h.Api.listRecentEpisodes()).length, 0); assert.equal((await h.Db.listFeeds(h.profile)).length, 0);
  await h.Api.subscribe('https://feed.test/rss');
  assert.equal((await h.Api.addedChannelIds()).size, 1); assert.equal((await h.Api.listRecentEpisodes()).length, 1);
  assert.deepEqual(Array.from(await h.Db.listFeeds(h.profile)), ['https://feed.test/rss']);
});

test('late stored-preview reads reject A to B to A and an already cancelled route before any subscription', async () => {
  const h = harness(); await h.Api.refreshChannel('https://feed.test/rss');
  const original = h.Db.getChannel, waiting = deferred(); let entered = false;
  h.Db.getChannel = async (...args: any[]) => { const row = await original(...args); entered = true; await waiting.promise; return row; };
  const work = h.Api.getStoredChannel('https://feed.test/rss', { expectedProfile: 'A' });
  const rejected = assert.rejects(work); while (!entered) await turn();
  h.switchTo('B'); h.switchTo('A'); waiting.resolve(); await rejected;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.Api.getStoredChannel('https://feed.test/rss', { signal: controller.signal }));
  assert.equal((await h.Api.addedChannelIds()).size, 0);
});

test('cancellation during the actual Subscribe INSERT rolls back the added row; another caller can still subscribe', async () => {
  const h = harness(), preview = await h.Api.refreshChannel('https://feed.test/rss'), blocked = deferred();
  let entered = false;
  h.gate((sql) => sql.startsWith('INSERT OR IGNORE INTO podcast_added'), async () => { entered = true; await blocked.promise; });
  const controller = new AbortController();
  const first = h.Api.subscribe('https://feed.test/rss', { signal: controller.signal, expectedProfile: 'A' });
  const rejected = assert.rejects(first);
  while (!entered) await turn(); controller.abort(); blocked.resolve(); await rejected;
  assert.equal((await h.Api.addedChannelIds()).size, 0, 'cancelled write did not commit');
  assert.equal((await h.Api.subscribe('https://feed.test/rss')).id, preview.id);
  assert.equal((await h.Api.addedChannelIds()).size, 1);
});

test('same-show concurrent subscriptions share an idempotent queued result and do not duplicate feed reads or added rows', async () => {
  const h = harness(), gate = deferred(); h.body(gate.promise);
  const first = h.Api.subscribe('https://feed.test/rss'), second = h.Api.subscribe('https://feed.test/rss');
  await turn(); assert.equal(h.requests.length, 1); gate.resolve();
  const [a, b] = await Promise.all([first, second]); assert.equal(a.id, b.id);
  assert.equal(h.requests.length, 1); assert.equal((await h.Api.addedChannelIds()).size, 1);
});

test('switching away and back during queued Subscribe INSERT cannot revive the first account task', async () => {
  const h = harness(); await h.Api.refreshChannel('https://feed.test/rss');
  const gate = deferred(); let entered = false;
  h.gate((sql) => sql.startsWith('INSERT OR IGNORE INTO podcast_added'), async () => { entered = true; await gate.promise; });
  const work = h.Api.subscribe('https://feed.test/rss'), rejected = assert.rejects(work);
  while (!entered) await turn(); h.switchTo('B'); h.switchTo('A'); gate.resolve(); await rejected;
  assert.equal((await h.Db.addedIds(hash('A'))).size, 0); assert.equal((await h.Db.addedIds(hash('B'))).size, 0);
});

test('manual offline can keep a fully cached preview, but cannot fetch a missing feed', async () => {
  const h = harness(); await h.Api.refreshChannel('https://feed.test/rss'); const before = h.requests.length;
  h.auth.setState({ offline: true, autoOffline: false });
  const cached = await h.Api.subscribe('https://feed.test/rss'); assert.ok(cached.id);
  assert.equal(h.requests.length, before); await assert.rejects(h.Api.subscribe('https://new-feed.test/rss'));
  assert.equal(h.requests.length, before); assert.equal((await h.Api.addedChannelIds()).size, 1);
});

test('automatic-offline to manual-offline permanently aborts the existing feed ticket even when offline stays true', async () => {
  const h = harness(); h.auth.setState({ offline: true, autoOffline: true });
  const gate = deferred(); h.body(gate.promise);
  const work = h.Api.refreshChannel('https://feed.test/rss'), rejected = assert.rejects(work); await turn();
  h.auth.setState({ autoOffline: false }); assert.equal(h.requests[0].signal.aborted, true);
  gate.resolve(); await rejected; assert.equal((await h.Api.addedChannelIds()).size, 0);
});

test('refresh-all stops the old batch after A to B to A instead of fetching its remaining subscriptions', async () => {
  const h = harness(); await h.Api.subscribe('https://one-feed.test/rss'); await h.Api.subscribe('https://two-feed.test/rss');
  const before = h.requests.length, gate = deferred(); h.body(gate.promise);
  const work = h.Api.refreshAll(); await turn(); assert.equal(h.requests.length, before + 1);
  h.switchTo('B'); h.switchTo('A'); gate.resolve(); const result = await work;
  assert.equal(result.stopped, true); assert.equal(result.failed, 0); assert.equal(h.requests.length, before + 1);
});
