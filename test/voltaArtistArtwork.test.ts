import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { resolveArtworkLocalUri } from '../modules/amll-background/artworkSource';
import * as artistColors from '../src/lib/voltaArtistPalette';

type NativeSample = {
  textureUri: string; width: number; height: number; sourceWidth: number; sourceHeight: number;
  lowerMean: string; lowerEdgeMean: string; lowerCenterMean: string; average: string;
};
const sample = (name: string, color = '#6B706C'): NativeSample => ({ textureUri: `file:///prepared/${name}.png`,
  width: 192, height: 240, sourceWidth: 1440, sourceHeight: 1440,
  lowerMean: color, lowerEdgeMean: color, lowerCenterMean: color, average: '#AABB99' });

function harness() {
  let cursor = 0;
  let writes = 0;
  let slots: any[] = [];
  const instances = new Map<string, any[]>();
  const effects: (() => void)[] = [];
  const cleanup = new Set<() => void>();
  const slot = <T,>(create: () => T): T => { const index = cursor++; return index in slots ? slots[index] : slots[index] = create(); };
  const paths = new Map<string, string>();
  const probes: string[] = [];
  const prefetches: string[] = [];
  const nativeCalls: { uri: string; aspect: number; extension: number }[] = [];
  const reads = new Map<string, ((value: NativeSample | null) => void)[]>();
  const official = new Map<string, { backgroundColor: string }>();
  const metadataCalls: { uri: string; artistName?: string; offline: boolean }[] = [];
  const metadataReads = new Map<string, (value: { backgroundColor: string } | null) => void>();
  let automatic = false;
  let holdCache: Promise<void> | undefined;
  let holdPrefetch: Promise<void> | undefined;
  let prefetchSucceeds = true;
  let profile = 'profile-a';
  const react = {
    useRef: <T,>(value: T) => slot(() => ({ current: value })),
    useState: <T,>(value?: T) => {
      const state = slot(() => ({ value }));
      return [state.value, (next: T) => { writes++; state.value = next; }];
    },
    useMemo: (create: () => unknown, deps: unknown[]) => {
      const state = slot(() => ({ deps: undefined as unknown[] | undefined, value: undefined as unknown }));
      if (!state.deps || !state.deps.every((value, index) => Object.is(value, deps[index]))) {
        state.deps = deps; state.value = create();
      }
      return state.value;
    },
    useEffect: (create: () => (() => void) | undefined, deps: unknown[]) => {
      const state = slot(() => ({ deps: undefined as unknown[] | undefined, close: undefined as (() => void) | undefined }));
      if (state.deps && state.deps.every((value, index) => Object.is(value, deps[index]))) return;
      state.deps = deps;
      effects.push(() => {
        if (state.close) { cleanup.delete(state.close); state.close(); }
        state.close = create(); if (state.close) cleanup.add(state.close);
      });
    },
  };
  const source = readFileSync(new URL('../src/hooks/useVoltaArtistArtwork.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports: Record<string, any> = {};
  runInNewContext(compiled.outputText, { exports, require(name: string) {
    if (name === 'react') return react;
    if (name === '@/api/data') return { CACHED_COVER: 'cached-cover:' };
    if (name === '@/store/auth') return { profileScopeId: () => profile,
      useAuthStore: (select: (state: { auth: object }) => unknown) => select({ auth: {} }) };
    if (name === '@/lib/voltaArtistPalette') return artistColors;
    if (name === '@/lib/verifyAppleArtistPhoto') return { verifyAppleArtistPhoto: async () => false };
    if (name === '@/lib/appleArtistArtwork') return {
      getCachedAppleArtistArtwork(uri: string) { return official.get(uri) ?? null; },
      async resolveAppleArtistArtwork(uri: string, artistName: string | undefined, offline: boolean, allowNetwork: () => boolean) {
        if (official.has(uri)) return official.get(uri);
        if (!/^https:\/\/[\w-]+\.mzstatic\.com\//.test(uri) || offline || !allowNetwork()) return null;
        metadataCalls.push({ uri, artistName, offline });
        return new Promise<{ backgroundColor: string } | null>((resolve) => metadataReads.set(uri, (value) => {
          if (value) official.set(uri, value); resolve(value);
        }));
      },
    };
    if (name.endsWith('/artworkSource')) return { resolveArtworkLocalUri };
    if (name.endsWith('/artistArtwork')) return { prepareArtistArtwork(uri: string, aspect: number, extension: number) {
      nativeCalls.push({ uri, aspect, extension });
      if (automatic) return Promise.resolve(sample(uri.split('/').pop()!));
      return new Promise<NativeSample | null>((resolve) => reads.set(uri, [...(reads.get(uri) ?? []), resolve]));
    } };
    if (name === 'expo-image') return { Image: {
      async getCachePathAsync(uri: string) { probes.push(uri); await holdCache; return paths.get(uri) ?? null; },
      async prefetch(uri: string, policy: string) {
        assert.equal(policy, 'disk'); prefetches.push(uri); await holdPrefetch;
        if (!prefetchSucceeds) return false;
        paths.set(uri, `/cached/${encodeURIComponent(uri)}`); return true;
      },
    } };
    throw new Error(`Unexpected artist artwork import ${name}`);
  } });
  return {
    paths, probes, prefetches, nativeCalls, official, metadataCalls,
    render(uri?: string, offline = false, aspect = 1, extension = 0.25, instance = 'main', artistName?: string) {
      slots = instances.get(instance) ?? []; instances.set(instance, slots); cursor = 0;
      const result = exports.useVoltaArtistArtwork(uri, offline, aspect, extension, artistName);
      while (effects.length) effects.shift()!(); return result;
    },
    resolve(uri: string, result: NativeSample | null) { const next = reads.get(uri)?.shift(); assert.ok(next, `pending native request ${uri}`); next(result); },
    resolveMetadata(uri: string, backgroundColor: string) { const next = metadataReads.get(uri); assert.ok(next); next({ backgroundColor }); },
    unmount() { for (const close of cleanup) close(); cleanup.clear(); },
    setAutomatic() { automatic = true; },
    delayCache(promise: Promise<void>) { holdCache = promise; },
    delayPrefetch(promise: Promise<void>) { holdPrefetch = promise; },
    failPrefetch() { prefetchSucceeds = false; },
    setProfile(value: string) { profile = value; },
    writes: () => writes,
  };
}
async function flush() { for (let i = 0; i < 36; i++) await Promise.resolve(); }

describe('artist exact-quality cache resolution', () => {
  it('fetches the requested full image when only a list thumbnail is cached', async () => {
    const uri = 'https://music.example/artist?size=1200';
    const paths = new Map([['https://music.example/artist?size=200', '/cache/thumbnail.jpg']]);
    const fetches: string[] = [];
    const result = await resolveArtworkLocalUri(uri, 'cached-cover:', {
      cachePath: async (key) => paths.get(key) ?? null,
      prefetch: async (key) => { fetches.push(key); paths.set(key, '/cache/full.jpg'); return true; },
      allowNetwork: () => true,
    }, { quality: 'exact' });
    assert.equal(result, 'file:///cache/full.jpg'); assert.deepEqual(fetches, [uri]);
  });

  it('does not label a thumbnail as a successful full request after a failed download', async () => {
    const result = await resolveArtworkLocalUri('https://music.example/artist?size=1200', 'cached-cover:', {
      cachePath: async (key) => key.endsWith('size=600') ? '/cache/card.jpg' : null,
      prefetch: async () => false, allowNetwork: () => true,
    }, { quality: 'exact' });
    assert.equal(result, undefined);
  });

  it('uses the highest available offline size without changing legacy consumer ordering', async () => {
    let fetches = 0;
    const access = {
      cachePath: async (key: string) => key.endsWith('size=1200') ? '/cache/full.jpg'
        : key.endsWith('size=600') ? '/cache/card.jpg' : null,
      prefetch: async () => { fetches++; return true; }, allowNetwork: () => true,
    };
    const uri = 'cached-cover:https://music.example/artist?size=2400';
    assert.equal(await resolveArtworkLocalUri(uri, 'cached-cover:', access, { quality: 'exact' }), 'file:///cache/full.jpg');
    assert.equal(await resolveArtworkLocalUri(uri, 'cached-cover:', access), 'file:///cache/card.jpg');
    assert.equal(fetches, 0);
  });

  it('cancels a superseded online full request while the offline consumer may still use cached art', async () => {
    let online = true, fetches = 0;
    const access = {
      cachePath: async (key: string) => { online = false; return key.endsWith('size=200') ? '/cache/thumb.jpg' : null; },
      prefetch: async () => { fetches++; return true; }, allowNetwork: () => online,
    };
    const uri = 'https://music.example/artist?size=1200';
    assert.equal(await resolveArtworkLocalUri(uri, 'cached-cover:', access, { quality: 'exact' }), undefined);
    assert.equal(await resolveArtworkLocalUri('cached-cover:' + uri, 'cached-cover:', access, { quality: 'exact' }), 'file:///cache/thumb.jpg');
    assert.equal(fetches, 0);
  });

  it('returns an exact cache hit without prefetch or alternate-size lookup', async () => {
    const keys: string[] = [];
    const uri = 'https://music.example/artist?size=1200';
    const result = await resolveArtworkLocalUri(uri, 'cached-cover:', {
      cachePath: async (key) => { keys.push(key); return '/cache/full.jpg'; },
      prefetch: async () => { throw new Error('cached full art must not download again'); }, allowNetwork: () => true,
    }, { quality: 'exact' });
    assert.equal(result, 'file:///cache/full.jpg'); assert.deepEqual(keys, [uri]);
  });
});

describe('atomic static artist artwork preparation', () => {
  it('resolves the displayed image through disk cache and publishes texture and lower-image palette together', async () => {
    const h = harness(); const uri = 'https://cdn.example/artist.jpg';
    const pending = h.render(uri); assert.equal(pending.ready, false); assert.equal(pending.textureUri, undefined);
    await flush(); assert.deepEqual(h.prefetches, [uri]);
    const local = h.nativeCalls[0].uri;
    assert.match(local, /^file:\/\/\/cached\//);
    assert.equal(h.render(uri).palette, artistColors.VOLTA_ARTIST_FALLBACK);
    const result = { ...sample('ready'), sourceBackground: '#0e0e0c' }; h.resolve(local, result); await flush();
    const ready = h.render(uri);
    assert.equal(ready.ready, true); assert.equal(ready.textureUri, result.textureUri);
    assert.equal(ready.sourceUri, local, 'the sharp photo must use the exact file sampled for the field and palette');
    assert.deepEqual(ready.palette, artistColors.buildVoltaArtistPalette(result));
    assert.equal(ready.palette.background, '#0e0e0c', 'the hook carries native scene colors through without requiring online metadata');
    assert.equal(h.nativeCalls.length, 1);
  });

  it('never prefetches offline or cache-only art, but can prepare the exact cached remote photo', async () => {
    const h = harness();
    h.render('https://cdn.example/absent.jpg', true); await flush();
    assert.equal(h.prefetches.length, 0); assert.equal(h.nativeCalls.length, 0);
    assert.equal(h.render('https://cdn.example/absent.jpg', true).ready, true);
    h.render('cached-cover:https://cdn.example/absent2.jpg'); await flush();
    assert.equal(h.prefetches.length, 0);
    h.paths.set('https://cdn.example/present.jpg', '/cached/present.jpg');
    h.render('https://cdn.example/present.jpg', true); await flush();
    assert.equal(h.nativeCalls[0].uri, 'file:///cached/present.jpg');
    h.resolve('file:///cached/present.jpg', sample('offline')); await flush();
    assert.equal(h.render('https://cdn.example/present.jpg', true).textureUri, 'file:///prepared/offline.png');
    assert.equal(h.render('https://cdn.example/present.jpg', true).sourceUri, 'file:///cached/present.jpg');
    assert.equal(h.prefetches.length, 0);
  });

  it('rechecks offline policy after asynchronous cache lookup instead of starting a stale online prefetch', async () => {
    const h = harness(); let release!: () => void;
    h.delayCache(new Promise<void>((resolve) => { release = resolve; }));
    h.render('https://cdn.example/changing.jpg'); await flush();
    h.render('https://cdn.example/changing.jpg', true); release(); await flush();
    assert.equal(h.prefetches.length, 0); assert.equal(h.nativeCalls.length, 0);
  });

  it('keeps offline fallback preparation separate so returning online upgrades to the full photo', async () => {
    const h = harness(); const uri = 'https://music.example/artist?size=1200';
    h.paths.set('https://music.example/artist?size=200', '/cache/thumb.jpg');
    h.render(uri, true); await flush(); h.resolve('file:///cache/thumb.jpg', sample('thumb')); await flush();
    assert.equal(h.render(uri, true).sourceUri, 'file:///cache/thumb.jpg');
    assert.equal(h.render(uri).sourceUri, undefined, 'offline prepared art cannot satisfy the online exact cache');
    await flush(); assert.deepEqual(h.prefetches, [uri]);
    const full = h.nativeCalls[1].uri; assert.notEqual(full, 'file:///cache/thumb.jpg');
    h.resolve(full, sample('full')); await flush();
    assert.equal(h.render(uri).sourceUri, full);
    assert.equal(h.render(uri, true).sourceUri, full, 'a later offline visit prefers the known full result over an older fallback');
  });

  it('ignores a late online prefetch after switching offline and reuses its full disk file on return', async () => {
    const h = harness(); const uri = 'https://music.example/artist?size=1200'; let release!: () => void;
    h.paths.set('https://music.example/artist?size=200', '/cache/thumb.jpg');
    h.delayPrefetch(new Promise<void>((resolve) => { release = resolve; }));
    h.render(uri); await flush(); assert.deepEqual(h.prefetches, [uri]);
    h.render(uri, true); await flush(); h.resolve('file:///cache/thumb.jpg', sample('offline')); await flush();
    release(); await flush();
    assert.equal(h.nativeCalls.length, 1, 'the retired online request cannot start preparation after policy changes');
    assert.equal(h.render(uri, true).sourceUri, 'file:///cache/thumb.jpg');
    h.render(uri); await flush();
    assert.equal(h.prefetches.length, 1, 'the completed disk file is retained, not deleted or downloaded again');
    const full = h.nativeCalls[1].uri; h.resolve(full, sample('full')); await flush();
    assert.equal(h.render(uri).sourceUri, full);
  });

  it('does not start native preparation for an obsolete URI after its prefetch finishes', async () => {
    const h = harness(); const a = 'https://music.example/A?size=1200', b = 'https://music.example/B?size=1200';
    let release!: () => void; h.delayPrefetch(new Promise<void>((resolve) => { release = resolve; }));
    h.render(a); await flush(); h.paths.set(b, '/cache/B.jpg');
    h.render(b); await flush(); h.resolve('file:///cache/B.jpg', sample('B')); await flush(); release(); await flush();
    assert.deepEqual(h.nativeCalls.map((call) => call.uri), ['file:///cache/B.jpg']);
    assert.equal(h.render(b).sourceUri, 'file:///cache/B.jpg');
  });

  it('isolates prepared artifacts and rejects late native results across profile changes', async () => {
    const h = harness(); h.render('file:///shared.jpg'); await flush();
    h.setProfile('profile-b');
    assert.equal(h.render('file:///shared.jpg').sourceUri, undefined); await flush();
    h.resolve('file:///shared.jpg', sample('old-profile')); await flush();
    assert.equal(h.render('file:///shared.jpg').sourceUri, undefined, 'old profile cannot publish into the new account');
    h.resolve('file:///shared.jpg', sample('new-profile')); await flush();
    assert.equal(h.render('file:///shared.jpg').textureUri, 'file:///prepared/new-profile.png');
    h.setProfile('profile-a');
    assert.equal(h.render('file:///shared.jpg').sourceUri, undefined, 'retired profile completion was not retained as a reusable result');
  });

  it('rejects old artist/crop results and applies only each image’s own atomic pair', async () => {
    const h = harness();
    h.render('file:///A.jpg'); await flush();
    h.render('file:///B.jpg', false, 0.8, 0.2); await flush();
    h.resolve('file:///A.jpg', sample('A', '#192735')); await flush();
    assert.equal(h.render('file:///B.jpg', false, 0.8, 0.2).textureUri, undefined);
    assert.equal(h.render('file:///B.jpg', false, 0.8, 0.2).palette, artistColors.VOLTA_ARTIST_FALLBACK);
    h.resolve('file:///B.jpg', sample('B')); await flush();
    assert.equal(h.render('file:///B.jpg', false, 0.8, 0.2).textureUri, 'file:///prepared/B.png');
    const cachedA = h.render('file:///A.jpg');
    assert.equal(cachedA.textureUri, 'file:///prepared/A.png');
    await flush(); h.resolve('file:///A.jpg', sample('A', '#192735')); await flush();
    assert.equal(h.render('file:///A.jpg'), cachedA, 'unchanged native validation must preserve the frozen result identity');
    h.render('file:///A.jpg', false, 0.9, 0.4); await flush();
    assert.equal(h.render('file:///A.jpg', false, 0.9, 0.4).textureUri, undefined, 'a different cover crop must be prepared separately');
    assert.equal(h.nativeCalls.length, 4);
    assert.deepEqual(h.nativeCalls[3], { uri: 'file:///A.jpg', aspect: 0.9, extension: 0.4 });
  });

  it('coalesces simultaneous consumers, bounds cache size and evicts by recent use', async () => {
    const h = harness();
    h.render('file:///shared.jpg', false, 1, 0.25, 'first');
    h.render('file:///shared.jpg', false, 1, 0.25, 'second'); await flush();
    assert.equal(h.nativeCalls.length, 1);
    h.resolve('file:///shared.jpg', sample('shared')); await flush();
    h.setAutomatic();
    assert.equal(h.render('file:///shared.jpg', true, 1, 0.25, 'third').textureUri, 'file:///prepared/shared.png');
    await flush();
    for (let i = 0; i < artistColors.VOLTA_ARTIST_PALETTE_CACHE_LIMIT; i++) {
      h.render(`file:///${i}.jpg`); await flush();
    }
    const count = h.nativeCalls.length;
    h.render('file:///63.jpg'); await flush(); assert.equal(h.nativeCalls.length, count);
    assert.equal(h.render('file:///shared.jpg').textureUri, undefined, 'the oldest JS result must be evicted after 64 newer artists');
    await flush(); assert.equal(h.nativeCalls.length, count + 1);
  });

  it('revalidates revisited disk artifacts and clears a missing cached field instead of retaining a dead PNG URI', async () => {
    const h = harness();
    h.render('file:///A.jpg'); await flush(); h.resolve('file:///A.jpg', sample('A-old')); await flush();
    h.render('file:///B.jpg'); await flush(); h.resolve('file:///B.jpg', sample('B')); await flush();
    assert.equal(h.render('file:///A.jpg').textureUri, 'file:///prepared/A-old.png', 'cache remains available immediately on revisit');
    await flush();
    assert.equal(h.nativeCalls.length, 3, 'the effect must validate native disk cache even when JS has a result');
    h.resolve('file:///A.jpg', sample('A-regenerated')); await flush();
    assert.equal(h.render('file:///A.jpg').textureUri, 'file:///prepared/A-regenerated.png');
    h.render('file:///B.jpg'); await flush(); h.resolve('file:///B.jpg', sample('B')); await flush();
    h.render('file:///A.jpg'); await flush(); h.resolve('file:///A.jpg', null); await flush();
    assert.equal(h.render('file:///A.jpg').textureUri, undefined, 'native failure clears the stale JS PNG reference');
    assert.equal(h.render('file:///A.jpg').ready, true);
    h.render(); h.render('file:///A.jpg'); await flush();
    h.resolve('file:///A.jpg', sample('A-retry')); await flush();
    assert.equal(h.render('file:///A.jpg').textureUri, 'file:///prepared/A-retry.png');
  });

  it('applies verified metadata without delaying or replacing the same local photo/field and preserves render identity', async () => {
    const h = harness(); const uri = 'https://is1-ssl.mzstatic.com/image/thumb/artist-one/1200x1200bb.jpg';
    h.paths.set(uri, '/cached/artist.jpg');
    h.render(uri, false, 1, 0.25, 'main', 'Artist'); await flush();
    assert.equal(h.metadataCalls[0].artistName, 'Artist');
    h.resolve('file:///cached/artist.jpg', sample('native', '#273542')); await flush();
    const before = h.render(uri, false, 1, 0.25, 'main', 'Artist');
    assert.equal(before.textureUri, 'file:///prepared/native.png', 'local field does not wait for public metadata');
    h.resolveMetadata(uri, '#d6dbd7'); await flush();
    const after = h.render(uri, false, 1, 0.25, 'main', 'Artist');
    assert.equal(after.palette.background, '#6b706c');
    assert.equal(after.sourceUri, before.sourceUri); assert.equal(after.textureUri, before.textureUri);
    assert.equal(h.render(uri, false, 1, 0.25, 'main', 'Artist'), after, 'metadata must not allocate a new context value every render');
    assert.equal(h.render(uri, true, 1, 0.25, 'cached-visit', 'Artist').palette.background, '#6b706c', 'cached verified metadata is visible on the first frame offline');
  });

  it('ignores obsolete metadata responses and does not start public metadata requests offline', async () => {
    const h = harness();
    const a = 'https://is1-ssl.mzstatic.com/image/thumb/artist-a/1200x1200bb.jpg';
    const b = 'https://is1-ssl.mzstatic.com/image/thumb/artist-b/1200x1200bb.jpg';
    h.paths.set(a, '/cached/A.jpg'); h.paths.set(b, '/cached/B.jpg');
    h.render(a, false, 1, 0.25, 'main', 'A'); await flush();
    h.render(b, false, 1, 0.25, 'main', 'B'); await flush();
    h.resolve('file:///cached/B.jpg', sample('B', '#273542')); await flush();
    const before = h.render(b, false, 1, 0.25, 'main', 'B');
    h.resolveMetadata(a, '#d6dbd7'); await flush();
    assert.equal(h.render(b, false, 1, 0.25, 'main', 'B'), before, 'artist A metadata cannot recolor artist B');
    h.render('https://is1-ssl.mzstatic.com/image/thumb/artist-c/1200x1200bb.jpg', true, 1, 0.25, 'offline', 'C');
    await flush(); assert.equal(h.metadataCalls.length, 2);
  });

  it('does not retain native failure, retries on a later visit and ignores completion after unmount', async () => {
    const h = harness();
    assert.equal(h.render().ready, true);
    h.render('file:///failed.jpg'); await flush(); h.resolve('file:///failed.jpg', null); await flush();
    assert.equal(h.render('file:///failed.jpg').ready, true);
    assert.equal(h.render('file:///failed.jpg').textureUri, undefined);
    h.render(); h.render('file:///failed.jpg'); await flush(); assert.equal(h.nativeCalls.length, 2);
    h.unmount(); const writes = h.writes();
    h.resolve('file:///failed.jpg', sample('late')); await flush(); assert.equal(h.writes(), writes);
  });
});
