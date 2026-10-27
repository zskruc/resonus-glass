import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as tabOrigin from '../src/lib/tabOrigin';
import * as tabNavigation from '../src/lib/tabNavigation';
import * as dockMath from '../src/lib/liquidDock';
import * as amppDock from '../src/lib/amppDock';

type Element = { type: unknown; props: Record<string, any> };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const shared = <T,>(initial: T) => ({ value: initial, get() { return this.value; }, set(value: T) { this.value = value; } });
const source = ts.transpileModule(readFileSync(new URL('../src/components/GlobalTabBar.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const retainedProgressSource = ts.transpileModule(readFileSync(new URL('../src/hooks/useRetainedDockProgress.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

class NativeGesture {
  options: Record<string, unknown> = {};
  callbacks: Record<string, (...args: any[]) => void> = {};
  readonly kind: string;
  constructor(kind: string) { this.kind = kind; }
  enabled(value: boolean) { this.options.enabled = value; return this; }
  activeOffsetX(value: unknown) { this.options.activeOffsetX = value; return this; }
  failOffsetY(value: unknown) { this.options.failOffsetY = value; return this; }
  maxDeltaX(value: number) { this.options.maxDeltaX = value; return this; }
  maxDeltaY(value: number) { this.options.maxDeltaY = value; return this; }
  maxDuration(value: number) { this.options.maxDuration = value; return this; }
  onBegin(value: (...args: any[]) => void) { this.callbacks.onBegin = value; return this; }
  onStart(value: (...args: any[]) => void) { this.callbacks.onStart = value; return this; }
  onUpdate(value: (...args: any[]) => void) { this.callbacks.onUpdate = value; return this; }
  onEnd(value: (...args: any[]) => void) { this.callbacks.onEnd = value; return this; }
  onFinalize(value: (...args: any[]) => void) { this.callbacks.onFinalize = value; return this; }
}

/** Run the actual bar, including its UI-to-JS interaction gates and event handlers. */
function harness({ amPlus = true, compact = false, uiCompact = compact, progress = .08, ready = true, deferRN = false }: {
  amPlus?: boolean; compact?: boolean; uiCompact?: boolean; progress?: number; ready?: boolean; deferRN?: boolean;
} = {}) {
  let cursor = 0;
  const slots: any[] = [];
  const dispatched: unknown[] = [];
  const navigation: string[] = [];
  const reselected: string[] = [];
  const rnQueue: (() => void)[] = [];
  const effects: (() => void)[] = [];
  const cleanups = new Set<() => void>();
  const reactions = new Set<{ prepare: () => unknown; react: (value: unknown, previous: unknown) => void; previous: unknown }>();
  const pressModes: boolean[] = [];
  const nativeMotion: number[][] = [];
  const timingTargets: unknown[] = [];
  const underlayState = { reveal: false, returning: false };
  let segments = ['(tabs)', 'index'];
  let shown = true;
  let expansions = 0;
  let pressCalls = 0;
  let releaseCalls = 0;
  let focusRequests = 0;
  const dockProgress = shared(progress);
  const dockCompact = shared(uiCompact);
  const slot = <T,>(create: () => T): T => slots[cursor++] ??= create();
  const bottomTabs = ['index', 'explore', 'library', 'search'].map((key) => ({ key, enabled: true }));
  const changed = (a: unknown[] | undefined, b: unknown[] | undefined) => !a || !b || a.length !== b.length
    || a.some((value, index) => !Object.is(value, b[index]));
  function effect(callback: () => void | (() => void), deps?: unknown[]) {
    const saved = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as (() => void) | undefined }));
    if (changed(saved.deps, deps)) {
      saved.deps = deps;
      effects.push(() => {
        if (saved.cleanup) { cleanups.delete(saved.cleanup); saved.cleanup(); }
        saved.cleanup = callback() || undefined;
        if (saved.cleanup) cleanups.add(saved.cleanup);
      });
    }
  }
  const tabs = { type: 'tab', key: 'main-tabs', index: 0,
    routes: [{ name: 'index' }, { name: 'explore' }, { name: 'library' }, { name: 'search' }] };
  const dependencies: Record<string, any> = {
    react: {
      useRef: <T,>(value: T) => slot(() => ({ current: value })),
      useState: <T,>(initial: T | (() => T)) => {
        const state = slot(() => ({ value: typeof initial === 'function' ? (initial as () => T)() : initial }));
        return [state.value, (value: T) => { state.value = value; }];
      },
      useCallback: (callback: unknown, deps: unknown[]) => {
        const saved = slot(() => ({ deps: undefined as unknown[] | undefined, callback }));
        if (changed(saved.deps, deps)) { saved.deps = deps; saved.callback = callback; }
        return saved.callback;
      }, useEffect: effect, useLayoutEffect: effect,
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    'expo-router': {
      useSegments: () => segments,
      useRouter: () => ({ canDismiss: () => false, navigate: (href: string) => navigation.push(href) }),
      useNavigationContainerRef: () => ({ isReady: () => ready,
        getRootState: () => ({ type: 'stack', index: 0, routes: [{ name: '(tabs)', state: tabs }] }),
        dispatch: (action: unknown) => dispatched.push(action) }),
    },
    'react-native': { I18nManager: { isRTL: false }, Pressable: 'Pressable', Text: 'Text', View: 'View',
      StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } },
    'react-native-gesture-handler': { Gesture: { Pan: () => new NativeGesture('pan'), Tap: () => new NativeGesture('tap'),
      Exclusive: (...gestures: NativeGesture[]) => ({ kind: 'exclusive', gestures }) }, GestureDetector: 'GestureDetector' },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: <T,>(value: T) => slot(() => shared(value)),
      useDerivedValue: (compute: () => unknown) => ({ get: compute, get value() { return compute(); } }),
      useAnimatedStyle: (compute: () => unknown) => compute(),
      useAnimatedReaction: (prepare: () => unknown, react: (value: unknown, previous: unknown) => void) => {
        const saved = slot(() => { const value = { prepare, react, previous: null as unknown }; reactions.add(value); return value; });
        saved.prepare = prepare; saved.react = react;
      },
      useReducedMotion: () => false, withTiming: (value: unknown) => { timingTargets.push(value); return value; },
      withSpring: (value: unknown) => value },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'react-native-worklets': { scheduleOnRN: (callback: (...args: any[]) => unknown, ...args: unknown[]) => {
      if (deferRN) rnQueue.push(() => callback(...args)); else callback(...args);
    }, scheduleOnUI: (callback: () => void) => callback() },
    '@/components/BarBlur': { useBarBlur: () => true },
    '@/components/glass': { FloatingGlassBackdrop: 'Backdrop' },
    '../../modules/liquid-glass': { isLiquidGlassAvailable: true, LiquidGlassTabsView: 'NativeTabs',
      updateNativeTabsMotion: (...values: number[]) => nativeMotion.push(values) },
    '@/hooks/useTabBar': { useTabBarShown: () => shown, usePlayerDockUnderlay: () => underlayState },
    './PlayerDockUnderlay': { PlayerDockUnderlay: 'Underlay', usePlayerDockMaterialReady: () => underlayState.reveal },
    '@/hooks/useLiquidDock': { COMPACT_DOCK_GAP: 8, COMPACT_DOCK_SIZE: 50, useLiquidDock: () => ({
      progress: dockProgress, compact, uiCompact: dockCompact, expand() { expansions++; }, hasSearch: true,
      enabled: true, uiEnabled: shared(true), scope: 'test', uiScope: shared('test'),
      nativeInput: false, nativeInputHost: shared(0), requestNativeCompact() {},
    }) },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400 }) },
    '@/theme/motion': { motion: { duration: { exit: 150 }, reduceMotion: {} } },
    '@/i18n': { useT: () => (value: string) => value },
    '@/lib/tabOrigin': { ...tabOrigin, reselectTab: (tab: string) => reselected.push(tab),
      requestSearchFocus: () => { focusRequests++; } },
    '@/lib/tabNavigation': tabNavigation,
    '@/hooks/useLiquidTabsPress': { useLiquidTabsPress: () => {
      const callbacks = slot(() => ({ press(deform = true) { pressCalls++; pressModes.push(deform); }, release() { releaseCalls++; } }));
      return { ...callbacks, releasePending: slot(() => shared(false)), releaseFrameReady: slot(() => shared(0)) };
    } },
    '@/lib/liquidDock': dockMath, '@/lib/amppDock': amppDock,
    '@/store/settings': { useSettings: (select: (state: unknown) => unknown) => select({
      bottomTabs, showTabLabels: true }) },
    '@/store/glassTuning': { useGlassTuning: (select: (state: unknown) => unknown) => select({
      mode: amPlus ? 'amPlus' : 'kyantDefault', overrides: {}, amPlusOverrides: {},
    }), resolveGlassProfile: () => ({}) },
    '@/lib/glassMaterialTuning': { glassMaterialTuningMask: () => 0 },
    '@/theme': { useTheme: () => ({ accent: '#1DB954', text: '#FFFFFF', surface: '#1E2026' }),
      useThemeMode: () => 'dark', BOTTOM_BAR_HORIZONTAL_MARGIN: 16, BOTTOM_BAR_MAX_WIDTH: 540,
      TAB_BAR_BOTTOM_GAP: 16, TAB_BAR_HEIGHT: 64 },
  };
  const retainedProgress: Record<string, unknown> = {};
  runInNewContext(retainedProgressSource, { exports: retainedProgress, require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected retained-progress import ${id}`);
    return dependencies[id];
  } });
  dependencies['@/hooks/useRetainedDockProgress'] = retainedProgress;
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected tab bar import ${id}`);
    return dependencies[id];
  } });
  function ui() {
    for (const reaction of reactions) {
      const value = reaction.prepare(); reaction.react(value, reaction.previous); reaction.previous = value;
    }
  }
  let tree: Element;
  function render(route = segments) {
    segments = route; cursor = 0; tree = exports.GlobalTabBar() as Element;
    while (effects.length) effects.shift()!();
    ui(); return tree;
  }
  render();
  while (rnQueue.length) rnQueue.shift()!();
  render();
  function findAll(node: unknown, predicate: (node: Element) => boolean): Element[] {
    if (Array.isArray(node)) return node.flatMap((child) => findAll(child, predicate));
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Element;
    return [...(predicate(element) ? [element] : []), ...findAll(element.props.children, predicate)];
  }
  const tab = (label: string) => findAll(tree, (node) => typeof node.type === 'function'
    && node.props.accessibilityRole === 'tab' && node.props.accessibilityLabel === label)[0];
  const nativeTabs = () => findAll(tree, (node) => node.type === 'NativeTabs')[0];
  nativeTabs().props.onMotionHostReady({ nativeEvent: { hostId: 1 } }); ui();
  const combined = () => findAll(tree, (node) => node.type === 'GestureDetector')[0].props.gesture;
  const gestures = () => combined().gestures as NativeGesture[];
  const x = (index: number) => {
    const frame = findAll(tree, (node) => node.type === 'AnimatedView' && Array.isArray(node.props.style)
      && node.props.style.some((style: any) => style?.width > 0))[0];
    const width = frame.props.style.find((style: any) => style?.width > 0).width;
    const inset = nativeTabs().props.tabHorizontalInset;
    return inset + (index + .5) * (width - 2 * inset) / nativeTabs().props.tabsCount;
  };
  return { dispatched, navigation, reselected, pressCalls: () => pressCalls, releaseCalls: () => releaseCalls,
    expansions: () => expansions, focusRequests: () => focusRequests, render, ui, rnQueue, pressModes, nativeMotion, bottomTabs, timingTargets,
    show(value: boolean) { shown = value; render(); },
    handoff(route: string[], state: { shown: boolean; reveal: boolean; returning: boolean }) {
      shown = state.shown; underlayState.reveal = state.reveal; underlayState.returning = state.returning;
      return render(route);
    },
    unmount() { for (const cleanup of cleanups) cleanup(); cleanups.clear(); },
    pan: () => gestures()[0], tapGesture: () => gestures()[1], x,
    down() { const [pan, tap] = gestures(); if (pan.options.enabled) pan.callbacks.onBegin(); tap.callbacks.onBegin(); ui(); },
    up(index: number) {
      const [pan, tap] = gestures(); if (pan.options.enabled) pan.callbacks.onFinalize();
      tap.callbacks.onEnd({ x: x(index) }, true); tap.callbacks.onFinalize(); ui();
    },
    selection: () => nativeMotion.at(-1)?.[1],
    selectionOpacity: () => nativeMotion.at(-1)?.[7],
    tap(label: string) { tab(label).props.onPress(); },
    pointerPress(label: string) { tab(label).props.onPress({ nativeEvent: { identifier: 0 } }); },
    pressIn(label: string) {
      const item = tab(label);
      const native = (item.type as (props: unknown) => Element)(item.props);
      native.props.onPressIn({ nativeEvent: {} });
    },
    compactButton: () => findAll(tree, (node) => node.type === 'Pressable' && node.props.accessibilityRole === 'button')[0],
  };
}

