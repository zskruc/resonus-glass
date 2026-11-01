import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ImageColorsResult } from 'react-native-image-colors';
import ts from 'typescript';

import { createArtworkColorCache } from '../src/lib/artworkColorCache';
import { BoundedCache } from '../src/lib/boundedCache';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const raw = (color = '#aa3366'): ImageColorsResult => ({ platform: 'android', vibrant: color,
  darkVibrant: color, lightVibrant: color, muted: color, darkMuted: color, lightMuted: color,
  dominant: color, average: color });
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }

test('completed-value cache retains recent entries, replaces keys and preserves false values within its capacity', () => {
  const cache = new BoundedCache<string, boolean>(2);
  cache.set('a', false); cache.set('b', true);
  assert.equal(cache.get('a'), false);
  cache.set('c', true);
  assert.equal(cache.size, 2); assert.equal(cache.get('b'), undefined);
  cache.set('a', true); cache.set('d', false);
  assert.equal(cache.get('c'), undefined);
  assert.equal(cache.get('a'), true); assert.equal(cache.get('d'), false);
  const invalid = new BoundedCache<number, number>(Infinity);
  invalid.set(1, 1); invalid.set(2, 2); assert.equal(invalid.size, 1);
});

test('raw palette eviction never cancels in-flight owners or starts another decode for the same source', async () => {
  const cache = createArtworkColorCache(2), gate = deferred<ImageColorsResult>();
  let reads = 0;
  const first = cache.load('pending', '#333333', () => { reads++; return gate.promise; });
  for (const key of ['b', 'c', 'd']) await cache.load(key, '#333333', async () => raw());
  const joined = cache.load('pending', '#eeeeee', async () => { reads++; return raw(); });
  assert.equal(joined, first);
  gate.resolve(raw()); await first;
  assert.equal(reads, 1);
  assert.equal(cache.peek('pending')?.fallback, '#333333', 'a theme change keeps the original sample sentinel');
  assert.equal(cache.peek('b'), undefined); assert.equal(cache.peek('c'), undefined);
  assert.ok(cache.peek('d'));
});

test('raw palette cache uses recency and retries evicted, absent or failed samples', async () => {
  const cache = createArtworkColorCache(2);
  let reads = 0;
  const read = async () => { reads++; return raw(); };
  await cache.load('a', '#333333', read); await cache.load('b', '#333333', read);
  assert.ok(cache.peek('a'));
  await cache.load('c', '#333333', read);
  assert.equal(cache.peek('b'), undefined);
  await cache.load('a', '#333333', read); assert.equal(reads, 3, 'a warm raw palette avoids I/O');
  await cache.load('b', '#333333', read); assert.equal(reads, 4);
  await cache.load('absent', '#333333', async () => null);
  await cache.load('absent', '#333333', read); assert.equal(reads, 5);
  await assert.rejects(cache.load('failed', '#333333', async () => { throw new Error('decode failed'); }));
  await cache.load('failed', '#333333', read); assert.equal(reads, 6);
});

function compile(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require(name: string) {
    if (name === 'react') return React;
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  } });
  return exports;
}

function tintHarness() {
  let mode: 'dark' | 'light' = 'dark';
  let reader: (source: string, fallback: string) => Promise<ImageColorsResult> = async () => raw();
  const calls: { source: string; cache: boolean }[] = [];
  const nativeCache = new Map<string, ImageColorsResult>();
  const colors = { surfaceHighlight: '#333333' };
  const api = compile('../src/hooks/useDominantColor.ts', {
    '@/api/data': { CACHED_COVER: 'cached-cover:', COVER: { thumb: 100 } },
    '@/theme': { colors, useThemeMode: () => mode },
    '@/lib/boundedCache': { BoundedCache },
    '@/lib/artworkColorCache': { artworkColorCache: createArtworkColorCache() },
    'react-native-image-colors': {
      cache: { getItem: (key: string) => nativeCache.get(key), removeItem: (key: string) => nativeCache.delete(key) },
      getColors: async (source: string, options: { cache: boolean; fallback: string }) => {
        calls.push({ source, cache: options.cache });
        const result = await reader(source, options.fallback);
        if (options.cache) nativeCache.set(source, result);
        return result;
      },
    },
  });
  return { api, calls, nativeCache,
    mode: (value: typeof mode) => { mode = value; colors.surfaceHighlight = value === 'dark' ? '#333333' : '#eeeeee'; },
    read: (work: typeof reader) => { reader = work; },
  };
}

