import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { Freeze } from 'react-freeze';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import * as imageLeasePolicy from '../src/lib/routeImageLease';
import { appleArtworkAssetKey } from '../src/lib/appleArtistArtwork';
import { isArtistPhotoFingerprint } from '../src/lib/artistPhotoFingerprint';
import { resolveArtworkLocalUri } from '../modules/amll-background/artworkSource';
import { createCoverPathCache } from '../src/lib/coverPathCache';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const element = React.createElement;

/** Real React/Suspense and production components; only native hosts and navigation I/O are substitutes. */
function compile(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, atob, console, require(name: string) { const customization = defaultCustomizationBoundary(name); if (customization) return customization;
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return JSXRuntime;
    assert.ok(Object.hasOwn(imports, name), `Unexpected production dependency ${name}`); return imports[name];
  } });
  return exports;
}

const home = { key: 'tabs', name: '(tabs)' };
const artist = (key: string) => ({ key, name: 'artist/[id]' });
const album = (key: string) => ({ key, name: 'album/[id]' });
type Route = { key: string; name: string };

function harness() {
  let routes: Route[] = [home];
  let navigationState = { index: 0, routes };
  const stateListeners = new Set<() => void>();
  const navigation = { isReady: () => true, getRootState: () => navigationState,
    addListener(name: string, callback: () => void) {
      if (name === 'state') stateListeners.add(callback);
      return () => { stateListeners.delete(callback); };
    } };
  const resources = compile('../src/components/RouteImageResources.tsx', {
    'expo-router': { useNavigationContainerRef: () => navigation },
    'react-freeze': { Freeze }, '@/lib/routeImageLease': imageLeasePolicy,
  });
  const nativeImages = new Set<string>(); const nativeMasks = new Set<string>();
  const connectedPages = new Set<string>(); const pageMounts = new Map<string, number>();
  const pageState = new Map<string, object>(); const events: string[] = [];
  const metadata: unknown[] = [];
  let serial = 0;
  function NativeImage(props: any) {
    const [id] = React.useState(() => `image-${++serial}`);
    const onFirstDisplay = React.useRef<(() => void) | undefined>(props.onDisplay);
    // Passive lifetime deliberately distinguishes real unmount from Suspense's
    // layout-effect disconnect: hiding a retained image is not native release.
    React.useEffect(() => {
      nativeImages.add(id); events.push(`image-mounted:${id}`);
      onFirstDisplay.current?.();
      return () => { nativeImages.delete(id); events.push(`image-released:${id}`); };
    }, [id]);
    if (props.source?.release) assert.equal(props.source.releases, 0, 'never render a released ImageRef');
    return element('native-image', props);
  }
  function NativeMask(props: any) {
    const [id] = React.useState(() => `mask-${++serial}`);
    React.useEffect(() => { nativeMasks.add(id); return () => { nativeMasks.delete(id); }; }, [id]);
    return element('native-mask', props, props.children);
  }
  const hero = compile('../src/components/volta/VoltaDetailHeroFade.tsx', {
    '@/api/data': { CACHED_COVER: 'cached-cover:' },
    '@/components/RouteImageResources': resources,
    '../../../modules/liquid-glass': { isArtistImageTraceEnabled: false },
    'expo-image': { Image: NativeImage }, 'expo-linear-gradient': { LinearGradient: 'gradient' },
    '@react-native-masked-view/masked-view': { __esModule: true, default: NativeMask },
    'react-native': { View: 'view', StyleSheet: { absoluteFill: {} } },
    'react-native-reanimated': { __esModule: true, default: { View: 'animated-view' } },
  });
  const covers = compile('../src/components/Cover.tsx', {
    '@/components/Icon': { __esModule: true, default: 'icon' },
    '@/components/RouteImageResources': resources,
    '@/api/data': { CACHED_COVER: 'cached-cover:', COVER: { full: 1200, card: 600, thumb: 100 } },
    'expo-image': { Image: NativeImage },
    'react-native': { View: 'view', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@/hooks/useImageAnimation': { useImageAnimation: () => ({ autoplay: false, onDisplay() {} }) },
    '@/lib/perfLog': { bump() {} }, '@/lib/coverPathCache': { createCoverPathCache },
    '@/store/settings': { useSettings: (select: (state: object) => unknown) => select({ coverCorners: 'default' }) },
    '@/theme': { colors: { surfaceHighlight: '#333333', textSecondary: '#aaaaaa' }, radius: { sm: 4, md: 8, lg: 12, xl: 16 } },
  });
  function Page({ route }: { route: Route }) {
    const [state] = React.useState(() => {
      pageMounts.set(route.key, (pageMounts.get(route.key) ?? 0) + 1);
      return { scroll: 317, selection: new Set(['song-4']), marker: {} };
    });
    React.useLayoutEffect(() => {
      connectedPages.add(route.key); events.push(`layout-connected:${route.key}`);
      return () => { connectedPages.delete(route.key); events.push(`layout-disconnected:${route.key}`); };
    }, [route.key]);
    pageState.set(route.key, state);
    return element('page', { routeKey: route.key }, element(covers.Cover, {
      uri: `file:///${route.key}-thumb.jpg`, size: 140, onImageMetadata: (...args: unknown[]) => metadata.push(args),
    }), element(hero.VoltaDetailHeroFade, {
      uri: `file:///${route.key}.jpg`, sourceUri: `file:///${route.key}.jpg`, textureUri: `file:///${route.key}-field.png`,
      width: 400, height: 400, extensionHeight: 120, imageStyle: {},
    }));
  }
  function Pages() {
    const snapshot = React.useSyncExternalStore((callback) => { stateListeners.add(callback); return () => { stateListeners.delete(callback); }; },
      () => navigationState);
    return element(React.Fragment, null, snapshot.routes.map((route) => element(resources.RootScreenImageResources,
      { key: route.key, routeKey: route.key }, element(Page, { route }))));
  }
  let listeners: { transitionStart: (event: object) => void; transitionEnd: (event: object) => void };
  const app = element(resources.RootImageResourceProvider, { children: (next: typeof listeners) => { listeners = next; return element(Pages); } });
  let renderer: ReactTestRenderer;
  return { resources, Hero: hero.VoltaDetailHeroFade, NativeImage, nativeImages, nativeMasks, connectedPages, pageMounts, pageState, events, metadata,
    async mount() { await act(async () => { renderer = create(app); }); },
    async navigate(next: Route[], complete = true) {
      routes = next; navigationState = { index: routes.length - 1, routes };
      await act(async () => { for (const callback of [...stateListeners]) callback();
        listeners.transitionStart({ target: routes.at(-1)!.key, data: { closing: false } }); });
      if (complete) await act(async () => { listeners.transitionEnd({ target: routes.at(-1)!.key, data: { closing: false } }); });
    },
    async unmount() { await act(async () => { renderer.unmount(); }); },
    image(uri: string) { return renderer.root.findAllByType(NativeImage).find((image) => image.props.source?.uri === uri); },
  };
}

describe('real React route image resource commits and Suspense', () => {
  it('settles the hidden two-image composite after a request changes while its field URI stays the same', async () => {
    const h = harness(); const readiness: boolean[] = [];
    const props = { uri: 'https://example.com/full.jpg', sourceUri: 'file:///full.jpg', textureUri: 'file:///field.png',
      width: 400, height: 400, extensionHeight: 120, imageStyle: {}, onReadyChange: (ready: boolean) => readiness.push(ready) };
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(element(h.Hero, props)); });
    assert.deepEqual(readiness, [false, true]); assert.equal(h.nativeImages.size, 2);
    const previous = new Set(h.nativeImages);
    await act(async () => { renderer.update(element(h.Hero, { ...props, cacheOnly: true })); });
    assert.deepEqual(readiness, [false, true, false, true], 'the remounted same-URI field must report readiness while its parent is hidden');
    assert.equal(h.nativeImages.size, 2);
    assert.ok([...h.nativeImages].every((id) => !previous.has(id)), 'both current decoder completions belong to the new request');
    await act(async () => { renderer.unmount(); }); assert.equal(h.nativeImages.size, 0);
  });

  it('releases actual hero image/mask subtrees while preserving page scroll and selection state through deep navigation', async () => {
    const h = harness(); await h.mount();
    const routes = [home, artist('a0'), album('b0')]; await h.navigate(routes);
    const firstState = h.pageState.get('a0');
    for (let i = 1; i <= 12; i++) {
      routes.push(artist(`a${i}`)); await h.navigate([...routes]);
      routes.push(album(`b${i}`)); await h.navigate([...routes]);
      assert.equal(h.nativeImages.size, 9, 'only tabs plus current/previous covers and 2-image heroes own native targets');
      assert.equal(h.nativeMasks.size, 6, 'retired pages must unmount both real MaskedView hosts');
    }
    assert.equal(h.pageMounts.get('a0'), 1);
    assert.equal(h.pageState.get('a0'), firstState, 'retiring images must not recreate page/scroll/selection state');
    assert.equal(h.connectedPages.has('a0'), false, 'only the retired resource-free page may suspend');
    const imageRelease = h.events.findIndex((event) => event.startsWith('image-released:'));
    const pageFreeze = h.events.indexOf('layout-disconnected:a0');
    assert.ok(imageRelease >= 0 && imageRelease < pageFreeze, 'the image removal commit flushes before Suspense disconnects the page');
    await h.navigate([home, artist('a0')]);
    assert.equal(h.pageState.get('a0'), firstState);
    assert.equal(h.pageMounts.get('a0'), 1);
    assert.equal(h.connectedPages.has('a0'), true);
    assert.equal(h.nativeImages.size, 6);
    await h.unmount(); assert.equal(h.nativeImages.size, 0); assert.equal(h.nativeMasks.size, 0);
  });

  it('keeps an artist under player and the player under lyrics connected and fully painted despite lost focus', async () => {
    const h = harness(); await h.mount();
    await h.navigate([home, artist('artist'), { key: 'player', name: 'player' }, { key: 'lyrics', name: 'lyrics' }]);
    for (const key of ['tabs', 'artist', 'player', 'lyrics']) assert.equal(h.connectedPages.has(key), true, key);
    assert.equal(h.nativeImages.size, 12);
    assert.equal(h.events.includes('layout-disconnected:player'), false);
    assert.equal(h.events.includes('layout-disconnected:artist'), false);
    await h.unmount();
  });

  it('rejects old native Cover callbacks when a retired URI is reacquired by a fresh route lease', async () => {
    const h = harness(); await h.mount();
    await h.navigate([home, artist('a'), album('b')]);
    const uri = 'file:///a-thumb.jpg';
    const old = h.image(uri)!; assert.ok(old);
    const oldError = old.props.onError; const oldLoad = old.props.onLoad;
    await h.navigate([home, artist('a'), album('b'), artist('c')]);
    assert.equal(h.image(uri), undefined);
    await h.navigate([home, artist('a')]); assert.ok(h.image(uri));
    await act(async () => { oldError(); oldLoad({ source: { width: 200, height: 200, isAnimated: false } }); });
    assert.ok(h.image(uri), 'late error from the disposed target must not blank the fresh cover');
    assert.equal(h.metadata.length, 0, 'late metadata belongs to the retired lease');
    await act(async () => { h.image(uri)!.props.onLoad({ source: { width: 240, height: 240, isAnimated: false } }); });
    assert.equal(h.metadata.length, 1);
    await h.unmount();
  });

  it('does not release a leased native artist-name handle when real Suspense hides and restores its layout effects', async () => {
    const h = harness();
    const photo = 'https://is1-ssl.mzstatic.com/image/thumb/photo/6d67888b-9e7f-53af-7853-0f91d6fd2332/1200x1200bb.jpg';
    const logo = { uri: 'https://is1-ssl.mzstatic.com/image/thumb/logo/1000x262bb.png', width: 1000, height: 262 };
    const refs: { releases: number; release(): void; isAnimated: boolean }[] = [];
    const bytes = new Uint8Array(25); bytes[2] = 128; bytes[5] = 0x53;
    const nameHook = compile('../src/hooks/useAppleArtistNameArtwork.ts', {
      '@/components/RouteImageResources': h.resources,
      '@/api/data': { CACHED_COVER: 'cached-cover:' },
      'expo-file-system/legacy': { cacheDirectory: undefined },
      'expo-image': { Image: { getCachePathAsync: async () => '/cache/logo.png', prefetch: async () => true,
        loadAsync: async () => { const ref = { releases: 0, isAnimated: false, release() { this.releases++; } }; refs.push(ref); return ref; },
        generateThumbhashAsync: async () => btoa(String.fromCharCode(...bytes)) } },
      '@/lib/appleArtistArtwork': { appleArtworkAssetKey, getCachedAppleArtistArtwork: () => ({ artistId: '159260351', nameArtwork: logo }) },
      '@/lib/artistPhotoFingerprint': { isArtistPhotoFingerprint }, '@/lib/verifyAppleArtistPhoto': {},
      '@/store/auth': { useAuthStore: () => {}, profileScopeId: () => 'scope' },
      '../../modules/amll-background/artworkSource': { resolveArtworkLocalUri },
    });
    let layoutConnected = false;
    function Name() {
      const loaded = nameHook.useAppleArtistNameArtwork(photo, 'Taylor Swift');
      React.useLayoutEffect(() => { layoutConnected = true; return () => { layoutConnected = false; }; }, []);
      return loaded ? element(h.NativeImage, { source: loaded.image }) : null;
    }
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(element(Freeze, { freeze: false, children: element(Name) })); });
    assert.equal(refs.length, 1); assert.equal(layoutConnected, true); assert.equal(h.nativeImages.size, 1);
    await act(async () => { renderer.update(element(Freeze, { freeze: true, children: element(Name) })); });
    assert.equal(layoutConnected, false, 'this test must actually disconnect layout effects through Suspense');
    assert.equal(refs[0].releases, 0, 'passive image ownership survives layout-only disconnection');
    await act(async () => { renderer.update(element(Freeze, { freeze: false, children: element(Name) })); });
    assert.equal(layoutConnected, true); assert.equal(refs.length, 1); assert.equal(refs[0].releases, 0);
    await act(async () => { renderer.unmount(); });
    assert.equal(refs[0].releases, 1); assert.equal(h.nativeImages.size, 0);
  });
});
import { defaultCustomizationBoundary } from './helpers/defaultCustomizationBoundary';