describe('selected lens opacity across player handoff', () => {
  it('retains the painted Home or child-page opacity without a new fade or press pulse on reveal and return', () => {
    for (const amPlus of [false, true]) for (const origin of [['(tabs)', 'index'], ['artist', '[id]']]) {
      const h = harness({ amPlus, progress: 0 });
      h.render(origin);
      const expected = origin[0] === '(tabs)' ? 1 : .38;
      assert.equal(h.selectionOpacity(), expected);
      const timings = h.timingTargets.length, presses = h.pressCalls(), releases = h.releaseCalls();
      const selected = h.selection();
      h.handoff(['player'], { shown: false, reveal: true, returning: false });
      assert.equal(h.selectionOpacity(), expected, 'the covering player cannot replace the origin opacity with .38');
      assert.equal(h.timingTargets.length, timings, 'revealing a retained dock must not start another opacity animation');
      h.handoff(origin, { shown: true, reveal: false, returning: true });
      assert.equal(h.selectionOpacity(), expected);
      assert.equal(h.timingTargets.length, timings, 'the visible pop frame must continue the same painted target');
      assert.equal(h.selection(), selected);
      assert.equal(h.pressCalls(), presses);
      assert.equal(h.releaseCalls(), releases);
      h.handoff(['album', '[id]'], { shown: true, reveal: false, returning: false });
      assert.equal(h.selectionOpacity(), .38, 'ordinary navigation still follows its normal child-page appearance');
      assert.ok(h.timingTargets.length > timings, 'ordinary navigation retains its original opacity timing');
    }
  });
});

