import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as ampp from '../src/lib/amppDock';
import * as dockRules from '../src/lib/liquidDock';
import * as buttonRules from '../src/lib/glassButtonMotion';
import * as swipeRules from '../src/lib/miniPlayerSwipe';
import { nativeMeasureBoundary } from './helpers/nativeMeasureBoundary';

type Element = { type: unknown; props: Record<string, any> };
type Ref = (() => any) & { wrapper: object | null };
const jsx = (type: unknown, props: object) => ({ type, props });
const mutable = (value: any) => ({ value, get() { return this.value; }, set(next: any) { this.value = next; } });

function harness(options: { amPlus?: boolean; rtl?: boolean; progress?: number; compact?: boolean; hasSearch?: boolean } = {}) {
  let cursor = 0;
  const slots: any[] = [], refs: Ref[] = [];
  const reactions: (() => void)[] = [], effects: (() => void)[] = [];
  const slot = <T,>(create: () => T): T => slots[cursor++] ??= create();
  const nativeMeasure = nativeMeasureBoundary((wrapper) => wrapper.measurement);
  const progress = mutable(options.progress ?? 0);
  const dock = { amPlus: options.amPlus ?? false, enabled: true, compact: options.compact ?? false,
    hasSearch: options.hasSearch ?? false, progress };
  const song = { id: 'one', title: 'Title', artist: 'Artist' };
  const player = { song, index: 0, isPlaying: false, isBuffering: false, toggle() {}, next() {}, previous() {}, reset() {} };
  const settings = { playerPresentation: 'amll', miniPlayerButtons: 'none', marqueeTitles: false };
  const pan: Record<string, any> = {};
  const gestures: Record<string, (...args: any[]) => void> = {};
  for (const name of ['minDistance', 'onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) pan[name] = (callback: unknown) => {
    if (typeof callback === 'function') gestures[name] = callback as (...args: any[]) => void;
    return pan;
  };
  const dependencies: Record<string, any> = {
    react: { useCallback: (callback: unknown) => callback,
      useRef: (value: unknown) => slot(() => ({ current: value })),
      useState: (initial: unknown) => { const state = slot(() => ({ value: initial }));
        return [state.value, (next: unknown) => { state.value = next; }]; },
      useLayoutEffect: (callback: () => void) => { effects.push(callback); } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'Spinner', I18nManager: { isRTL: options.rtl ?? false }, Pressable: 'Pressable', Text: 'Text', View: 'View' },
    'react-native-gesture-handler': { Gesture: { Pan: () => pan }, GestureDetector: 'GestureDetector' },
    'react-native-reanimated': { __esModule: true,
      default: { View: 'AnimatedView', createAnimatedComponent: (value: unknown) => value },
      makeMutable: mutable,
      useAnimatedRef: () => slot(() => {
        const ref = Object.assign(() => ref.wrapper, { wrapper: null as object | null }); refs.push(ref); return ref;
      }),
      measure: nativeMeasure.measure, useSharedValue: (value: unknown) => slot(() => mutable(value)),
      useDerivedValue: (read: () => unknown) => ({ get: read }),
      useAnimatedStyle: (read: () => unknown) => ({ read }),
      useAnimatedReaction: (prepare: () => unknown, react: (next: unknown) => void) => { reactions.push(() => react(prepare())); },
      withTiming: (target: unknown) => target, withSpring: (target: unknown) => target, cancelAnimation() {},
      interpolate: (value: number, [low, high]: number[], [start, end]: number[]) => start + (end - start) * (value - low) / (high - low),
      Extrapolation: { CLAMP: 'clamp' } },
    'react-native-worklets': { scheduleOnUI: (callback: () => void) => callback(),
      scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => callback(...args) },
    'expo-router': { router: {} },
    '@/api/data': { COVER: { thumb: 'thumb' }, songCoverUrl: () => 'cover.jpg' },
    '@/hooks/useFavoriteIds': { useFavoriteIds: () => null },
    '@/hooks/useLiquidDock': { useLiquidDock: () => dock, COMPACT_DOCK_GAP: 8, COMPACT_DOCK_SIZE: 48 },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400, height: 800 }) },
    '@/i18n': { useT: () => (text: string) => text },
    '@/lib/haptics': {}, '@/lib/liquidDock': dockRules, '@/lib/amppDock': ampp,
    '@/lib/glassButtonMotion': buttonRules, '@/lib/miniPlayerSwipe': swipeRules,
    '@/lib/pushOnce': { pushOnce() {} },
    '@/store/player': { currentSong: (state: typeof player) => state.song,
      usePlayerStore: (select: (state: typeof player) => unknown) => select(player), useLiveInfo: () => null },
    '@/store/settings': { useSettings: (select: (state: typeof settings) => unknown) => select(settings) },
    '@/store/toast': {},
    '@/theme': { BOTTOM_BAR_HORIZONTAL_MARGIN: 16, BOTTOM_BAR_MAX_WIDTH: 600, MINI_PLAYER_HEIGHT: 48, TAB_BAR_HEIGHT: 56,
      fontSize: { sm: 14 }, spacing: { sm: 8, lg: 16 }, useThemeMode: () => 'dark', themed: (create: (colors: object) => unknown) => create({}) },
    '@/theme/motion': { motion: { easing: { move: 'move' }, duration: { move: 220 }, reduceMotion: { decorative: 'system' } } },
    './BarBlur': { useBarBlur: () => false }, './glass': { FloatingGlassBackdrop: 'Glass' },
  };
  for (const name of ['Cover', 'FavoriteButton', 'MarqueeText']) dependencies[`./${name}`] = { [name]: name };
  dependencies['@/components/Icon'] = { __esModule: true, default: 'Icon' };
  const load = (source: string) => {
    const output = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const exported: Record<string, any> = {};
    runInNewContext(output, { exports: exported, require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected mini artwork dependency ${name}`);
      return dependencies[name];
    } });
    return exported;
  };
  const bus = load(readFileSync(new URL('../src/lib/playerReveal.ts', import.meta.url), 'utf8'));
  dependencies['@/lib/playerReveal'] = bus;
  const source = readFileSync(new URL('../src/components/MiniPlayer.tsx', import.meta.url), 'utf8');
  const component = load(source);
  const tree: Element = component.MiniPlayer();
  while (effects.length) effects.shift()!();
  return { refs, bus, nativeCalls: nativeMeasure.calls, tree, gestures, progress,
    flushUI() { for (const reaction of reactions) reaction(); },
    attach(index: number, measurement: object) { refs[index].wrapper = { measurement: { x: 0, y: 0, ...measurement } }; } };
}

test('installed native measure still reproduces the null ShadowNode crash guarded by the real callers', () => {
  const boundary = nativeMeasureBoundary(() => null);
  assert.throws(() => boundary.measure(() => null), /native measure requires a ShadowNode object/);
});

test('the actual MiniPlayer first UI reaction skips null refs and its real onLayout measures after both attach', () => {
  const h = harness();
  assert.doesNotThrow(() => h.flushUI());
  assert.equal(h.nativeCalls.length, 0);
  assert.equal(h.bus.miniArtworkMetrics.get(), null);
  h.attach(0, { pageX: 16, pageY: 700, width: 368, height: 48 });
  h.flushUI(); assert.equal(h.nativeCalls.length, 0, 'a missing artwork ref must prevent both native calls');
  h.attach(1, { pageX: 32, pageY: 709, width: 30, height: 30 });
  h.tree.props.onLayout();
  assert.equal(h.nativeCalls.length, 2);
  const metrics = JSON.parse(JSON.stringify(h.bus.miniArtworkMetrics.get()));
  assert.deepEqual(metrics, { viewportWidth: 400, viewportHeight: 800,
    miniPlayer: { x: 16, y: 700, width: 368, height: 48, cornerRadius: 24 },
    miniArtwork: { x: 32, y: 709, width: 30, height: 30, cornerRadius: 4 },
    restingArtwork: { x: 32, y: 709, width: 30, height: 30, cornerRadius: 4 } });
  h.refs[0].wrapper = null;
  h.tree.props.onLayout();
  assert.equal(h.nativeCalls.length, 2, 'a detached frame cannot pass null to native measure');
});

test('actual AM++ press and horizontal swipe keep painted entry measurements separate from the resting return endpoint', () => {
  const h = harness({ amPlus: true });
  h.attach(0, { pageX: 16, pageY: 700, width: 368, height: 43 });
  const rest = { x: 32, y: 706.5, width: 30, height: 30, cornerRadius: 4 };
  h.attach(1, { pageX: rest.x, pageY: rest.y, width: rest.width, height: rest.height });
  h.tree.props.onLayout();
  assert.deepEqual(JSON.parse(JSON.stringify(h.bus.miniArtworkMetrics.get().restingArtwork)), rest);

  // Execute the production pan callbacks, then supply native measure's painted
  // coordinates including that ancestor scale and the cover's horizontal swipe.
  h.gestures.onBegin({ x: 100, y: 20 });
  const card = h.tree.props.children.props.children as Element;
  const cardStyle = card.props.style.find((style: any) => style?.read).read();
  const scaleX = cardStyle.transform.find((item: any) => 'scaleX' in item).scaleX;
  assert.equal(scaleX, 1 + 4 / 43, 'the real press spring still scales the painted mini');
  h.gestures.onStart({ translationX: 70, translationY: 0 });
  h.gestures.onUpdate({ x: 170, y: 20, translationX: 70, translationY: 0 });
  const painted = { x: 89.62, y: 705.1, width: 30 * scaleX, height: 30 * scaleX, cornerRadius: 4 };
  h.attach(1, { pageX: painted.x, pageY: painted.y, width: painted.width, height: painted.height });
  h.tree.props.onLayout();
  const metrics = JSON.parse(JSON.stringify(h.bus.miniArtworkMetrics.get()));
  assert.deepEqual(metrics.miniArtwork, painted, 'opening must start at the actual pressed/swiped artwork');
  assert.deepEqual(metrics.restingArtwork, rest, 'closing must not inherit the press scale or swipe translation');
  assert.deepEqual(metrics.miniPlayer, { x: 16, y: 700, width: 368, height: 43, cornerRadius: 21.5 });
});

test('resting artwork follows physical compact travel and logical cover placement in LTR and RTL', () => {
  for (const rtl of [false, true]) {
    for (const hasSearch of [false, true]) {
      for (const p of [0, .4, 1]) {
        const h = harness({ rtl, hasSearch, compact: true, progress: p });
        h.attach(0, { pageX: 16, pageY: 700, width: 368, height: 48 });
        // This intentionally stale, deformed native picture cannot define the
        // resting rectangle, including while compact layout is interpolating.
        h.attach(1, { pageX: 150, pageY: 720, width: 32.79, height: 32.79 });
        h.tree.props.onLayout();
        const metrics = JSON.parse(JSON.stringify(h.bus.miniArtworkMetrics.get()));
        const compactLeading = rtl && !hasSearch ? 0 : 56;
        const logicalStart = 16 + (compactLeading + 10 - 16) * p;
        const expectedX = 16 + (rtl ? 368 - logicalStart - 30 : logicalStart);
        assert.deepEqual(metrics.restingArtwork,
          { x: expectedX, y: 709, width: 30, height: 30, cornerRadius: 4 },
          `resting coordinates must resolve logical start once (rtl=${rtl}, search=${hasSearch}, p=${p})`);
        assert.equal(metrics.miniPlayer.x, 16 + 56 * p);
        assert.equal(metrics.miniPlayer.width, 368 - (hasSearch ? 112 : 56) * p);
      }
    }
  }
});
