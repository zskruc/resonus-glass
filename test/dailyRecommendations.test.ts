import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Song } from '../src/api/subsonic';
import { buildDailyRecommendations, createDailyRecommendations, decodeDailyRecommendations, localRecommendationDay,
  RECOMMENDATION_KINDS, RECOMMENDATION_POOL_LIMIT, RECOMMENDATION_TRACKS,
  type DailyRecommendationsState, type RecommendationCandidates } from '../src/lib/dailyRecommendations';
import { DAILY_ALBUM_SAMPLE, DAILY_RANDOM_SAMPLE, loadRecommendationCandidates } from '../src/lib/recommendationCandidates';

const now = () => new Date(2026, 10, 9, 12);
const song = (index: number): Song => ({ id: String(index), title: `Track ${index}`, artistId: String(index % 10),
  albumId: `album-${index % 20}`, artist: `Artist ${index % 10}`, year: index % 2 ? 2010 : 2026, playCount: index % 13 });
const source = (): RecommendationCandidates => ({ songs: Array.from({ length: 180 }, (_, index) => song(index)),
  counts: { '1': 100, '2': 10, '3': 40 }, rewindIds: new Set(Array.from({ length: 80 }, (_, index) => String(index))),
  releaseIds: new Set(Array.from({ length: 80 }, (_, index) => String(index + 80))) });
const ids = (songs: readonly Song[]) => songs.map((track) => track.id);
const defer = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('daily picks are deterministic for a profile/day/batch and a refreshed batch avoids prior tracks when possible', () => {
  const first = buildDailyRecommendations(source(), 'one', now());
  assert.deepEqual(first, buildDailyRecommendations(source(), 'one', now()));
  const next = buildDailyRecommendations(source(), 'one', now(), 1, first);
  for (const kind of RECOMMENDATION_KINDS) {
    assert.equal(first.lists[kind].length, RECOMMENDATION_TRACKS);
    const previous = new Set(ids(first.lists[kind]));
    assert.equal(next.lists[kind].some((track) => previous.has(track.id)), false, kind);
    assert.equal(new Set(ids(next.lists[kind])).size, RECOMMENDATION_TRACKS);
  }
  assert.notDeepEqual(first.lists.daily, buildDailyRecommendations(source(), 'two', now()).lists.daily);
  assert.equal(first.day, localRecommendationDay(now()));
});

test('small libraries reuse only what exists and missing dates do not manufacture new releases or archives', () => {
  const input = { songs: [song(1), song(1), { id: 'undated', title: 'Undated' }], counts: {}, rewindIds: new Set<string>(), releaseIds: new Set<string>() };
  const first = buildDailyRecommendations(input, 'one', now()), next = buildDailyRecommendations(input, 'one', now(), 1, first);
  assert.equal(first.lists.daily.length, 2); assert.equal(next.lists.daily.length, 2);
  assert.deepEqual(ids(first.lists.rewind), ['1']); assert.equal(first.lists.releases.length, 0);
});

test('persisted recommendations are bounded and reject streams, duplicates, huge artwork blobs and malformed snapshots', () => {
  const input = source();
  input.songs = Array.from({ length: 1000 }, (_, index) => ({ ...song(index), coverBase64: 'x'.repeat(1000), comment: 'unneeded' }));
  input.songs.unshift({ id: 'radio', title: 'Radio', url: 'https://radio.test' }, { id: 'podcast', title: 'Podcast', podcastChannelId: 'show' });
  const snapshot = buildDailyRecommendations(input, 'one', now());
  assert.ok(snapshot.lists.daily.every((track) => Number(track.id) < RECOMMENDATION_POOL_LIMIT));
  const saved = JSON.stringify(snapshot); assert.equal(saved.includes('coverBase64'), false); assert.equal(saved.includes('comment'), false);
  assert.deepEqual(decodeDailyRecommendations(saved), snapshot);
  for (const invalid of ['not json', '{}', 'null', JSON.stringify({ ...snapshot, version: 5 }), JSON.stringify({ ...snapshot, lists: { daily: [] } })]) {
    assert.equal(decodeDailyRecommendations(invalid), null);
  }
});

function harness() {
  let profile = 'one', owner = {}, date = now(), data = source();
  let state: DailyRecommendationsState = { profile: '', snapshot: null, loading: false, error: false };
  let loads = 0, failure = false, writeFailure = false, gate: Promise<void> | undefined, writeGate: Promise<void> | undefined;
  const files = new Map<string, string>(), writes: [string, string][] = [];
  const controller = createDailyRecommendations({ profile: () => profile, owner: () => owner, now: () => date,
    read: async (key) => files.get(key) ?? null,
    write: async (key, value) => { writes.push([key, value]); await writeGate; if (writeFailure) throw Error('Disk unavailable'); files.set(key, value); },
    candidates: async (current) => { loads++; await gate; if (!current()) throw Error('Changed account'); if (failure) throw Error('Catalogue unavailable'); return data; },
    publish: (value) => { state = value; },
  });
  return { controller, files, writes, state: () => state, loads: () => loads,
    profile(value: string) { profile = value; owner = {}; controller.invalidate(); },
    nextDay() { date = new Date(2026, 10, 10, 12); }, data: (value: RecommendationCandidates) => { data = value; },
    gate: (value?: Promise<void>) => { gate = value; }, writeGate: (value?: Promise<void>) => { writeGate = value; },
    fail: (value: boolean) => { failure = value; }, failWrite: (value: boolean) => { writeFailure = value; } };
}