describe('tab activation while the dock expands', () => {
  it('dispatches a visible tab immediately while the expansion spring still has positive travel', () => {
    for (const amPlus of [false, true]) {
      for (const progress of [.08, .005, .0001]) {
        const h = harness({ amPlus, progress });
        assert.ok(amppDock.amppExpandedAlpha(progress) > .5);
        h.tap('Your library');
        assert.equal(h.dispatched.length, 1, `${amPlus ? 'AM++' : 'Kyant'} at ${progress}`);
        assert.deepEqual(JSON.parse(JSON.stringify(h.dispatched[0])), {
          type: 'JUMP_TO', target: 'main-tabs', payload: { name: 'library' },
        });
        assert.equal(h.expansions(), 0);
        assert.deepEqual(h.navigation, []);
        assert.equal(h.pressCalls(), 0, 'navigation must not depend on starting a press spring');
        assert.equal(h.releaseCalls(), 0, 'navigation must not wait for lens release');
      }
    }
  });

  it('keeps a pending collapse and the compact button as expansion-only actions', () => {
    const collapsing = harness({ compact: true, progress: .08 });
    collapsing.tap('Your library');
    assert.equal(collapsing.expansions(), 1);
    assert.equal(collapsing.dispatched.length, 0);
    const pending = harness({ compact: false, uiCompact: true, progress: .08 });
    pending.tap('Your library');
    assert.equal(pending.expansions(), 1, 'the UI collapse intent can precede its JS target commit');
    assert.equal(pending.dispatched.length, 0);
    const compact = harness({ compact: true, progress: 1 });
    compact.compactButton().props.onPress();
    assert.equal(compact.expansions(), 1);
    assert.equal(compact.dispatched.length, 0);
  });

  it('routes on activation, preserves reselects, and falls back when navigation is not ready', () => {
    const h = harness();
    h.pressIn('Your library');
    assert.equal(h.dispatched.length, 0);
    h.tap('Home');
    assert.deepEqual(h.reselected, ['index']);
    assert.equal(h.dispatched.length, 1);
    const unready = harness({ ready: false });
    unready.tap('Your library');
    assert.deepEqual(unready.navigation, ['/library']);
    assert.equal(unready.dispatched.length, 0);
  });
});

