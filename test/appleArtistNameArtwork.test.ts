import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { resolveArtworkLocalUri } from '../modules/amll-background/artworkSource';
import { appleArtworkAssetKey, type AppleArtistArtwork } from '../src/lib/appleArtistArtwork';
import { isArtistPhotoFingerprint } from '../src/lib/artistPhotoFingerprint';
import { artistNameVisualFrame } from '../src/lib/artistHeaderTransition';

const A = '6d67888b-9e7f-53af-7853-0f91d6fd2332';
const B = '7518ccc2-97be-ccc7-6a31-6bde42af81fb';
const photo = (asset = A) => `https://is1-ssl.mzstatic.com/image/thumb/photo/${asset}/1200x1200bb.jpg`;
const artwork = (asset = A, logo = true): AppleArtistArtwork => ({ artistId: asset === A ? '159260351' : '137938148',
  artistName: asset === A ? 'Taylor Swift' : '陈奕迅', assetKey: asset, backgroundColor: '#070706', heroUrl: photo(asset),
  heroUrlTemplate: photo(asset), width: 1640, height: 1640, recommendedCropCodes: [],
  ...(logo ? { nameArtwork: { uri: `https://is1-ssl.mzstatic.com/image/thumb/official-${asset}/1000x262bb.png`, width: 4826, height: 1264 } } : {}) });
const hash = (opaque: boolean) => { const bytes = new Uint8Array(25); bytes[2] = opaque ? 0 : 128; bytes[5] = 0x53; return btoa(String.fromCharCode(...bytes)); };
type Ref = { isAnimated: boolean; width: number; height: number; releases: number; release(): void };
const image = (): Ref => ({ isAnimated: false, width: 1000, height: 262, releases: 0, release() { this.releases++; } });

