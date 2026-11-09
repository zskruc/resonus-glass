import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import { buildPrimuseAlbumPalette } from '../src/lib/primuseAlbumPalette';
import { resolveArtworkLocalUri } from '../modules/amll-background/artworkSource';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const element = React.createElement;
const URI = 'file:///cover-A.png';
const FIELD = { textureUri: 'file:///field-A.png', textureScale: 1.25, width: 320, height: 320, primary: '#D90A40' };
type NativeResult = typeof FIELD | null;
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Actual hook + two actual providers. Only native preparation/image display,
 * navigation ownership and native hosts are controlled boundaries; no copied
 * readiness algorithm or global module mock substitutes for the code under test. */
function harness() {
  let lease = { active: true }, profile = 'profile-A';
  let native: () => Promise<NativeResult> = async () => FIELD;
  let cachePath: (key: string) => Promise<string | null> = async () => null;
  let latest: any, events: any, mounts = 0;
  const imports: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { View: 'view', ActivityIndicator: 'spinner',
      StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' } } },
    'react-native-reanimated': { __esModule: true, default: { View: 'animated-view' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24 }) },
    'expo-image': { Image: { getCachePathAsync: (key: string) => cachePath(key) } },
    '@/components/BackChevron': { BackChevron: 'back' },
    '@/components/RouteImageResources': { useRouteImageLease: () => lease },
    '@/api/data': { CACHED_COVER: 'cached-cover:' },
    '@/store/auth': { profileScopeId: () => profile,
      useAuthStore: (selector: (value: unknown) => unknown) => selector({ auth: {}, offline: false }) },
    '@/theme': { useThemeMode: () => 'dark', colors: { background: '#111111', text: '#ffffff' }, spacing: { lg: 16, sm: 8 } },
    '@/i18n': { useT: () => (key: string) => key },
    '@/lib/primuseAlbumPalette': { buildPrimuseAlbumPalette },
    '../../modules/amll-background/albumArtwork': { preparePrimuseAlbumArtwork: () => native() },
    '../../modules/amll-background/artworkSource': { resolveArtworkLocalUri },
  };
  function source(path: string) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, setTimeout, clearTimeout, require(name: string) { const customization = defaultCustomizationBoundary(name); if (customization) return customization;
      assert.ok(Object.hasOwn(imports, name), `Unexpected integration import ${name}`); return imports[name];
    } });
    return exports;
  }
  const detail = source('src/components/DetailHeroScene.tsx');
  imports['@/components/DetailHeroScene'] = detail;
  const scene = source('src/components/primuse/PrimuseAlbumScene.tsx');
  const hook = source('src/hooks/usePrimuseAlbumPalette.ts');
  function Content() {
    events = scene.usePrimuseAlbumScene();
    React.useLayoutEffect(() => { mounts++; return () => { mounts--; }; }, []);
    return element('tracks');
  }
  function Page({ uri = URI }: { uri?: string; tick: number }) {
    latest = hook.usePrimuseAlbumPalette(uri, false, 0.04);
    return element(detail.DetailHeroScene, { identity: uri, loadingColor: latest.palette.backgroundTop,
      style: { backgroundColor: latest.palette.background }, background: element('gradient', {
        colors: [latest.palette.backgroundTop, latest.palette.backgroundTop, latest.palette.background],
      }) }, element(scene.PrimuseAlbumScene, {
      enabled: true, uri, textureUri: latest.textureUri, prepared: latest.ready,
    }, element(Content)));
  }
  let renderer: ReactTestRenderer | undefined, tick = 0, uri = URI;
  const render = () => element(Page, { uri, tick: tick++ });
  return {
    async mount(nextUri = uri) { uri = nextUri; await act(async () => { renderer = create(render()); }); },
    async update(nextUri = uri) { uri = nextUri; await act(async () => { renderer!.update(render()); }); },
    async unmount() { await act(async () => { renderer?.unmount(); }); renderer = undefined; },
    async cover() { await act(async () => { latest.onArtworkLoad(uri); events.coverDisplayed(); }); },
    async field() { await act(async () => { events.fieldDisplayed(); }); },
    async textureError() { await act(async () => { latest.onTextureError(latest.textureUri); events.fieldDisplayed(); }); },
    native(read: () => Promise<NativeResult>) { native = read; },
    cachePath(read: (key: string) => Promise<string | null>) { cachePath = read; },
    lease(active: boolean) { lease = { active }; },
    profile(value: string) { profile = value; },
    latest: () => latest, events: () => events, mounts: () => mounts,
    visible: () => renderer!.root.findByProps({ testID: 'detail-hero-scene-content' }).props.style.at(-1).opacity,
  };
}

