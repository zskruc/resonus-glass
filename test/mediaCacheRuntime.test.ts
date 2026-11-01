import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import ts from 'typescript';

import { MediaCacheStopped } from '../src/lib/bulkMediaWorker';
import type { MediaCacheTask } from '../src/lib/mediaCacheTypes';

const executable = ts.transpileModule(readFileSync(new URL('../src/lib/mediaCacheRuntime.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const detailFor = (id: string) => ({ artist: { id, name: `Artist ${id}`, coverArt: `ar-${id}` },
  albums: [{ id: `album-${id}`, name: `Album ${id}` }] });
const infoFor = (id: string) => ({ imageUrl: `https://art.test/${id}`, biography: `Biography ${id}` });
const taskFor = (id: string): MediaCacheTask => ({ kind: 'artistCovers', id, data: { id, name: `Artist ${id}` } });

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const savedDetails = new Set<string>(), savedInfo = new Set<string>();
  const fetched = { detail: 0, info: 0, cover: 0 };
  let current = true;
  let old: { detail: ReturnType<typeof detailFor>; info: ReturnType<typeof infoFor>; detailAt: number; infoAt: number } | undefined;
  let cover: (id: string) => Promise<{ outcome: string; uri: string }> = async (id) => ({ outcome: 'success', uri: `file:///managed/${id}.jpg` });
  const dependencies: Record<string, unknown> = {
    '@/api/backend': {
      COVER: { full: 1200 },
      getArtist: async (_auth: unknown, id: string) => { fetched.detail++; return detailFor(id); },
      getArtistInfo: async (_auth: unknown, id: string) => { fetched.info++; return infoFor(id); },
    },
    '@/api/data': {}, '@/api/navidrome': {},
    './bulkMediaWorker': { MediaCacheStopped },
    './mediaCacheDb': {
      readSavedArtist: async () => old,
      saveArtistDetail: async (_profile: string, id: string) => { savedDetails.add(id); },
      saveArtistInfo: async (_profile: string, id: string) => { savedInfo.add(id); },
    },
    './mirrorCovers': { cacheManagedCover: async (_profile: string, _auth: unknown, request: { keys: string[] }) => {
      fetched.cover++; return cover(request.keys[1]);
    } },
    './netBudget': { withSpeculativeSlot: async (allowed: () => boolean, work: () => Promise<unknown>) => allowed() ? work() : undefined },
    './query': { queryClient: client },
  };
  const exports: Record<string, any> = {};
  runInNewContext(executable, { exports,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
  });
  const runtime = exports.makeMediaCacheRuntime({ serverType: 'navidrome', password: 'test' }, 'profile', () => current);
  return { client, savedDetails, savedInfo, fetched,
    process: (id: string) => runtime.process(taskFor(id), { signal: new AbortController().signal }),
    save: (id: string) => { old = { detail: detailFor(id), info: infoFor(id), detailAt: Date.now(), infoAt: Date.now() }; },
    stop: () => { current = false; },
    cover: (work: typeof cover) => { cover = work; },
  };
}

test('bulk artist caching persists a large unseen catalogue without populating the UI query cache', async () => {
  const h = harness();
  try {
    for (let index = 0; index < 1915; index++) assert.equal(await h.process(String(index)), 'success');
    assert.equal(h.savedDetails.size, 1915);
    assert.equal(h.savedInfo.size, 1915);
    assert.equal(h.fetched.cover, 1915);
    assert.equal(h.client.getQueryCache().getAll().length, 0,
      'disk-cache work must not create thousands of inactive metadata/biography queries');
  } finally { h.client.clear(); }
});

test('bulk cache completion refreshes existing exact artist consumers without touching other keys', async () => {
  const h = harness();
  const detailKey = ['artist', 'open'], infoKey = ['artistInfo', 'open'];
  const prefixKey = ['artist', 'open', 'other-view'];
  const otherKey = ['artist', 'unrelated'];
  const prefix = { keep: 'prefix' }, other = { keep: 'other' };
  h.client.setQueryData(detailKey, { artist: { id: 'open', name: 'Stale' }, albums: [] });
  h.client.setQueryData(infoKey, { biography: 'Stale' });
  h.client.setQueryData(prefixKey, prefix);
  h.client.setQueryData(otherKey, other);
  const observer = new QueryObserver(h.client, { queryKey: detailKey, enabled: false });
  const seen: unknown[] = [];
  const unsubscribe = observer.subscribe((result) => seen.push(result.data));
  try {
    assert.equal(await h.process('open'), 'success');
    assert.deepEqual(plain(h.client.getQueryData(detailKey)), detailFor('open'));
    assert.deepEqual(plain(h.client.getQueryData(infoKey)), { ...infoFor('open'), imageUrl: 'file:///managed/open.jpg' });
    assert.deepEqual(plain(seen.at(-1)), detailFor('open'), 'an already-mounted observer receives the new metadata');
    assert.equal(h.client.getQueryData(prefixKey), prefix, 'exact matching cannot overwrite a longer view-specific key');
    assert.equal(h.client.getQueryData(otherKey), other);
    assert.equal(h.client.getQueryCache().getAll().length, 4);
    assert.ok(h.savedDetails.has('open') && h.savedInfo.has('open'));
  } finally { unsubscribe(); observer.destroy(); h.client.clear(); }
});

test('a warm durable artist record still checks its hero and updates an existing info query only', async () => {
  const h = harness(); h.save('warm');
  h.client.setQueryData(['artistInfo', 'warm'], { biography: 'Old biography' });
  try {
    await h.process('warm');
    assert.equal(h.fetched.detail + h.fetched.info, 0, 'fresh SQLite metadata avoids duplicate server fetches');
    assert.equal(h.fetched.cover, 1, 'full-resolution managed cover validation is retained');
    assert.equal(h.savedInfo.size, 1);
    assert.equal(h.client.getQueryData(['artist', 'warm']), undefined, 'an absent detail query stays absent');
    assert.deepEqual(plain(h.client.getQueryData(['artistInfo', 'warm'])), { ...infoFor('warm'), imageUrl: 'file:///managed/warm.jpg' });
  } finally { h.client.clear(); }
});

test('a lost cache owner cannot publish metadata or a downloaded hero into existing UI queries', async () => {
  const h = harness();
  const previous = { biography: 'Original' };
  h.client.setQueryData(['artistInfo', 'stopped'], previous);
  h.cover(async () => { h.stop(); return { outcome: 'success', uri: 'file:///managed/stopped.jpg' }; });
  try {
    await assert.rejects(h.process('stopped'), MediaCacheStopped);
    assert.equal(h.savedInfo.size, 0);
    assert.equal(h.client.getQueryData(['artistInfo', 'stopped']), previous);
    assert.equal(h.client.getQueryData(['artist', 'stopped']), undefined);
  } finally { h.client.clear(); }
});