function hooks() {
  const slots: any[] = []; const effects: (() => void)[] = []; const cleanups = new Set<() => void>(); let cursor = 0;
  const slot = <T,>(create: () => T): T => { const i = cursor++; return i in slots ? slots[i] : slots[i] = create(); };
  function effect(create: () => (() => void) | undefined, deps: unknown[]) {
    const state = slot(() => ({ deps: undefined as unknown[] | undefined, close: undefined as (() => void) | undefined }));
    if (state.deps && state.deps.every((value, i) => Object.is(value, deps[i]))) return;
    state.deps = deps; effects.push(() => { if (state.close) { cleanups.delete(state.close); state.close(); }
      state.close = create(); if (state.close) cleanups.add(state.close); });
  }
  return {
    react: {
      useRef: <T,>(value: T) => slot(() => ({ current: value })),
      useState: <T,>(value?: T) => { const state = slot(() => ({ value })); return [state.value, (next: T | ((previous: T | undefined) => T)) => {
        state.value = typeof next === 'function' ? (next as (previous: T | undefined) => T)(state.value) : next;
      }]; },
      useEffect: effect, useLayoutEffect: effect,
    },
    begin() { cursor = 0; }, commit() { while (effects.length) effects.shift()!(); },
    unmount() { for (const close of cleanups) close(); cleanups.clear(); },
  };
}
function compile(path: string, imports: Record<string, unknown>, globals: object = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, atob, ...globals, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected artist name dependency ${name}`); return imports[name];
  } });
  return exports;
}

function harness(files = new Map<string, string>()) {
  const runtime = hooks(); const paths = new Map<string, string>();
  const metadata = new Map<string, AppleArtistArtwork>();
  const calls: { uri: string; name?: string; offline: boolean; verification?: object }[] = [];
  const prefetches: string[] = []; const loads: { uri: string; options: Record<string, unknown>; image: Ref }[] = [];
  const pending = new Map<string, ((ref: Ref) => void)[]>();
  let deferred = false; let opaque = false; let profile = 'first';
  const module = compile('../src/hooks/useAppleArtistNameArtwork.ts', {
    react: runtime.react,
    'expo-file-system/legacy': { cacheDirectory: 'file:///cache/', async readAsStringAsync(path: string) { return files.get(path) ?? ''; },
      async writeAsStringAsync(path: string, value: string) { files.set(path, value); } },
    'expo-image': { Image: {
      async getCachePathAsync(uri: string) { return paths.get(uri) ?? null; },
      async prefetch(uri: string) { prefetches.push(uri); paths.set(uri, '/cached/logo.png'); return true; },
      async loadAsync(uri: string, options: Record<string, unknown>) {
        const ref = image(); loads.push({ uri, options, image: ref });
        return deferred ? new Promise<Ref>((resolve) => pending.set(uri, [...(pending.get(uri) ?? []), resolve])) : ref;
      },
      async generateThumbhashAsync() { return hash(opaque); },
    } },
    '@/api/data': { CACHED_COVER: 'cached-cover:' },
    '@/lib/appleArtistArtwork': { appleArtworkAssetKey,
      getCachedAppleArtistArtwork: () => null,
      async resolveAppleArtistArtwork(uri: string, name: string | undefined, offline: boolean, allowed: () => boolean, verification: object | undefined) {
        calls.push({ uri, name, offline, verification }); return !offline && allowed() ? metadata.get(uri) ?? null : null;
      } },
    '@/lib/artistPhotoFingerprint': { isArtistPhotoFingerprint },
    '@/lib/verifyAppleArtistPhoto': { verifyAppleArtistPhoto: async () => true },
    '@/store/auth': { useAuthStore: (select: (state: unknown) => unknown) => select({ auth: profile }), profileScopeId: () => profile },
    '../../modules/amll-background/artworkSource': { resolveArtworkLocalUri },
  });
  return { files, paths, metadata, calls, prefetches, loads,
    render(uri?: string, name?: string, offline = false, fingerprint?: string) {
      runtime.begin(); const result = module.useAppleArtistNameArtwork(uri, name, offline, fingerprint); runtime.commit(); return result;
    },
    deferred() { deferred = true; }, opaque() { opaque = true; }, profile(value: string) { profile = value; },
    resolve(uri: string, ref: Ref) { const done = pending.get(uri)?.shift(); assert.ok(done); done(ref); },
    unmount: runtime.unmount,
  };
}
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

describe('official artist name artwork ownership and offline bytes', () => {
  it('loads the verified original RGBA locally without a tint and persists only optional public metadata', async () => {
    const h = harness(); h.metadata.set(photo(), artwork());
    assert.equal(h.render(photo(), 'Taylor Swift'), undefined); await flush();
    const ready = h.render(photo(), 'Taylor Swift'); assert.ok(ready);
    assert.match(h.loads[0].uri, /^file:/); assert.equal(h.loads[0].options.tintColor, undefined, 'silver texture must not be flattened into white ink');
    assert.equal(ready.image, h.loads[0].image); assert.equal(h.files.size, 1);
    h.unmount(); assert.equal(ready.image.releases, 1);
  });

  it('keeps ordinary artist text when official name artwork is missing or decoded bytes are opaque', async () => {
    const absent = harness(); absent.metadata.set(photo(B), artwork(B, false));
    absent.render(photo(B), '陈奕迅'); await flush();
    assert.equal(absent.render(photo(B), '陈奕迅'), undefined); assert.equal(absent.loads.length, 0);
    const opaque = harness(); opaque.metadata.set(photo(), artwork()); opaque.opaque();
    opaque.render(photo(), 'Taylor Swift'); await flush();
    assert.equal(opaque.render(photo(), 'Taylor Swift'), undefined); assert.equal(opaque.loads[0].image.releases, 1);
  });

  it('can restore cached logo metadata and bytes after a cold offline start, but never fetches missing bytes', async () => {
    const online = harness(); online.metadata.set(photo(), artwork()); online.render(photo(), 'Taylor Swift'); await flush();
    const offline = harness(new Map(online.files)); offline.paths.set(artwork().nameArtwork!.uri, '/cached/persisted.png');
    offline.render(photo(), 'Taylor Swift', true); await flush();
    assert.ok(offline.render(photo(), 'Taylor Swift', true)); assert.equal(offline.calls.length, 0); assert.equal(offline.prefetches.length, 0);
    assert.equal(offline.loads[0].uri, 'file:///cached/persisted.png');
    const missing = harness(new Map(online.files)); missing.render(photo(), 'Taylor Swift', true); await flush();
    assert.equal(missing.render(photo(), 'Taylor Swift', true), undefined); assert.equal(missing.loads.length, 0); assert.equal(missing.prefetches.length, 0);
  });

  it('requires a native source fingerprint for an opaque server image and forwards its verifier instead of trusting a name', async () => {
    const h = harness(); const uri = 'https://music.example/share/img/opaque'; h.metadata.set(uri, artwork());
    h.render(uri, 'Taylor Swift'); await flush(); assert.equal(h.calls.length, 0);
    const fingerprint = '102030'.repeat(256);
    h.render(uri, 'Taylor Swift', false, fingerprint); await flush();
    assert.ok(h.calls[0].verification); assert.ok(h.render(uri, 'Taylor Swift', false, fingerprint));
  });

  it('releases stale decoded images after artist/profile switches and after unmount', async () => {
    const h = harness(); h.metadata.set(photo(), artwork()); h.metadata.set(photo(B), artwork(B)); h.deferred();
    h.paths.set(artwork().nameArtwork!.uri, '/cached/A.png'); h.paths.set(artwork(B).nameArtwork!.uri, '/cached/B.png');
    h.render(photo(), 'Taylor Swift'); await flush();
    h.render(photo(B), '陈奕迅'); await flush();
    const old = image(); h.resolve('file:///cached/A.png', old); await flush();
    assert.equal(old.releases, 1); assert.equal(h.render(photo(B), '陈奕迅'), undefined);
    const oldProfile = image(); const current = image(); h.profile('second'); h.render(photo(B), '陈奕迅'); await flush();
    h.resolve('file:///cached/B.png', oldProfile); await flush();
    assert.equal(oldProfile.releases, 1); assert.equal(h.render(photo(B), '陈奕迅'), undefined);
    h.resolve('file:///cached/B.png', current); await flush();
    assert.equal(current.releases, 0, 'the new profile owns its separately started decode');
    assert.equal(h.render(photo(B), '陈奕迅').image, current);
    h.unmount(); assert.equal(current.releases, 1);
  });
});

it('one visible name layer selects decoded art immediately without waiting for display events or drawing its text ruler', () => {
  const runtime = hooks();
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  let loaded: { image: Ref; width: number; height: number } | undefined;
  const module = compile('../src/components/volta/AppleArtistName.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'expo-image': { Image: 'Image' },
    'react-native': { Text: 'Text', View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: (style: unknown) => style, absoluteFill: { position: 'absolute', inset: 0 } } },
    'react-native-reanimated': { __esModule: true, default: { Text: 'Text', View: 'View' }, useAnimatedStyle: (read: () => unknown) => ({ read }) },
    '@/hooks/useAppleArtistNameArtwork': { useAppleArtistNameArtwork: () => loaded },
    '@/lib/artistHeaderTransition': { artistNameVisualFrame },
  });
  const textStyle = { fontSize: 34, lineHeight: 40, paddingBottom: 24, color: '#FFFFFF' };
  const animation = { opacity: .6 };
  const aspects: number[] = [];
  const name = 'Justin Bieber';
  let publishedLayout: unknown;
  const onLayout = (event: unknown) => { publishedLayout = event; };
  function render() {
    runtime.begin(); const tree = module.AppleArtistName({ name, uri: photo(), offline: false,
      width: 411, bottomPadding: 24, artworkAspect: { set: (value: number) => aspects.push(value) },
      textStyle, animationStyle: animation, onLayout });
    runtime.commit(); return tree.props.children;
  }
  let [ruler, overlay] = render();
  assert.equal(ruler.props.children, name); assert.equal(ruler.props.style[1].opacity, 0);
  assert.equal(ruler.props.style[0], textStyle);
  assert.equal(ruler.props.accessible, false);
  assert.equal(overlay.props.children.props.style[1].opacity, 0, 'nothing is painted at guessed native image bounds before its real first layout');
  const layoutEvent = { nativeEvent: { layout: { y: 300, height: 64 } } };
  ruler.props.onLayout(layoutEvent); [ruler, overlay] = render();
  assert.equal(publishedLayout, layoutEvent, 'the exact ruler layout still drives the screen header handoff');
  assert.equal(overlay.props.children.props.children.type, 'Text');
  assert.equal(overlay.props.children.props.children.props.children, name);
  loaded = { image: image(), width: 4826, height: 1264 };
  [ruler, overlay] = render();
  const positioned = overlay.props.children;
  const artworkView = positioned.props.children;
  const frame = artworkView.props.style[1]; const origin = positioned.props.style[1];
  assert.equal(artworkView.props.style[0].position, 'absolute');
  assert.ok(frame.top < 0, 'the logo grows upward, never pushing the play row down');
  assert.ok(Math.abs(origin.top + frame.top + frame.height - 340) < .00001, 'logo bottom stays at the ordinary name’s ink baseline');
  assert.ok(frame.width <= 411 * .8); assert.equal(overlay.props.style[1], animation);
  assert.equal(positioned.props.accessibilityLabel, name); assert.equal(positioned.props.accessibilityRole, 'header');
  assert.equal(positioned.props.importantForAccessibility, 'yes');
  assert.equal(overlay.props.accessible, false, 'the full-photo animation wrapper cannot gain an Android focus highlight');
  const img = artworkView.props.children;
  assert.equal(img.props.source, loaded.image); assert.equal(img.props.tintColor, undefined);
  assert.equal(img.props.onDisplay, undefined, 'a delayed or absent display callback cannot leave ordinary text behind the art');
  assert.equal(ruler.props.style[1].opacity, 0, 'the only remaining text node is a permanently hidden ruler');
  assert.equal(aspects.at(-1), 4826 / 1264);
  loaded = { ...loaded, image: image() }; [ruler, overlay] = render();
  img.props.onError(); [ruler, overlay] = render();
  const currentImage = overlay.props.children.props.children.props.children;
  assert.equal(currentImage.props.source, loaded.image, 'an obsolete image error cannot expose plain text beneath a newer name graphic');
  currentImage.props.onError(); [ruler, overlay] = render();
  assert.equal(overlay.props.children.props.children.type, 'Text', 'display failure restores the single ordinary name layer');
  assert.equal(aspects.at(-1), 0); assert.equal(ruler.props.style[1].opacity, 0);
});

it('a cached large logo has real React dimensions from its first layout and stays inside the same baseline after resizing', () => {
  const runtime = hooks(); const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  const loaded = { image: image(), width: 100, height: 250 };
  const module = compile('../src/components/volta/AppleArtistName.tsx', {
    react: runtime.react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'expo-image': { Image: 'Image' },
    'react-native': { Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } },
    // No animated layout hook is provided: only the parent opacity is animated.
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' } },
    '@/hooks/useAppleArtistNameArtwork': { useAppleArtistNameArtwork: () => loaded },
    '@/lib/artistHeaderTransition': { artistNameVisualFrame },
  });
  const opacity = { opacity: 1 }; const measurements: object[] = [];
  function render(width: number) {
    runtime.begin(); const tree = module.AppleArtistName({ name: 'Artist', offline: true, width, bottomPadding: 24,
      textStyle: { fontSize: 34 }, animationStyle: opacity, onLayout: (event: object) => measurements.push(event) });
    runtime.commit(); return tree.props.children;
  }
  let [ruler, overlay] = render(320); let positioned = overlay.props.children;
  assert.equal(positioned.props.style[1].opacity, 0);
  assert.equal(positioned.props.children.props.style[1].width, 256, 'a cached bitmap never starts with a full-screen native width');
  ruler.props.onLayout({ nativeEvent: { layout: { y: 200, height: 104 } } });
  [, overlay] = render(320); positioned = overlay.props.children;
  let frame = positioned.props.children.props.style[1]; let origin = positioned.props.style[1];
  assert.equal(origin.opacity, 1); assert.equal(frame.width, 256); assert.equal(frame.height, 80);
  assert.equal(origin.top + frame.top + frame.height, 280);
  [ruler, overlay] = render(411); positioned = overlay.props.children; frame = positioned.props.children.props.style[1];
  assert.equal(frame.width, 411 * .8, 'rotation uses a normal React/Yoga image layout, never a deferred UI-only width');
  ruler.props.onLayout({ nativeEvent: { layout: { y: 300, height: 64 } } });
  [, overlay] = render(411); positioned = overlay.props.children; frame = positioned.props.children.props.style[1]; origin = positioned.props.style[1];
  assert.ok(Math.abs(origin.top + frame.top + frame.height - 340) < 1e-10);
  assert.equal(positioned.props.accessibilityRole, 'header'); assert.equal(positioned.props.accessible, true);
  assert.equal(overlay.props.style[1], opacity); assert.equal(measurements.length, 2);
});