test('one daily build is coalesced, later visits do not fetch, and a cold restart reads saved results without catalogue work', async () => {
  const h = harness(); await Promise.all([h.controller.ensure(), h.controller.ensure(), h.controller.ensure()]);
  assert.equal(h.loads(), 1); assert.equal(h.writes.length, 1);
  const first = h.state().snapshot; await h.controller.ensure(); assert.equal(h.loads(), 1); assert.equal(h.state().snapshot, first);
  const cold = harness(); cold.files.set('resonus.dailyRecommendations.one', h.files.get('resonus.dailyRecommendations.one')!);
  await cold.controller.ensure(); assert.equal(cold.loads(), 0); assert.deepEqual(cold.state().snapshot, first);
  h.nextDay(); await h.controller.ensure(); assert.equal(h.loads(), 2); assert.equal(h.state().snapshot?.day, '2026-11-10');
});

test('refresh failure or a strict-save failure keeps the last saved batch and never falsely replaces it', async () => {
  const h = harness(); await h.controller.ensure();
  const before = h.state().snapshot, raw = h.files.get('resonus.dailyRecommendations.one');
  h.fail(true); await h.controller.refresh(); assert.equal(h.state().snapshot, before); assert.equal(h.state().error, true);
  h.fail(false); h.failWrite(true); await h.controller.refresh();
  assert.equal(h.state().snapshot, before); assert.equal(h.state().error, true);
  assert.equal(h.files.get('resonus.dailyRecommendations.one'), raw);
  h.failWrite(false); await h.controller.refresh(); assert.equal(h.state().snapshot?.batch, 1); assert.equal(h.state().error, false);
});

test('late old-profile candidates and accepted writes cannot publish or persist under a different profile', async () => {
  const h = harness(), gate = defer(); h.gate(gate.promise);
  const old = h.controller.ensure(); await turn();
  h.profile('two'); h.gate(); await h.controller.ensure();
  const accepted = h.state().snapshot; gate.resolve(); await old;
  assert.equal(h.state().profile, 'two'); assert.equal(h.state().snapshot, accepted);
  assert.equal(h.files.has('resonus.dailyRecommendations.one'), false);
  assert.ok(h.files.has('resonus.dailyRecommendations.two'));

  const writing = harness(), writeGate = defer(); writing.writeGate(writeGate.promise);
  const first = writing.controller.ensure(); await turn(); assert.equal(writing.writes.length, 1);
  writing.profile('two'); writing.writeGate(); const second = writing.controller.ensure();
  writeGate.resolve(); await Promise.all([first, second]);
  assert.equal(writing.state().profile, 'two'); assert.ok(writing.files.has('resonus.dailyRecommendations.one'));
  assert.ok(writing.files.has('resonus.dailyRecommendations.two'));
});

test('candidate loading is a fixed-size sample with only two concurrent album requests, not an all-library scan', async () => {
  const random = Array.from({ length: 5000 }, (_, index) => song(index));
  const requests: unknown[][] = []; let active = 0, peak = 0;
  const result = await loadRecommendationCandidates({
    async randomSongs(count) { requests.push(['random', count]); return random; },
    async albums(type, count, offset) { requests.push(['albums', type, count, offset]);
      return Array.from({ length: 100 }, (_, index) => ({ id: `${type}-${index}`, name: 'Album', year: 2026 })); },
    async album(id) { active++; peak = Math.max(peak, active); requests.push(['album', id]); await turn(); active--;
      return { album: { id, name: 'Album', year: 2026 }, songs: random.map((track) => ({ ...track, id: `${id}-${track.id}` })) }; },
    counts: () => ({ '1': 20 }), now,
  }, () => true);
  assert.deepEqual(requests.slice(0, 3), [['random', DAILY_RANDOM_SAMPLE], ['albums', 'recent', 12, 15], ['albums', 'byYear', 8, 0]]);
  assert.equal(requests.filter((request) => request[0] === 'album').length, DAILY_ALBUM_SAMPLE * 2);
  assert.equal(peak, 2); assert.equal(result.songs.length, DAILY_RANDOM_SAMPLE + DAILY_ALBUM_SAMPLE * 2 * 64);
  assert.equal(result.rewindIds.size, DAILY_ALBUM_SAMPLE * 64); assert.equal(result.releaseIds.size, DAILY_ALBUM_SAMPLE * 64);
});

test('a profile change while the source pages are loading prevents any subsequent album requests', async () => {
  const gate = defer(); let current = true, albums = 0;
  const work = loadRecommendationCandidates({
    async randomSongs() { await gate.promise; return [song(1)]; },
    async albums() { return [{ id: 'album', name: 'Album' }]; },
    async album() { albums++; return { album: { id: 'album', name: 'Album' }, songs: [song(1)] }; }, counts: () => ({}), now,
  }, () => current);
  current = false; gate.resolve(); await assert.rejects(work, /profile changed/); assert.equal(albums, 0);
});
