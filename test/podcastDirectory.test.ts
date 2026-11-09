import * as podcastStorageLease from '../src/lib/podcastStorageLease';
import assert from 'node:assert/strict';
import { createPodcastFeedPreview } from '../src/lib/podcastFeedStream';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as Directory from '../src/lib/podcastDirectory';

const { decodePodcastDirectoryChart: chart, decodePodcastDirectorySearch: search,
  podcastAppleDirectoryId: appleId, podcastDirectoryArtwork: artwork,
  podcastDirectoryChartUrl: chartUrl, podcastDirectorySearchUrl: searchUrl,
  podcastDirectoryLookupUrl: lookupUrl, normalizePodcastDirectoryCountry: country,
  PODCAST_DIRECTORY_GENRES: genres } = Directory;
const entry = (id: string | number, title = `Show ${id}`) => ({
  id: { attributes: { 'im:id': String(id) } }, 'im:name': { label: title },
  'im:artist': { label: 'An author' }, 'im:image': [
    { label: 'https://is1-ssl.mzstatic.com/image/thumb/x/55x55bb.jpg', attributes: { height: '55' } },
    { label: 'https://is1-ssl.mzstatic.com/image/thumb/x/170x170bb.png', attributes: { height: '170' } },
  ], category: { attributes: { label: 'Music' } },
});
const result = (id: number, extra: Record<string, unknown> = {}) => ({
  kind: 'podcast', collectionId: id, collectionName: `Show ${id}`,
  feedUrl: `https://feeds.test/${id}.xml`, artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg', ...extra,
});
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('all 19 category URLs, search and lookup use a normalized explicit store without accepting path injection', () => {
  assert.equal(genres.length, 19); assert.equal(new Set(genres.map((item) => item.id)).size, 19);
  assert.equal(country(' CN '), 'cn'); assert.equal(country('../us'), 'us'); assert.equal(country('USA'), 'us');
  for (const genre of genres) assert.equal(chartUrl('GB', genre.id), `https://itunes.apple.com/gb/rss/toppodcasts/limit=50/genre=${genre.id}/json`);
  const query = new URL(searchUrl('SZA & friends', 'CN'));
  assert.equal(query.searchParams.get('term'), 'SZA & friends'); assert.equal(query.searchParams.get('country'), 'cn');
  assert.equal(query.searchParams.get('entity'), 'podcast'); assert.equal(query.searchParams.get('limit'), '40');
  const lookup = new URL(lookupUrl([2, 2, -1, NaN, 1], 'GB'));
  assert.equal(lookup.searchParams.get('id'), '2,1'); assert.equal(lookup.searchParams.get('country'), 'gb');
  assert.throws(() => chartUrl('us', 999999), /response/);
  assert.throws(() => lookupUrl([0, NaN]), /response/);
});

test('official Apple show and episode URLs resolve the show ID, while lookalike hosts and invalid IDs do not', () => {
  for (const link of ['https://podcasts.apple.com/cn/podcast/a-show/id123?i=999',
    'https://itunes.apple.com/us/podcast/id123', 'podcasts.apple.com/gb/podcast/show/id123',
    'https://itunes.apple.com/WebObjects/MZStore.woa/wa/viewPodcast?id=123']) assert.equal(appleId(link), 123);
  for (const link of ['https://podcasts.apple.com.evil.test/podcast/id123',
    'https://user:password@podcasts.apple.com/podcast/id123', 'https://evil.test/?id=123',
    'https://podcasts.apple.com/podcast/id0', 'https://podcasts.apple.com/podcast/id9007199254740992',
    'https://podcasts.apple.com:8080/podcast/id123', 'https://podcasts.apple.com/podcast/show?i=123',
    'file:///podcasts.apple.com/podcast/id123']) assert.equal(appleId(link), undefined, link);
});

test('chart decoding preserves rank and order, handles singleton/empty entries and rejects malformed responses', () => {
  const shows = chart({ feed: { entry: [entry(30), entry(10), entry(30), null, entry(20)] } });
  assert.deepEqual(shows.map((item) => [item.id, item.rank]), [[30, 1], [10, 2], [20, 5]]);
  assert.equal(shows[0].feedUrl, undefined); assert.match(shows[0].imageUrl!, /600x600bb\.png$/);
  assert.equal(chart({ feed: { entry: entry(7) } })[0].id, 7);
  assert.deepEqual(chart({ feed: {} }), []);
  for (const malformed of [null, {}, { error: 'bad' }, { feed: { entry: 'bad' } }]) assert.throws(() => chart(malformed), /response/);
});