test('warm validation miss and display wake cannot hide an already painted album', async () => {
  const h = harness();
  try {
    await h.mount(); await h.cover(); await h.field();
    assert.equal(h.visible(), 1);
    await h.unmount();
    const probe = deferred<NativeResult>(), displayed = deferred<NativeResult>();
    let calls = 0;
    h.native(() => ++calls === 1 ? probe.promise : displayed.promise);
    await h.mount(); await h.cover(); await h.field();
    assert.equal(calls, 2, 'display can race the first local revalidation');
    assert.equal(h.visible(), 1);
    await act(async () => { probe.resolve(null); });
    await h.update();
    assert.equal(h.latest().ready, true, 'a failed probe must not retract the active lease\'s successful entry');
    assert.equal(h.latest().textureUri, FIELD.textureUri);
    assert.equal(h.visible(), 1, 'ordinary parent updates cannot flash a completely revealed page');
    await act(async () => { displayed.resolve(FIELD); });
    assert.equal(h.visible(), 1); assert.equal(h.mounts(), 1);
  } finally { await h.unmount(); }
});

test('an evicted texture retries locally once and keeps its painted scene and palette', async () => {
  const h = harness();
  try {
    await h.mount(); await h.cover(); await h.field();
    const palette = h.latest().palette;
    let calls = 0;
    h.native(async () => { calls++; return FIELD; });
    await h.textureError();
    assert.equal(calls, 1);
    assert.equal(h.latest().textureRevision, 1, 'same-URI regeneration gets a new native image target');
    assert.equal(h.latest().textureUri, FIELD.textureUri);
    assert.equal(h.visible(), 1);
    await h.textureError();
    assert.equal(calls, 1, 'a second file/decoder failure settles without a retry loop');
    assert.equal(h.latest().textureUri, undefined);
    assert.equal(h.latest().palette, palette);
    assert.equal(h.visible(), 1);
  } finally { await h.unmount(); }
});

test('a cold probe miss waits for post-display preparation and the field before its only reveal', async () => {
  const h = harness(), displayed = deferred<NativeResult>(); let calls = 0;
  h.native(() => ++calls === 1 ? Promise.resolve(null) : displayed.promise);
  try {
    await h.mount();
    assert.equal(h.latest().ready, true, 'the undisplayed initial miss can settle safely');
    assert.equal(h.visible(), 0, 'the cover has not displayed');
    await h.cover();
    assert.equal(calls, 2);
    assert.equal(h.latest().ready, false, 'cold display wake must supersede the initial miss while preparing');
    assert.equal(h.visible(), 0, 'cover display alone must not latch a neutral page before its field');
    await act(async () => { displayed.resolve(FIELD); });
    assert.equal(h.latest().ready, true);
    assert.equal(h.visible(), 0, 'prepared URI still needs a real field display');
    await h.field(); assert.equal(h.visible(), 1);
  } finally { await h.unmount(); }
});

test('released/reacquired leases reject old events and require new image displays', async () => {
  const h = harness();
  try {
    await h.mount(); await h.cover(); await h.field();
    const old = { ...h.latest(), ...h.events() };
    h.lease(false); await h.update();
    assert.equal(h.latest().textureUri, undefined);
    assert.equal(h.visible(), 0);
    h.lease(true); await h.update();
    await act(async () => { old.onArtworkLoad(URI); old.onTextureError(FIELD.textureUri); old.coverDisplayed(); old.fieldDisplayed(); });
    assert.equal(h.visible(), 0);
    assert.equal(h.latest().textureRevision, 0);
    await h.cover(); await h.field();
    assert.equal(h.visible(), 1); assert.equal(h.mounts(), 1);
  } finally { await h.unmount(); }
});

test('a disk encoding slightly after onDisplay gets bounded cache-only probes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); let cacheCalls = 0, nativeCalls = 0;
  h.cachePath(async () => ++cacheCalls >= 3 ? URI : null);
  h.native(async () => { nativeCalls++; return FIELD; });
  try {
    await h.mount('https://cover.example/album.png');
    assert.equal(h.latest().textureUri, undefined);
    await h.cover();
    await act(async () => { t.mock.timers.tick(32); });
    assert.equal(cacheCalls, 3);
    assert.equal(nativeCalls, 1);
    assert.equal(h.latest().textureUri, FIELD.textureUri);
    await h.field(); assert.equal(h.visible(), 1);
    await h.update();
    await act(async () => { t.mock.timers.tick(1000); });
    assert.equal(cacheCalls, 3, 'ordinary rerenders do not start more cache probes');
  } finally { await h.unmount(); }
});

test('a permanently missing displayed cover cache stops after three local probes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); let cacheCalls = 0, nativeCalls = 0;
  h.cachePath(async () => { cacheCalls++; return null; });
  h.native(async () => { nativeCalls++; return FIELD; });
  try {
    await h.mount('https://cover.example/missing.png');
    await h.cover();
    await act(async () => { t.mock.timers.tick(32); });
    await act(async () => { t.mock.timers.tick(96); });
    assert.equal(cacheCalls, 4, 'one initial probe plus three post-display probes');
    assert.equal(nativeCalls, 0);
    assert.equal(h.latest().ready, true); assert.equal(h.visible(), 1);
    await h.update(); await h.cover();
    await act(async () => { t.mock.timers.tick(1000); });
    assert.equal(cacheCalls, 4, 'repeat image display and parent renders cannot retry indefinitely');
  } finally { await h.unmount(); }
});
import { defaultCustomizationBoundary } from './helpers/defaultCustomizationBoundary';
