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
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function pathToRef(node: unknown, ref: Ref): Element[] | null {
  if (Array.isArray(node)) {
    for (const child of node) { const path = pathToRef(child, ref); if (path) return path; }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const element = node as Element;
  if (element.props.ref === ref) return [element];
  const child = pathToRef(element.props.children, ref);
  return child ? [element, ...child] : null;
}
const staticStyle = (node: Element): Record<string, any> => Object.assign({},
  ...(Array.isArray(node.props.style) ? node.props.style : [node.props.style]).filter((style: any) => style && !style.read));

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
      useEffect() {}, useLayoutEffect: (callback: () => void) => { effects.push(callback); } },
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

test('the actual MiniPlayer skips unattached refs, then its real ghost onLayout publishes native-rounded resting coordinates', () => {
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
    miniArtwork: { x: 32, y: 709, width: 30, height: 30, cornerRadius: 4 } });
  assert.equal(h.refs.length, 3);
  const rest = { x: 32.2666666667, y: 709.0666666667, width: 29.8666666667, height: 30.1333333333, cornerRadius: 4 };
  h.attach(2, { pageX: rest.x, pageY: rest.y, width: rest.width, height: rest.height });
  pathToRef(h.tree, h.refs[2])!.at(-1)!.props.onLayout();
  assert.equal(h.nativeCalls.length, 5);
  assert.deepEqual(plain(h.bus.miniArtworkMetrics.get().restingArtwork), rest,
    'the measured leaf, including physical pixel rounding, must replace nominal 30dp math');
  h.refs[0].wrapper = null;
  h.tree.props.onLayout();
  assert.equal(h.nativeCalls.length, 5, 'a detached frame cannot pass null to native measure');
});

test('actual AM++ press and horizontal swipe keep painted entry measurements separate from the resting return endpoint', () => {
  const h = harness({ amPlus: true });
  h.attach(0, { pageX: 16, pageY: 700, width: 368, height: 43 });
  const rest = { x: 32.2666666667, y: 706.4, width: 29.8666666667, height: 30.1333333333, cornerRadius: 4 };
  h.attach(1, { pageX: rest.x, pageY: rest.y, width: rest.width, height: rest.height });
  h.attach(2, { pageX: rest.x, pageY: rest.y, width: rest.width, height: rest.height });
  h.tree.props.onLayout();
  assert.deepEqual(JSON.parse(JSON.stringify(h.bus.miniArtworkMetrics.get().restingArtwork)), rest);

  // Execute the production pan callbacks, then supply native measure's painted
  // coordinates including that ancestor scale and the cover's horizontal swipe.
  h.gestures.onBegin({ x: 100, y: 20 });
  const card = pathToRef(h.tree, h.refs[1])![2];
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

test('the resting ghost mirrors the real image Yoga hierarchy and compact travel in LTR and RTL without copying press or swipe motion', () => {
  for (const rtl of [false, true]) {
    for (const hasSearch of [false, true]) {
      for (const p of [0, .4, 1]) {
        const h = harness({ rtl, hasSearch, compact: true, progress: p });
        h.attach(0, { pageX: 16, pageY: 700, width: 368, height: 48 });
        // This intentionally stale, deformed native picture cannot define the
        // resting rectangle, including while compact layout is interpolating.
        h.attach(1, { pageX: 150, pageY: 720, width: 32.79, height: 32.79 });
        const rest = { x: rtl ? 315.4666666667 : 77.0666666667, y: 709.0666666667,
          width: 30.1333333333, height: 29.8666666667, cornerRadius: 4 };
        h.attach(2, { pageX: rest.x, pageY: rest.y, width: rest.width, height: rest.height });
        h.tree.props.onLayout();
        const metrics = JSON.parse(JSON.stringify(h.bus.miniArtworkMetrics.get()));
        assert.deepEqual(metrics.restingArtwork, rest,
          `resting coordinates come from native layout (rtl=${rtl}, search=${hasSearch}, p=${p})`);
        assert.equal(metrics.miniPlayer.x, 16 + 56 * p);
        assert.equal(metrics.miniPlayer.width, 368 - (hasSearch ? 112 : 56) * p);

        const actual = pathToRef(h.tree, h.refs[1])!;
        const ghost = pathToRef(h.tree, h.refs[2])!;
        // GestureDetector contributes no Yoga box. Every following real layout
        // box has a matching untransformed ghost box, avoiding a different
        // sequence of per-parent physical-pixel rounding.
        const realBoxes = actual.filter((node) => node.type !== 'GestureDetector');
        assert.equal(ghost.length, realBoxes.length);
        for (let index = 1; index < ghost.length - 1; index++) {
          const realStyle = staticStyle(realBoxes[index]), ghostStyle = staticStyle(ghost[index]);
          for (const key of index === 1 ? ['width', 'height'] : ['start', 'left', 'right', 'top', 'bottom', 'width', 'height']) {
            assert.equal(ghostStyle[key], realStyle[key], `layout box ${index} ${key} must match`);
          }
        }
        assert.equal(staticStyle(ghost[1]).position, 'absolute');
        assert.equal(staticStyle(ghost[1]).top, 0);
        assert.equal(ghost[1].props.pointerEvents, 'none');
        assert.equal(ghost[1].props.importantForAccessibility, 'no-hide-descendants');
        assert.deepEqual(plain(staticStyle(ghost.at(-1)!)), { width: 30, height: 30 });
        const realMotion = realBoxes.at(-2)!.props.style.at(-1);
        assert.equal(ghost.at(-2)!.props.style.at(-1), realMotion, 'both artwork frames share the actual logical cover travel worklet');
        assert.equal(ghost[1].props.style.some((style: any) => style?.read), false, 'card press deformation is outside the measured ghost');
        assert.equal(ghost.at(-1)!.props.style.read, undefined, 'cover swipe motion is outside the measured ghost');
      }
    }
  }
});

test('missing, detached and zero-size resting leaves retain actual entry geometry without sending null to native measure', () => {
  const h = harness();
  h.attach(0, { pageX: 16, pageY: 700, width: 368, height: 48 });
  h.attach(1, { pageX: 31, pageY: 708, width: 32.79, height: 32.79 });
  for (const zero of [false, true]) {
    if (zero) h.attach(2, { pageX: 0, pageY: 0, width: 0, height: 0 });
    assert.doesNotThrow(() => h.tree.props.onLayout());
    const metrics = h.bus.miniArtworkMetrics.get();
    assert.equal(metrics.restingArtwork, undefined);
    assert.equal(metrics.miniArtwork.width, 32.79);
  }
  h.refs[2].wrapper = null;
  assert.doesNotThrow(() => h.tree.props.onLayout());
  assert.equal(h.bus.miniArtworkMetrics.get().restingArtwork, undefined);
});