test('search decoding prefers high resolution, rejects non-podcast/unsafe rows and distinguishes an empty result from a bad payload', () => {
  const shows = search({ results: [null, result(2, { artworkUrl600: 'https://art.test/high.jpg', trackCount: 42, releaseDate: '2026-11-09T12:00:00Z' }),
    result(2), result(3, { kind: 'song' }), result(4, { feedUrl: 'javascript:alert(1)', artworkUrl600: 'file:///private/a.jpg' }),
    result(0), result(5, { collectionName: ' ' })] });
  assert.deepEqual(shows.map((show) => show.id), [2, 4]);
  assert.equal(shows[0].imageUrl, 'https://art.test/high.jpg'); assert.equal(shows[0].episodeCount, 42);
  assert.equal(shows[0].latestReleaseAt, Date.parse('2026-11-09T12:00:00Z'));
  assert.equal(shows[1].feedUrl, undefined); assert.match(shows[1].imageUrl!, /600x600bb\.jpg$/);
  assert.deepEqual(search({ results: [] }), []); assert.throws(() => search({}), /response/);
  assert.equal(artwork('https://publisher.test/100x100bb.jpg?signature=kept'), 'https://publisher.test/100x100bb.jpg?signature=kept');
  assert.equal(artwork('https://is1-ssl.mzstatic.com/image/170x170bb.jpg?l=en'), 'https://is1-ssl.mzstatic.com/image/600x600bb.jpg?l=en');
});