test('normalized tints are capped at 1024 and a recently read tint survives eviction without filling the plugin cache', async () => {
  const h = tintHarness();
  const uri = (index: number) => `https://art.test/${index}?size=1200`;
  for (let index = 0; index < 1024; index++) await h.api.readSharedCoverTint(uri(index), 'dark');
  assert.ok(h.api.cachedCoverTint(uri(0), 'dark'));
  await h.api.readSharedCoverTint(uri(1024), 'dark');
  assert.ok(h.api.cachedCoverTint(uri(0), 'dark'));
  assert.equal(h.api.cachedCoverTint(uri(1), 'dark'), undefined);
  assert.equal(h.nativeCache.size, 0, 'the unbounded dependency dictionary receives no new entries');
  assert.ok(h.calls.every((call) => call.cache === false && call.source.endsWith('?size=100')));
  const count = h.calls.length;
  await h.api.readSharedCoverTint(uri(1), 'dark');
  assert.equal(h.calls.length, count + 1, 'evicted data remains reconstructible');
});

test('simultaneous light/dark readers share one raw decode and prepared theme variants are synchronous hook hits', async () => {
  const h = tintHarness(), gate = deferred<ImageColorsResult>(), uri = 'https://art.test/current?size=600';
  h.read(async () => gate.promise);
  const dark = h.api.readSharedCoverTint(uri, 'dark'), light = h.api.readSharedCoverTint(uri, 'light');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  gate.resolve(raw());
  const [darkValue, lightValue] = await Promise.all([dark, light]);
  assert.equal(h.calls.length, 1); assert.notEqual(darkValue, lightValue);
  let shown: any;
  function Probe() { shown = h.api.useCoverTint(uri); return null; }
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(React.createElement(Probe)); });
    assert.equal(shown.known, true); assert.equal(shown.color, darkValue);
    h.mode('light');
    await act(async () => { renderer.update(React.createElement(Probe)); });
    assert.equal(shown.known, true); assert.equal(shown.color, lightValue);
    assert.equal(h.calls.length, 1, 'switching appearance does not redownload a cached palette');
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('an existing plugin palette is reused, and failed fallback palettes remain retryable', async () => {
  const h = tintHarness();
  h.nativeCache.set('https://art.test/cached', raw());
  assert.ok(await h.api.readSharedCoverTint('https://art.test/cached', 'dark'));
  assert.equal(h.calls.length, 0);
  let failed = true;
  h.read(async (_source, fallback) => { if (failed) return raw(fallback); return raw(); });
  assert.equal(await h.api.readSharedCoverTint('https://art.test/retry', 'dark'), null);
  failed = false;
  assert.ok(await h.api.readSharedCoverTint('https://art.test/retry', 'dark'));
  assert.equal(h.calls.length, 2);
});

test('a late palette completion cannot replace the current cover in a real hook', async () => {
  const h = tintHarness(), first = deferred<ImageColorsResult>(), second = deferred<ImageColorsResult>();
  h.read((source) => source.endsWith('/first') ? first.promise : second.promise);
  let shown: any;
  function Probe({ uri }: { uri: string }) { shown = h.api.useCoverTint(uri); return null; }
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(React.createElement(Probe, { uri: 'https://art.test/first' })); });
    await act(async () => { renderer.update(React.createElement(Probe, { uri: 'https://art.test/second' })); });
    await act(async () => { second.resolve(raw('#4466aa')); await second.promise; });
    const current = shown.color;
    await act(async () => { first.resolve(raw('#aa5522')); await first.promise; });
    assert.equal(shown.color, current);
    assert.notEqual(current, h.api.cachedCoverTint('https://art.test/first', 'dark'));
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('animated-cover flags are capped, reload after eviction and reject a callback captured for an older URI', async () => {
  const api = compile('../src/hooks/useAnimatedCover.ts', { '@/lib/boundedCache': { BoundedCache } });
  let shown: any;
  function Probe({ uri }: { uri: string }) { shown = api.useAnimatedCover(uri); return null; }
  let renderer!: ReactTestRenderer;
  const show = async (uri: string) => act(async () => { renderer.update(React.createElement(Probe, { uri })); });
  try {
    await act(async () => { renderer = create(React.createElement(Probe, { uri: 'first' })); });
    const oldCallback = shown.onCoverLoad;
    await act(async () => { oldCallback('first', true); });
    assert.equal(shown.isAnimated, true);
    await show('second');
    await act(async () => { oldCallback('first', true); });
    assert.equal(shown.isAnimated, false, 'late old-URI decoder result must not animate the current song');
    for (let index = 0; index < 256; index++) {
      const uri = `filler-${index}`;
      await show(uri);
      await act(async () => { shown.onCoverLoad(uri, true); });
    }
    await show('first');
    assert.equal(shown.isAnimated, false, 'an evicted animation flag falls back safely until its decoder answers');
    await act(async () => { shown.onCoverLoad('first', true); });
    assert.equal(shown.isAnimated, true);
    await show('filler-255');
    assert.equal(shown.isAnimated, true, 'a recent completed flag is an immediate hit');
  } finally { await act(async () => { renderer?.unmount(); }); }
});
