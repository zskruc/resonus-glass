import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as ampp from '../src/lib/amppDock';
import * as dockRules from '../src/lib/liquidDock';
import * as buttonRules from '../src/lib/glassButtonMotion';
import * as swipeRules from '../src/lib/miniPlayerSwipe';

type Element = { type: unknown; props: Record<string, any> };
const jsx = (type: unknown, props: object): Element => ({ type, props });
const mutable = (value: any) => ({ value, get() { return this.value; }, set(next: any) { this.value = next; } });

// Actual MiniPlayer branching and props; Marquee's internal native identities,
// measurement state and focus/foreground clocks are tested in marqueeLifecycle.
function harness() {
  const appListeners = new Set<(state: string) => void>();
  const animationReaders: (() => any)[] = [];
  const dock = { amPlus: false, enabled: true, compact: false, hasSearch: false, progress: mutable(0) };
  const song = { id: 'one', title: 'A title longer than the mini player', artist: 'Artist' };
  const player = { song, index: 0, isPlaying: false, isBuffering: false, toggle() {}, next() {}, previous() {}, reset() {} };
  const settings = { playerPresentation: 'amll', miniPlayerButtons: 'none', marqueeTitles: true };
  const pan: Record<string, any> = {};
  const handlers: Record<string, (...args: any[]) => void> = {};
  for (const key of ['minDistance', 'onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) pan[key] = (callback: any) => {
    if (typeof callback === 'function') handlers[key] = callback;
    return pan;
  };
  const dependencies: Record<string, any> = {
    react: { useCallback: (callback: unknown) => callback, useRef: (value: unknown) => ({ current: value }),
      useState: (value: unknown) => [value, () => {}], useLayoutEffect() {}, useEffect(create: () => void) { create(); } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { AppState: { addEventListener: (_event: string, callback: (state: string) => void) => {
      appListeners.add(callback); return { remove: () => appListeners.delete(callback) };
    } }, ActivityIndicator: 'Spinner', I18nManager: { isRTL: false }, Pressable: 'Pressable', Text: 'Text', View: 'View' },
    'react-native-gesture-handler': { Gesture: { Pan: () => pan }, GestureDetector: 'GestureDetector' },
    'react-native-reanimated': { __esModule: true,
      default: { View: 'AnimatedView', createAnimatedComponent: (value: unknown) => value },
      useSharedValue: mutable, useAnimatedRef: () => () => null, useDerivedValue: (get: () => unknown) => ({ get }),
      useAnimatedStyle: (read: () => unknown) => { animationReaders.push(read); return { read }; }, useAnimatedReaction() {}, cancelAnimation() {},
      withTiming: (value: unknown) => value, withSpring: (value: unknown) => value,
      interpolate: (value: number, [low, high]: number[], [start, end]: number[]) => start + (end - start) * (value - low) / (high - low),
      Extrapolation: { CLAMP: 'clamp' } },
    'react-native-worklets': { scheduleOnUI: (callback: () => void) => callback(), scheduleOnRN() {} },
    'expo-router': { router: {} },
    '@/api/data': { COVER: { thumb: 'thumb' }, songCoverUrl: () => 'cover.jpg' },
    '@/hooks/useFavoriteIds': { useFavoriteIds: () => null },
    '@/hooks/useLiquidDock': { useLiquidDock: () => dock, COMPACT_DOCK_GAP: 8, COMPACT_DOCK_SIZE: 48 },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400, height: 800 }) },
    '@/i18n': { useT: () => (text: string) => text },
    '@/lib/haptics': {}, '@/lib/liquidDock': dockRules, '@/lib/amppDock': ampp,
    '@/lib/glassButtonMotion': buttonRules, '@/lib/miniPlayerSwipe': swipeRules,
    '@/lib/playerReveal': { miniArtworkMetrics: mutable(null), playerArtworkFlight: mutable(null),
      playerSurfaceOwner: mutable(0), revealOffset: mutable(-1) },
    '@/lib/pushOnce': {}, '@/store/toast': {},
    '@/store/player': { currentSong: (state: typeof player) => state.song,
      usePlayerStore: (select: (state: typeof player) => unknown) => select(player), useLiveInfo: () => null },
    '@/store/settings': { useSettings: (select: (state: typeof settings) => unknown) => select(settings) },
    '@/theme': { BOTTOM_BAR_HORIZONTAL_MARGIN: 16, BOTTOM_BAR_MAX_WIDTH: 600, MINI_PLAYER_HEIGHT: 48, TAB_BAR_HEIGHT: 56,
      fontSize: { sm: 14 }, spacing: { sm: 8, lg: 16 }, useThemeMode: () => 'dark', themed: (create: (colors: object) => unknown) => create({}) },
    '@/theme/motion': { motion: { easing: { move: 'move' }, duration: { move: 220 }, reduceMotion: { decorative: 'system' } } },
    './BarBlur': { useBarBlur: () => false }, './glass': { FloatingGlassBackdrop: 'Glass' },
    './Cover': { Cover: 'Cover' }, './FavoriteButton': { FavoriteButton: 'FavoriteButton' },
    './MarqueeText': { MarqueeText: 'MarqueeText' }, '@/components/Icon': { __esModule: true, default: 'Icon' },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/components/MiniPlayer.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected mini title import ${id}`); return dependencies[id];
  } });
  const find = (node: unknown, type: string, path = 'root'): { node: Element; path: string }[] => {
    if (Array.isArray(node)) return node.flatMap((child, index) => find(child, type, `${path}.${index}`));
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Element;
    return [...(element.type === type ? [{ node: element, path }] : []), ...find(element.props.children, type, `${path}.children`)];
  };
  return { settings, song, dock, find,
    handlers, app: (state: string) => appListeners.forEach((listener) => listener(state)),
    cardMotion: () => animationReaders.map((read) => read()).find((style) => style.opacity !== undefined
      && style.transform?.length === 1 && style.transform[0].translateY !== undefined),
    render(active = true) { return exports.MiniPlayer({ active }); },
  };
}

test('an interrupted mini drag cannot leave its card offscreen or let a late gesture completion dismiss it', () => {
  const h = harness();
  h.render();
  h.handlers.onStart();
  h.handlers.onUpdate({ translationX: 0, translationY: 60 });
  assert.equal(h.cardMotion().transform[0].translateY, 60);
  h.app('background');
  assert.equal(h.cardMotion().transform[0].translateY, 0);
  assert.equal(h.cardMotion().opacity, 1);
  h.app('active');
  h.handlers.onEnd({ translationX: 0, translationY: 200, velocityY: 1000 }, true);
  assert.equal(h.cardMotion().transform[0].translateY, 0, 'old pointer must not move the resumed card offscreen');
  assert.equal(h.dock.compact, false, 'transient cleanup must not choose another dock shape');
});

test('the real MiniPlayer retains the same marquee slot across cover and return, changing only its activity', () => {
  const h = harness();
  const original = h.find(h.render(), 'MarqueeText')[0];
  assert.equal(original.node.props.enabled, true);
  for (const active of [false, true, false, true]) {
    const tree = h.render(active), titles = h.find(tree, 'MarqueeText');
    assert.equal(titles.length, 1);
    assert.equal(titles[0].path, original.path, 'route visibility cannot swap the title component type or slot');
    assert.equal(titles[0].node.props.active, active);
    assert.equal(titles[0].node.props.enabled, true, 'visibility is never passed through the layout/overflow switch');
    assert.equal(h.find(tree, 'Text').length, 0, 'coverage cannot insert the plain-Text replacement');
  }
  h.song.title = 'The next song';
  assert.equal(h.find(h.render(), 'MarqueeText')[0].node.props.text, 'The next song');
});

test('only real compact endpoints or the user setting change the mini title layout policy', () => {
  const h = harness(); h.dock.compact = true; h.dock.progress.set(1);
  const compact = h.find(h.render(false), 'MarqueeText')[0];
  assert.equal(compact.node.props.enabled, false, 'compact endpoint can intentionally use the fitted text branch');
  assert.equal(compact.node.props.active, false);
  h.settings.marqueeTitles = false;
  const tree = h.render();
  assert.equal(h.find(tree, 'MarqueeText').length, 0);
  assert.equal(h.find(tree, 'Text').length, 1, 'the explicit setting still selects ordinary ellipsized text');
});

test('the real MiniPlayer only offers a playlist hold on its visible expanded favorite control', () => {
  const h = harness(); h.settings.miniPlayerButtons = 'favorite';
  const favorite = (active = true) => h.find(h.render(active), 'FavoriteButton')[0].node;
  assert.equal(favorite().props.playlistSong, h.song);
  assert.equal(favorite(false).props.playlistSong, undefined, 'covered mini controls must drop the hold capability');
  h.dock.compact = true; h.dock.progress.set(1);
  assert.equal(favorite().props.playlistSong, undefined, 'the hidden folded favorite cannot retain a hold');
});
