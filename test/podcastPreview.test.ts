import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import { normalizePodcastDirectoryCountry } from '../src/lib/podcastDirectory';

function fixture() {
  let now = 1000;
  const first = { username: 'A', password: 'private-account-secret' };
  const auth = createStore(() => ({ auth: first as typeof first | null, offline: false, autoOffline: false, offlineSource: null as any }));
  const profile = () => auth.getState().auth?.username ?? (auth.getState().offline ? 'local' : 'default');
  const imports: Record<string, unknown> = { '@/store/auth': { useAuthStore: auth, profileScopeId: profile }, '@/lib/podcastDirectory': { normalizePodcastDirectoryCountry } };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/podcastPreview.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Date: { now: () => now }, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { api: exports, auth, first, clock: (value: number) => { now = value; } };
}
const show = { id: 101, title: 'Public show', author: 'Host', imageUrl: 'https://image.test/show.jpg', feedUrl: 'https://feed.test/show.xml', episodeCount: 2500 };

test('the synchronous handoff snapshots public metadata without credentials or mutation and survives repeated StrictMode reads', () => {
  const h = fixture(), input = { ...show, password: 'do-not-copy', privateData: { cookie: 'do-not-copy' } };
  const handle = h.api.beginPodcastPreview(input, 'JP');
  assert.equal(handle.id, 'preview-101'); assert.equal(Object.keys(handle).sort().join(','), 'id,token');
  assert.equal(String(handle.token).includes('https'), false);
  const first = h.api.readPodcastPreview(handle.token);
  assert.equal(first.show.feedUrl, show.feedUrl); assert.equal(first.country, 'jp'); assert.equal(first.profile, 'A');
  assert.equal(first.current(), true); assert.equal(h.api.readPodcastPreview(handle.token), first);
  assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.show), true);
  input.title = 'Mutated original'; assert.equal(first.show.title, 'Public show');
  assert.equal(first.show.password, undefined); assert.equal(first.show.privateData, undefined);
  assert.equal(JSON.stringify(first).includes('private-account-secret'), false);
  h.api.disposePodcastPreview(handle.token); assert.equal(first.current(), false); assert.equal(h.api.readPodcastPreview(handle.token), undefined);
});

test('account A→B→the same A object invalidates old work, while offline changes on the same account preserve the handoff', () => {
  const h = fixture(), handle = h.api.beginPodcastPreview(show), first = h.api.readPodcastPreview(handle.token);
  h.auth.setState({ offline: true }); assert.equal(first.current(), true);
  h.auth.setState({ autoOffline: true }); assert.equal(first.current(), true);
  h.auth.setState({ offline: false, autoOffline: false }); assert.equal(first.current(), true);
  h.auth.setState({ auth: { username: 'B', password: 'other' } }); h.auth.setState({ auth: h.first });
  assert.equal(first.current(), false); assert.equal(h.api.readPodcastPreview(handle.token), undefined);
  const next = h.api.beginPodcastPreview(show); assert.notEqual(next.token, handle.token); assert.equal(h.api.readPodcastPreview(next.token).current(), true);
  h.auth.setState({ auth: null, offline: true, offlineSource: { mode: 'folder', uris: ['one'] } });
  const local = h.api.beginPodcastPreview(show), localSeed = h.api.readPodcastPreview(local.token);
  h.auth.setState({ offlineSource: { mode: 'folder', uris: ['two'] } });
  assert.equal(localSeed.current(), false);
});

test('the memory handoff is bounded to eight entries and expires without timers or renewing its lifetime on reads', () => {
  const h = fixture(), oldest = h.api.beginPodcastPreview(show), seed = h.api.readPodcastPreview(oldest.token);
  for (let id = 102; id <= 109; id++) h.api.beginPodcastPreview({ ...show, id });
  assert.equal(h.api.readPodcastPreview(oldest.token), undefined); assert.equal(seed.current(), false);
  const fresh = h.api.beginPodcastPreview(show), freshSeed = h.api.readPodcastPreview(fresh.token);
  h.clock(1000 + 10 * 60_000 - 1); assert.equal(h.api.readPodcastPreview(fresh.token), freshSeed);
  h.clock(1000 + 10 * 60_000); assert.equal(h.api.readPodcastPreview(fresh.token), undefined); assert.equal(freshSeed.current(), false);
  const rollback = h.api.beginPodcastPreview(show); h.clock(1); assert.equal(h.api.readPodcastPreview(rollback.token), undefined);
});

test('only bounded valid public directory fields enter seeds; arbitrary URLs and invalid ids are rejected', () => {
  const h = fixture();
  const handle = h.api.beginPodcastPreview({ ...show, title: 'x'.repeat(900), summary: 'y'.repeat(9000),
    feedUrl: 'https://user:password@feed.test/private', imageUrl: 'file:///private.jpg', episodeCount: Number.NaN, latestReleaseAt: Number.POSITIVE_INFINITY }, 'invalid-country');
  const seed = h.api.readPodcastPreview(handle.token);
  assert.equal(seed.show.title.length, 500); assert.equal(seed.show.summary.length, 4000); assert.equal(seed.country, 'us');
  assert.equal(seed.show.feedUrl, undefined); assert.equal(seed.show.imageUrl, undefined); assert.equal(seed.show.episodeCount, undefined); assert.equal(seed.show.latestReleaseAt, undefined);
  assert.throws(() => h.api.beginPodcastPreview({ ...show, id: -1 }), /Invalid podcast preview ID/);
  assert.throws(() => h.api.beginPodcastPreview({ ...show, id: Number.NaN }), /Invalid podcast preview ID/);
  assert.equal(h.api.readPodcastPreview(['token']), undefined);
});
