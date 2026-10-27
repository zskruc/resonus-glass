import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as layoutRules from '../src/lib/amllPlayerLayout';
import { nativeMeasureBoundary } from './helpers/nativeMeasureBoundary';

type Element = { type: unknown; props: Record<string, any> };
type Mutable = { value: number; get(): number; set(value: number): void };
type Measurement = { pageX: number; pageY: number; width: number; height: number };
const jsx = (type: unknown, props: object) => ({ type, props });
const find = (node: unknown, name: string): Element[] => {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, name));
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [...(element.type === name ? [element] : []), ...find(element.props.children, name)];
};

function harness() {
  let cursor = 0;
  const slots: any[] = [], effects: (() => void)[] = [];
  const slot = <T,>(create: () => T): T => slots[cursor++] ??= create();
  const effect = (create: () => void, deps: unknown[]) => {
    const state = slot(() => ({ deps: undefined as unknown[] | undefined }));
    if (state.deps && deps.every((value, index) => Object.is(value, state.deps![index]))) return;
    state.deps = deps; effects.push(create);
  };
  const song = { id: 'song', title: 'Title', artist: 'Artist', duration: 277, starred: false, url: undefined as string | undefined };
  const player = { song, isPlaying: false, isBuffering: false, durationSec: 277, shuffle: false, repeat: 'off',
    toggle() {}, next() {}, previous() {}, toggleShuffle() {}, cycleRepeat() {} };
  const settings = { showAudioQuality: false, showSystemVolume: false, fitCoverArt: false, marqueeTitles: false };
  const dimensions = { width: 384, height: 832, fontScale: 1 };
  const safeArea = { top: 24, bottom: 16, left: 0, right: 0 };
  const values: Mutable[] = [];
  let measured: Measurement | null = { pageX: 24, pageY: 106.9333333333, width: 336, height: 336 };
  let shadowNode: object | null = {};
  const nativeMeasure = nativeMeasureBoundary(() => measured ? { x: 0, y: 0, ...measured } : null);
  let transitionProps: Record<string, any>;
  let closeCalls = 0;
  const menuCalls: any[][] = [];
  const transition = { closing: false, entryReady: true, rootStyle: {}, contentStyle: {}, artworkStyle: {},
    controlsMotionStyle: {}, handleGesture: {}, close() { closeCalls++; }, onArtworkLayout() {}, onClipHostReady() {} };
  const dependencies: Record<string, any> = {
    react: { useRef: (value: unknown) => slot(() => ({ current: value })),
      useState: (initial: unknown) => { const state = slot(() => ({ value: initial }));
        return [state.value, (value: unknown) => { state.value = typeof value === 'function' ? value(state.value) : value; }]; },
      useMemo: (create: () => unknown) => create(), useCallback: (callback: unknown) => callback,
      useEffect: effect },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'expo-router': { useIsFocused: () => true },
    'expo-navigation-bar': { NavigationBar: 'NavigationBar' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native': { ActivityIndicator: 'Spinner', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: (styles: unknown) => styles }, useWindowDimensions: () => dimensions,
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
      cancelAnimation() {}, useAnimatedScrollHandler: (callbacks: unknown) => callbacks,
      useAnimatedRef: () => slot(() => Object.assign(() => shadowNode, { current: null })),
      measure: nativeMeasure.measure,
      useAnimatedStyle: (read: () => unknown) => ({ read }), withSpring: (target: number) => target,
      interpolate: (value: number, [start, end]: number[], [low, high]: number[]) => low + (high - low) * (value - start) / (end - start),
      useSharedValue: (initial: number) => slot(() => {
        const value: Mutable = { value: initial, get() { return this.value; }, set(next) { this.value = next; } };
        values.push(value); return value;
      }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => safeArea },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector' },
    '@/api/data': { CACHED_COVER: 'cached:', COVER: { card: 'card' }, songCoverUrl: () => 'https://example.test/cover.jpg' },
    '@/hooks/useAmllPlayerTransition': { useAmllPlayerTransition: (props: Record<string, any>) => {
      transitionProps = props; return transition;
    } },
    '@/hooks/useDominantColor': { useCoverTint: () => ({ known: false }) },
    '@/hooks/useLyrics': { useLyrics: () => ({}) },
    '@/i18n': { useT: () => (text: string) => text },
    '@/lib/amllPlayerLayout': layoutRules,
    '@/lib/amllLyricPlayback': { seekAndPlayAmllLyricLine() {} },
    '@/lib/format': { formatGroupedDeviceLabel: () => '' },
    '@/lib/haptics': { haptic() {} },
    '@/lib/playerPalette': { buildPlayerPalette: () => null },
    '@/lib/pushOnce': { pushOnce() {} },
    '@/store/jukebox': { useJukebox: (select: (state: object) => unknown) => select({ active: false }) },
    '@/store/player': { currentSong: (state: typeof player) => state.song,
      usePlayerStore: (select: (state: typeof player) => unknown) => select(player), useLiveInfo: () => null },
    '@/store/settings': { useSettings: (select: (state: typeof settings) => unknown) => select(settings) },
    '@/store/songMenu': { useSongMenu: (select: (state: object) => unknown) => select({ open(...args: any[]) { menuCalls.push(args); } }) },
    '@/store/toast': {},
    '@/store/upnp': { useUpnp: (select: (state: object) => unknown) => select({ connected: false, devices: [] }) },
    '../../modules/liquid-glass': { PlayerSurfaceClipView: 'SurfaceClip', isNativePlayerSurfaceClipAvailable: true },
  };
  for (const name of ['AmllPlayerBackground', 'AmllSlider', 'AudioQualityBadge', 'Cover', 'MarqueeText', 'OutputSheet',
    'PlayerAudioQualitySheet', 'PlayerSystemVolume', 'SeekBar', 'SpeedSheet']) {
    dependencies[`@/components/${name}`] = { [name]: name };
  }
  dependencies['@/components/AmllPlayerControls'] = { AmllPlayerControls: 'Controls', AmllPlayerBottomActions: 'BottomActions',
    AmllPlayerMoreButton: 'More', AmllPlayerFavoriteButton: 'FavoriteControl' };
  dependencies['@/components/LyricsCard'] = { SyncedLyricsView: 'Lyrics' };
  const output = ts.transpileModule(readFileSync(new URL('../src/components/AmllPlayerScreen.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(output, { exports, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected screen dependency ${name}`); return dependencies[name];
  } });
  return { player, settings, dimensions, values, transition, menuCalls, closeCalls: () => closeCalls,
    shadowNode(value: object | null) { shadowNode = value; },
    nativeMeasureCalls: nativeMeasure.calls,
    measure(value: Measurement | null) { measured = value; },
    readArtwork: () => transitionProps.readArtwork(),
    transitionProps: () => transitionProps,
    render() { cursor = 0; const tree = exports.AmllPlayerScreen(); while (effects.length) effects.shift()!(); return tree; } };
}

test('the real screen reader skips native measure for a null Fabric ref, then measures after attachment', () => {
  const h = harness(); h.render();
  h.shadowNode(null);
  assert.equal(h.readArtwork(), null);
  assert.equal(h.nativeMeasureCalls.length, 0);
  h.shadowNode({ nativeShadowNode: 'mounted' });
  const artwork = h.readArtwork();
  assert.ok(artwork);
  assert.ok(Math.abs(artwork.width - 285.6) < .001);
  assert.equal(h.nativeMeasureCalls.length, 1);
  h.shadowNode(null);
  assert.equal(h.readArtwork(), null);
  assert.equal(h.nativeMeasureCalls.length, 1, 'a later detached ref must not reach the native boundary either');
});

test('the actual screen uses full-window portrait anchors and retains one fixed decoded cover across playback changes', () => {
  const h = harness();
  let tree = h.render();
  const image = find(tree, 'Cover')[0];
  assert.equal(find(tree, 'Cover').length, 1);
  assert.equal(image.props.size, 336);
  assert.equal(find(tree, 'Controls')[0].props.width, 384);
  const frame = find(tree, 'AnimatedView').find((node) => node.props.ref && node.props.collapsable === false)!;
  assert.equal(frame.props.style.left, 24);
  assert.equal(frame.props.style.top + 24 + 8 + 44, 106.9333333333);
  const cover = find(tree, 'AnimatedView').find((node) => Array.isArray(node.props.style)
    && node.props.style[0]?.transformOrigin === 'top left')!;
  assert.ok(Math.abs(cover.props.style[1].read().transform[2].scale - .85) < .000001);
  let artwork = h.readArtwork();
  assert.ok(Math.abs(artwork.x - 49.2) < .001);
  assert.ok(Math.abs(artwork.y - 132.1333333333) < .001);
  assert.ok(Math.abs(artwork.width - 285.6) < .001);
  h.player.isPlaying = true; tree = h.render();
  assert.equal(find(tree, 'Cover').length, 1);
  assert.equal(find(tree, 'Cover')[0].props.size, image.props.size);
  const playingCover = find(tree, 'AnimatedView').find((node) => Array.isArray(node.props.style)
    && node.props.style[0]?.transformOrigin === 'top left')!;
  assert.equal(playingCover.props.style[1].read().transform[2].scale, 1);
  artwork = h.readArtwork();
  assert.equal(artwork.x, 24);
  assert.ok(Math.abs(artwork.y - 106.9333333333) < .001);
  assert.equal(artwork.width, 336);
});

test('the screen forwards the existing volume preference and safe-area geometry without replacing it', () => {
  const h = harness();
  assert.equal(find(h.render(), 'Controls')[0].props.volume, undefined);
  h.settings.showSystemVolume = true;
  const tree = h.render(), controls = find(tree, 'Controls')[0];
  assert.equal(controls.props.volume.type, 'PlayerSystemVolume');
  assert.equal(controls.props.viewportHeight, 832);
  assert.equal(controls.props.active, true);
  assert.equal(controls.props.progress.props.active, true);
  const backgroundClip = find(tree, 'SurfaceClip')[0];
  assert.equal(backgroundClip.props.onClipHostReady, h.transition.onClipHostReady);
  assert.equal(backgroundClip.props.children.type, 'AmllPlayerBackground');
  h.transition.entryReady = false;
  assert.equal(find(h.render(), 'Controls')[0].props.active, false, 'entry preparation cannot expose interactive controls');
});

test('the source artwork reader follows the small lyric cover without returning the full-size measurement frame', () => {
  const h = harness();
  const controls = find(h.render(), 'Controls')[0];
  controls.props.onLyrics();
  const tree = h.render();
  const artwork = h.readArtwork();
  assert.equal(artwork.x, 32);
  assert.ok(Math.abs(artwork.y - 84) < .001);
  assert.equal(artwork.width, 72);
  assert.equal(artwork.height, 72);
  assert.equal(artwork.cornerRadius, 6);
  assert.equal(find(tree, 'Cover').length, 1);
  assert.equal(find(tree, 'Cover')[0].props.size, 336);
});

test('the source artwork reader applies the native frame origin and scrolling once, with a null-measure fallback', () => {
  const h = harness();
  const tree = h.render();
  const scroll = find(tree, 'AnimatedScrollView')[0];
  scroll.props.onScroll.onScroll({ contentOffset: { y: 70 } });
  assert.equal(h.transitionProps().headerScrollOffset.get(), 70);
  // Native page coordinates already include the column's scroll and any
  // ancestor motion; only the fixed local frame origin should be subtracted.
  h.measure({ pageX: 34, pageY: 36.9333333333, width: 336, height: 336 });
  let artwork = h.readArtwork();
  assert.ok(Math.abs(artwork.x - 59.2) < .001);
  assert.ok(Math.abs(artwork.y - 62.1333333333) < .001);
  h.measure({ pageX: 70, pageY: 200, width: 336, height: 336 });
  artwork = h.readArtwork();
  assert.ok(Math.abs(artwork.x - 95.2) < .001);
  assert.ok(Math.abs(artwork.y - 225.2) < .001);
  h.measure(null);
  assert.equal(h.readArtwork(), null);
});

test('only the full local-song metadata exposes the favorite action while compact lyrics keep their existing More control', () => {
  const h = harness();
  let tree = h.render();
  const favorite = find(tree, 'FavoriteControl');
  assert.equal(favorite.length, 1);
  assert.equal(favorite[0].props.id, 'song');
  assert.equal(favorite[0].props.active, true);
  assert.equal(find(tree, 'More').length, 2, 'the retained compact and large metadata keep their own More callback');
  h.player.song.url = 'https://radio.test/live';
  tree = h.render();
  assert.equal(find(tree, 'FavoriteControl').length, 0, 'radio URL metadata cannot expose the Subsonic star action');
});

test('both cover and lyric modes remove the visual handle and its tap target while retaining header space and accessible dismissal', () => {
  const h = harness();
  for (const lyrics of [false, true]) {
    if (lyrics) find(h.render(), 'Controls')[0].props.onLyrics();
    const tree = h.render();
    const detector = find(tree, 'GestureDetector')[0];
    assert.equal(detector.props.gesture, h.transition.handleGesture, 'the existing header pan remains attached');
    const headerSpace = detector.props.children.props.children[0];
    assert.equal(headerSpace.type, 'View');
    assert.equal(headerSpace.props.style.height, 44, 'retain the exact origin of all reference layout anchors');
    assert.equal(headerSpace.props.pointerEvents, 'none');
    assert.equal(headerSpace.props.accessible, false);
    assert.equal(headerSpace.props.children, undefined, 'there is no bar or transparent Close button in the header');
    assert.equal(headerSpace.props.onPress, undefined);
    const pressables = find(tree, 'Pressable');
    assert.equal(pressables.length, 1, 'only the existing artwork remains a screen-level Pressable');
    const artwork = pressables[0];
    assert.equal(artwork.props.accessibilityLabel, lyrics ? 'Show cover' : 'Lyrics');
    assert.equal(artwork.props.accessibilityActions[0].name, 'dismiss');
    assert.equal(artwork.props.accessibilityActions[0].label, 'Close');
    const calls = h.closeCalls();
    artwork.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    assert.equal(h.closeCalls(), calls);
    artwork.props.onAccessibilityAction({ nativeEvent: { actionName: 'dismiss' } });
    artwork.props.onAccessibilityEscape();
    assert.equal(h.closeCalls(), calls + 2, 'screen-reader actions retain a close entry without a new visual control');
  }
  h.transition.entryReady = false;
  const preparingArtwork = find(h.render(), 'Pressable')[0];
  const calls = h.closeCalls();
  preparingArtwork.props.onAccessibilityAction({ nativeEvent: { actionName: 'dismiss' } });
  preparingArtwork.props.onAccessibilityEscape();
  assert.equal(h.closeCalls(), calls, 'preparing entry cannot receive an accessibility close');
});

test('removed mode controls remain available through the existing More menu in cover and lyric modes', () => {
  const h = harness();
  for (const lyrics of [false, true]) {
    if (lyrics) find(h.render(), 'Controls')[0].props.onLyrics();
    const tree = h.render();
    const controls = find(tree, 'Controls')[0];
    for (const prop of ['shuffle', 'repeat', 'onShuffle', 'onRepeat']) {
      assert.equal(prop in controls.props, false, `${prop} is not retained on hidden transport controls`);
    }
    const menus = find(tree, 'More');
    menus[lyrics ? 0 : menus.length - 1].props.onPress();
    const options = h.menuCalls.at(-1)![2];
    assert.equal(options.playbackModes, true);
    assert.equal(options.presentation, 'card');
  }
  assert.equal(h.menuCalls.length, 2);
});