function apiHarness() {
  let state = { auth: { username: 'one', serverUrl: 'https://private-server.test', token: 'private-token' }, offline: false };
  const listeners = new Set<(next: typeof state, previous: typeof state) => void>();
  const auth = { getState: () => state, subscribe: (listener: (next: typeof state, previous: typeof state) => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const requests: { url: string; options: any }[] = [];
  const timers = new Map<number, { run: () => void; ms: number }>(); let timerId = 0;
  const queue: ((url: string, options: any) => Promise<unknown>)[] = [];
  class OfflineError extends Error {}
  const imports: Record<string, unknown> = {
    'expo/fetch': { fetch: async (url: string, options: any) => {
      requests.push({ url, options });
      const next = queue.shift(); assert.ok(next, `Unexpected request ${url}`); return next(url, options);
    } },
    './netGate': { isManualOffline: () => state.offline, assertCanRequest: (allowed: boolean) => { if (!allowed) throw new OfflineError(); }, OfflineError },
    '@/store/auth': { profileScopeId: () => state.auth.username, useAuthStore: auth },
    '@/store/podcastDownloads': {}, '@/store/player': {}, '@/lib/podcastProgress': {}, '@/lib/episodeResume': {},
    '@/lib/localLibrary': { hashKey: (value: string) => value }, '@/lib/query': {}, '@/lib/podcastDb': {}, '@/lib/podcastFeed': {},
    '@/lib/podcastDirectory': Directory,
    '@/lib/podcastStorageLease': podcastStorageLease,
    '@/lib/podcastFeedStream': { createPodcastFeedPreview },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/api/podcasts.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, URL, AbortController, TextEncoder, TextDecoder,
    setTimeout: (run: () => void, ms: number) => { timers.set(++timerId, { run, ms }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    require(id: string) { assert.ok(Object.hasOwn(imports, id), id); return imports[id]; } });
  return { api: exports, requests, timers, queue,
    json(value: unknown) { queue.push(async () => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })); },
    change(next: Partial<typeof state>) { const before = state; state = { ...state, ...next }; for (const listener of listeners) listener(state, before); },
    state: () => state,
  };
}

test('Discovery initially makes one chart request, sends no media-server credentials and resolves only the selected show', async () => {
  const h = apiHarness(); h.json({ feed: { entry: [entry(2), entry(1)] } });
  const rows = await h.api.directoryCharts({ country: 'CN', genreId: 1324 });
  assert.deepEqual(plain(rows.map((item: any) => item.id)), [2, 1]); assert.equal(h.requests.length, 1);
  h.json({ results: [result(2)] });
  assert.equal((await h.api.directoryLookup(rows[0].id, { country: 'CN' })).feedUrl, 'https://feeds.test/2.xml');
  assert.equal(new URL(h.requests[1].url).searchParams.get('country'), 'cn');
  for (const request of h.requests) {
    assert.equal(new URL(request.url).hostname, 'itunes.apple.com');
    assert.deepEqual(plain(request.options.headers), { accept: 'application/json' });
    assert.equal(request.options.credentials, 'omit');
    assert.doesNotMatch(JSON.stringify(request), /private-token|private-server/);
  }
  assert.equal(h.timers.size, 0);
});

test('Apple links use lookup, normal searches consistently use the selected store and empty queries make no request', async () => {
  const h = apiHarness(); assert.deepEqual(plain(await h.api.directorySearch('  ')), []);
  h.json({ results: [result(2)] });
  assert.equal((await h.api.directorySearch('https://podcasts.apple.com/us/podcast/show/id2?i=99', { country: 'GB' }))[0].id, 2);
  assert.equal(new URL(h.requests[0].url).pathname, '/lookup');
  assert.equal(new URL(h.requests[0].url).searchParams.get('country'), 'gb');
  h.json({ results: [result(3)] }); await h.api.directorySearch('a show', { country: 'GB' });
  assert.equal(new URL(h.requests[1].url).pathname, '/search');
  assert.equal(new URL(h.requests[1].url).searchParams.get('country'), 'gb');
});

test('legacy add-sheet search keeps only unique subscribable feeds and legacy charts retain rank across an out-of-order lookup', async () => {
  const h = apiHarness(); h.json({ results: [result(1), result(2, { feedUrl: undefined }), result(3, { feedUrl: 'https://feeds.test/1.xml' })] });
  const rows = await h.api.search('show'); assert.deepEqual(plain(rows.map((item: any) => item.feedUrl)), ['https://feeds.test/1.xml']);
  assert.equal(new URL(h.requests[0].url).searchParams.get('limit'), '25');
  h.json({ feed: { entry: [entry(3), entry(1), entry(2)] } });
  h.json({ results: [result(2), result(1), result(3)] });
  const ordered = await h.api.charts({ country: 'CA' });
  assert.deepEqual(plain(ordered.map((item: any) => item.title)), ['Show 3', 'Show 1', 'Show 2']);
  assert.match(h.requests[1].url, /\/ca\/rss\/toppodcasts\/limit=100\/json$/);
  assert.equal(new URL(h.requests[2].url).searchParams.get('country'), 'ca');
});

test('caller cancellation and the 20-second deadline reject even a stalled transport, without retries or lingering timers', async () => {
  const cancelled = apiHarness(), signal = new AbortController();
  cancelled.queue.push(async () => new Promise(() => {}));
  const pending = cancelled.api.directorySearch('show', { signal: signal.signal });
  signal.abort(); await assert.rejects(pending, (error: any) => error.code === 'stopped');
  assert.equal(cancelled.requests[0].options.signal.aborted, true); assert.equal(cancelled.timers.size, 0);
  const timed = apiHarness(); timed.queue.push(async () => new Promise(() => {}));
  const slow = timed.api.directoryCharts(); const timer = [...timed.timers.values()][0]; assert.equal(timer.ms, 20_000);
  timer.run(); await assert.rejects(slow, (error: any) => error.code === 'timeout');
  assert.equal(timed.requests.length, 1); assert.equal(timed.timers.size, 0); assert.equal(timed.requests[0].options.signal.aborted, true);
  const before = apiHarness(), aborted = new AbortController(); aborted.abort();
  await assert.rejects(before.api.directoryCharts({ signal: aborted.signal }), (error: any) => error.code === 'stopped');
  assert.equal(before.requests.length, 0);
});

test('manual offline blocks discovery and an A-to-B-to-A account change cannot revive an old body', async () => {
  const offline = apiHarness(); offline.change({ offline: true });
  await assert.rejects(offline.api.directoryCharts(), (error: any) => error.code === 'offline'); assert.equal(offline.requests.length, 0);
  const h = apiHarness(), first = h.state().auth;
  let release!: () => void;
  h.queue.push(async () => ({ ok: true, headers: new Headers(), body: null, text: async () => {
    await new Promise<void>((done) => { release = done; }); return JSON.stringify({ results: [result(1)] });
  } }));
  const pending = h.api.directorySearch('show'); await turn();
  const rejected = assert.rejects(pending, (error: any) => error.code === 'stopped');
  h.change({ auth: { ...first, username: 'two' } }); h.change({ auth: first }); release(); await rejected;
  assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(h.timers.size, 0);
});

test('oversized headers, streamed bodies and invalid JSON fail visibly instead of producing a successful empty list', async () => {
  for (const mode of ['headers', 'stream', 'json', 'http']) {
    const h = apiHarness();
    h.queue.push(async () => mode === 'headers' ? new Response('', { headers: { 'content-length': String(3 * 1024 * 1024) } })
      : mode === 'stream' ? new Response(new Uint8Array(2 * 1024 * 1024 + 1))
        : mode === 'json' ? new Response('<html>error</html>') : new Response('rate limited', { status: 429 }));
    await assert.rejects(h.api.directoryCharts(), (error: any) => error.code === (mode === 'http' ? 'http' : mode === 'json' ? 'response' : 'tooLarge'));
    assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
    assert.equal(h.requests[0].options.signal.aborted, true);
  }
});