describe('UI-owned bottom tab pointer activation', () => {
  it('starts the full press at down and retargets at confirmed up while the RN queue is blocked', () => {
    const h = harness({ progress: 0, deferRN: true });
    h.down();
    assert.deepEqual(h.pressModes, [true]);
    assert.equal(h.dispatched.length, 0, 'down is visual feedback only');
    h.up(2);
    assert.equal(h.selection(), 2, 'the material moves before navigation or a route commit');
    assert.equal(h.releaseCalls(), 1, 'the failed Pan must not release before Tap chooses its destination');
    assert.equal(h.rnQueue.length, 1);
    assert.equal(h.dispatched.length, 0);
    h.pointerPress('Your library');
    assert.equal(h.dispatched.length, 0, 'the RN touch release cannot duplicate the UI Tap');
    h.rnQueue.shift()!();
    assert.equal((h.dispatched[0] as any).payload.name, 'library');
  });

  it('accepts the visible row before expansion reaches zero and keeps a compact intent expansion-only', () => {
    const h = harness({ progress: .08, deferRN: true });
    h.down(); h.up(2);
    assert.equal(h.selection(), 2);
    h.rnQueue.shift()!();
    assert.equal(h.dispatched.length, 1);
    const compact = harness({ compact: true, progress: .08, deferRN: true });
    compact.down(); compact.up(2);
    assert.equal(compact.pressCalls(), 0);
    assert.equal(compact.selection(), 0);
    compact.rnQueue.shift()!();
    assert.equal(compact.expansions(), 1);
    assert.equal(compact.dispatched.length, 0);
  });

  it('does not navigate for vertical failure or cancellation and preserves horizontal drag ownership', () => {
    const h = harness({ progress: 0, deferRN: true });
    assert.equal(h.tapGesture().options.maxDeltaX, 6);
    assert.equal(h.tapGesture().options.maxDeltaY, 8);
    h.down();
    h.pan().callbacks.onFinalize();
    h.tapGesture().callbacks.onFinalize();
    assert.equal(h.rnQueue.length, 0);
    assert.equal(h.releaseCalls(), 1);

    h.down();
    h.pan().callbacks.onStart();
    h.tapGesture().callbacks.onFinalize();
    assert.equal(h.releaseCalls(), 1, 'Tap losing to Pan cannot shrink a held drag');
    h.pan().callbacks.onUpdate({ x: h.x(2), velocityX: 0, translationX: 100 });
    h.pan().callbacks.onEnd({ x: h.x(2) }, false);
    h.pan().callbacks.onFinalize(); h.ui();
    assert.equal(h.selection(), 0, 'cancelled horizontal travel returns to the committed route');
    while (h.rnQueue.length) h.rnQueue.shift()!();
    assert.equal(h.dispatched.length, 0);

    h.down(); h.pan().callbacks.onStart();
    h.tapGesture().callbacks.onFinalize();
    h.pan().callbacks.onEnd({ x: h.x(1) }, true);
    h.pan().callbacks.onFinalize(); h.ui();
    assert.equal(h.selection(), 1);
    while (h.rnQueue.length) h.rnQueue.shift()!();
    assert.equal((h.dispatched[0] as any).payload.name, 'explore');
    assert.deepEqual(h.reselected, []);
  });

  it('keeps search focus, reselect and accessibility activation on their normal navigation paths', () => {
    const h = harness({ progress: 0, deferRN: true });
    h.down(); h.up(3); h.rnQueue.shift()!();
    assert.equal(h.focusRequests(), 1);
    assert.equal((h.dispatched[0] as any).payload.name, 'search');
    h.down(); h.up(0); h.rnQueue.shift()!();
    assert.deepEqual(h.reselected, ['index']);
    h.tap('Your library');
    assert.equal((h.dispatched.at(-1) as any).payload.name, 'library', 'identifier-free accessibility activation stays available');
  });

  it('rejects older queued selections and invalidates queued indices after a hidden or reordered dock', () => {
    const h = harness({ progress: 0, deferRN: true });
    h.down(); h.up(2); h.down(); h.up(1);
    assert.equal(h.selection(), 1);
    h.rnQueue.pop()!(); h.rnQueue.shift()!();
    assert.equal(h.dispatched.length, 1);
    assert.equal((h.dispatched[0] as any).payload.name, 'explore');
    const hidden = harness({ progress: 0, deferRN: true });
    hidden.down(); hidden.up(2); hidden.show(false);
    while (hidden.rnQueue.length) hidden.rnQueue.shift()!();
    assert.equal(hidden.dispatched.length, 0);
    const reordered = harness({ progress: 0, deferRN: true });
    reordered.down(); reordered.up(2); reordered.bottomTabs.reverse(); reordered.render();
    while (reordered.rnQueue.length) reordered.rnQueue.shift()!();
    assert.equal(reordered.dispatched.length, 0);
    const unmounted = harness({ progress: 0, deferRN: true });
    unmounted.down(); unmounted.up(2); unmounted.unmount();
    while (unmounted.rnQueue.length) unmounted.rnQueue.shift()!();
    assert.equal(unmounted.dispatched.length, 0);
  });

  it('lets the authoritative route commit correct an optimistic destination without restarting its press', () => {
    const h = harness({ progress: 0, deferRN: true });
    h.down(); h.up(2);
    assert.equal(h.selection(), 2);
    h.render(['(tabs)', 'explore']);
    assert.equal(h.selection(), 1);
    assert.equal(h.pressModes.every(Boolean), true);
    const completed = harness({ progress: 0, deferRN: true });
    completed.down(); completed.up(2);
    const presses = completed.pressCalls();
    completed.render(['(tabs)', 'library']);
    assert.equal(completed.selection(), 2);
    assert.equal(completed.pressCalls(), presses, 'the matching route commit must not create a second press pulse');
  });
});
