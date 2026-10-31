import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as tabOrigin from '../src/lib/tabOrigin';
import * as tabNavigation from '../src/lib/tabNavigation';
import * as dockMath from '../src/lib/liquidDock';
import * as amppDock from '../src/lib/amppDock';
import * as tabsPressMath from '../src/lib/liquidTabsMotion';

type Element = { type: unknown; props: Record<string, any> };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const shared = <T,>(initial: T) => ({ value: initial, get() { return this.value; }, set(value: T) { this.value = value; } });
const source = ts.transpileModule(readFileSync(new URL('../src/components/GlobalTabBar.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const retainedProgressSource = ts.transpileModule(readFileSync(new URL('../src/hooks/useRetainedDockProgress.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tabsPressSource = ts.transpileModule(readFileSync(new URL('../src/hooks/useLiquidTabsPress.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Render the actual bar and inspect the props it hands to its visible controls.
// Only hooks and native boundaries are stubbed; route/selection logic is real.
function harness({ amPlus = false, compact = false, motion = false } = {}) {
  let cursor = 0;
  const slots: any[] = [];
  let segments = ['(tabs)', 'index'];
  let theme = { accent: '#1DB954', text: '#FFFFFF', surface: '#1E2026' };
  let mode = 'dark';
  const bottomTabs = [
    { key: 'index', enabled: true }, { key: 'explore', enabled: true },
    { key: 'library', enabled: true }, { key: 'search', enabled: true },
    { key: 'options', enabled: false },
  ];
  const reselected: string[] = [];
  const navigation: string[] = [];
  let focusRequests = 0;
  const effects: (() => void)[] = [];
  const cleanups = new Set<() => void>();
  const appStateListeners = new Set<(state: string) => void>();
  const gestures: { kind: string; callbacks: Record<string, (...args: any[]) => void> }[] = [];
  const reactions: { prepare: () => any; react: (next: any, previous: any) => void; previous?: any }[] = [];
  const calls = { tabs: [] as number[][], dock: [] as number[][], restore: [] as unknown[][],
    compact: [] as unknown[][] };
  const accept = { tabs: true, dock: true };
  let pressInputs: any;
  const slot = <T,>(create: () => T): T => slots[cursor++] ??= create();
  const changed = (a?: unknown[], b?: unknown[]) => !a || !b || a.length !== b.length
    || a.some((value, index) => !Object.is(value, b[index]));
  const effect = (create: () => (() => void) | void, deps?: unknown[]) => {
    if (!motion) return;
    const saved = slot(() => ({ deps: undefined as unknown[] | undefined, close: undefined as (() => void) | undefined }));
    if (!changed(saved.deps, deps)) return;
    saved.deps = deps;
    effects.push(() => {
      if (saved.close) { cleanups.delete(saved.close); saved.close(); }
      saved.close = create() || undefined;
      if (saved.close) cleanups.add(saved.close);
    });
  };
  const react = {
    useRef: <T,>(value: T) => slot(() => ({ current: value })),
    useState: <T,>(initial: T | (() => T)) => {
      const state = slot(() => ({ value: typeof initial === 'function' ? (initial as () => T)() : initial }));
      return [state.value, (value: T) => { state.value = value; }];
    },
    useCallback: (callback: unknown, deps?: unknown[]) => {
      if (!motion) return callback;
      const saved = slot(() => ({ deps: undefined as unknown[] | undefined, callback }));
      if (changed(saved.deps, deps)) { saved.deps = deps; saved.callback = callback; }
      return saved.callback;
    },
    useLayoutEffect: effect, useEffect: effect,
  };
  const gesture = new Proxy({}, { get: () => () => gesture });
  const makeGesture = (kind: string) => {
    if (!motion) return gesture;
    const record = { kind, callbacks: {} as Record<string, (...args: any[]) => void> };
    gestures.push(record);
    const builder: any = new Proxy(record, { get(_target, key: string) {
      return (...args: any[]) => { if (key.startsWith('on')) record.callbacks[key] = args[0]; return builder; };
    } });
    return builder;
  };
  const dock = { progress: shared(compact ? 1 : 0), compact, uiCompact: shared(compact), expand() {}, hasSearch: true,
    enabled: true, uiEnabled: shared(true), scope: 'test', uiScope: shared('test'),
    nativeInput: motion, nativeInputHost: shared(0), generation: shared(7),
    notifyCompact: (...args: unknown[]) => calls.compact.push(args), requestNativeCompact() {} };
  const router = { canDismiss: () => true, dismissAll: () => navigation.push('dismiss'),
    navigate: (href: string) => navigation.push(href) };
  const dependencies: Record<string, any> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    'expo-router': { useSegments: () => segments, useRouter: () => router,
      useNavigationContainerRef: () => ({ isReady: () => false }) },
    'react-native': { I18nManager: { isRTL: false }, Pressable: 'Pressable', Text: 'Text', View: 'View',
      AppState: { addEventListener: (_name: string, callback: (state: string) => void) => {
        appStateListeners.add(callback); return { remove: () => appStateListeners.delete(callback) };
      } },
      StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } },
    'react-native-gesture-handler': { Gesture: { Pan: () => makeGesture('pan'), Tap: () => makeGesture('tap'), Exclusive: () => gesture }, GestureDetector: 'GestureDetector' },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: <T,>(value: T) => slot(() => shared(value)),
      useDerivedValue: (compute: () => unknown) => ({ get: compute, get value() { return compute(); } }),
      useAnimatedStyle: (compute: () => unknown) => compute(),
      useAnimatedReaction: (prepare: () => any, react: (next: any, previous: any) => void) => { if (motion) reactions.push({ prepare, react }); },
      useReducedMotion: () => !motion, withTiming: (value: unknown) => value, withSpring: (value: unknown) => value },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'react-native-worklets': {
      scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => { if (motion) callback(...args); },
      scheduleOnUI: (callback: (...args: any[]) => void, ...args: any[]) => { if (motion) callback(...args); },
    },
    '@/components/BarBlur': { useBarBlur: () => true },
    '@/components/glass': { FloatingGlassBackdrop: 'Backdrop' },
    '../../modules/liquid-glass': { isLiquidGlassAvailable: true, LiquidGlassTabsView: 'NativeTabs',
      updateNativeTabsMotion: (...args: number[]) => { calls.tabs.push(args); return accept.tabs; },
      updateNativeDockProgress: (...args: number[]) => { calls.dock.push(args); return accept.dock; },
      restoreNativeDockScrollTarget: (...args: unknown[]) => { calls.restore.push(args); return true; },
    },
    '@/hooks/useTabBar': { useTabBarShown: () => true,
      usePlayerDockUnderlay: () => ({ reveal: false, returning: false }) },
    './PlayerDockUnderlay': { PlayerDockUnderlay: 'Underlay', usePlayerDockMaterialReady: () => false },
    '@/hooks/useLiquidDock': { COMPACT_DOCK_GAP: 8, COMPACT_DOCK_SIZE: 43, useLiquidDock: () => dock },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400 }) },
    '@/theme/motion': { motion: { duration: { exit: 150 }, reduceMotion: {} } },
    '@/i18n': { useT: () => (value: string) => value },
    '@/lib/tabOrigin': { ...tabOrigin, reselectTab: (tab: string) => reselected.push(tab),
      requestSearchFocus: () => { focusRequests++; } },
    '@/lib/tabNavigation': tabNavigation,
    '@/hooks/useLiquidTabsPress': { useLiquidTabsPress: () => ({ press() {}, release() {},
      releasePending: shared(false), releaseFrameReady: shared(0) }) },
    '@/lib/liquidDock': dockMath, '@/lib/amppDock': amppDock, '@/lib/liquidTabsMotion': tabsPressMath,
    '@/store/settings': { useSettings: (select: (state: unknown) => unknown) => select({ bottomTabs, showTabLabels: true }) },
    '@/store/glassTuning': { useGlassTuning: (select: (state: unknown) => unknown) => select({
      mode: amPlus ? 'amPlus' : 'kyantDefault', overrides: {}, amPlusOverrides: {},
    }), resolveGlassProfile: () => ({}) },
    '@/lib/glassMaterialTuning': { glassMaterialTuningMask: () => 0 },
    '@/theme': { useTheme: () => theme, useThemeMode: () => mode, BOTTOM_BAR_HORIZONTAL_MARGIN: 16,
      BOTTOM_BAR_MAX_WIDTH: 540, TAB_BAR_BOTTOM_GAP: 16, TAB_BAR_HEIGHT: 64 },
  };
  if (motion) {
    const realPress: Record<string, any> = {};
    runInNewContext(tabsPressSource, { exports: realPress, require(id: string) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected real tab-press import ${id}`);
      return dependencies[id];
    } });
    dependencies['@/hooks/useLiquidTabsPress'] = { useLiquidTabsPress: (inputs: unknown) => {
      pressInputs = inputs; return realPress.useLiquidTabsPress(inputs);
    } };
  }
  const retainedProgress: Record<string, unknown> = {};
  runInNewContext(retainedProgressSource, { exports: retainedProgress, require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected retained-progress import ${id}`);
    return dependencies[id];
  } });
  dependencies['@/hooks/useRetainedDockProgress'] = retainedProgress;
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected bar import ${id}`);
    return dependencies[id];
  } });
  let tree: Element;
  function render(route = segments) {
    segments = route; cursor = 0; reactions.length = 0; gestures.length = 0;
    tree = exports.GlobalTabBar() as Element;
    while (effects.length) effects.shift()!();
    return tree;
  }
  const motionReaction = () => reactions.find((reaction) => reaction.react.toString().includes('updateNativeTabsMotion'))!;
  return { render, reselected, navigation, bottomTabs, focusRequests: () => focusRequests,
    calls, accept, dock, pressInputs: () => pressInputs,
    gesture: (kind: string) => gestures.find((record) => record.kind === kind)!.callbacks,
    ready: (host: number) => findAll(tree, (node) => node.type === 'NativeTabs')[0].props.onMotionHostReady({ nativeEvent: { hostId: host } }),
    appState: (state: string) => { for (const listener of appStateListeners) listener(state); },
    motionState: () => motionReaction().prepare(),
    dispatch: () => { const reaction = motionReaction(); const next = reaction.prepare(); reaction.react(next, reaction.previous); reaction.previous = next; },
    unmount: () => { for (const close of cleanups) close(); cleanups.clear(); },
    theme: (appearance: string, accent: string) => {
      mode = appearance; theme = { accent, text: appearance === 'dark' ? '#FFFFFF' : '#151515', surface: '#808080' };
    },
  };
}

function findAll(node: unknown, predicate: (node: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, predicate));
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [...(predicate(element) ? [element] : []), ...findAll(element.props.children, predicate)];
}

const mainItems = (tree: Element) => findAll(tree, (node) => typeof node.type === 'function'
  && node.props.accessibilityRole === 'tab');
const icon = (tree: Element) => findAll(tree, (node) => node.type === 'Icon')[0];

describe('global dock selection on stacked pages', () => {
  it('retains each main tab glyph, theme accent, label and selected accessibility state on child pages', () => {
    for (const amPlus of [false, true]) {
      const h = harness({ amPlus });
      for (const tab of tabOrigin.TABS.filter((entry) => entry.segment !== 'options')) {
        const main = h.render(['(tabs)', tab.segment]);
        const active = mainItems(main).find((node) => node.props.accessibilityLabel === tab.label);
        // In the detached Search layout it is checked separately below.
        if (!active) continue;
        const mainColor = icon(active).props.color;
        for (const route of [['playlist', '[id]'], ['settings', 'theme'], ['album', '[id]']]) {
          const nested = mainItems(h.render(route));
          const selected = nested.filter((node) => node.props.accessibilityState.selected);
          assert.equal(selected.length, 1);
          assert.equal(selected[0].props.accessibilityLabel, tab.label);
          assert.equal(icon(selected[0]).props.color, mainColor);
          assert.equal(icon(selected[0]).props.name, icon(active).props.name);
          const label = findAll(selected[0], (node) => node.type === 'Text')[0];
          assert.equal(label.props.style.at(-2).color, mainColor);
          for (const other of nested.filter((node) => node !== selected[0])) assert.equal(icon(other).props.color, '#FFFFFF');
        }
      }
    }
  });

  it('follows live custom accents in dark and light appearances without changing tab order or enabled choices', () => {
    const h = harness({ amPlus: true });
    h.bottomTabs.reverse();
    h.render(['(tabs)', 'library']);
    const choices = JSON.stringify(h.bottomTabs);
    for (const [appearance, accent] of [['light', '#7445BD'], ['dark', '#F08ABC']]) {
      h.theme(appearance, accent);
      const nested = mainItems(h.render(['settings', 'theme']));
      const selected = nested.find((node) => node.props.accessibilityState.selected)!;
      assert.equal(selected.props.accessibilityLabel, 'Your library');
      assert.equal(icon(selected).props.color, accent);
      assert.equal(JSON.stringify(h.bottomTabs), choices);
      assert.deepEqual(nested.map((node) => node.props.accessibilityLabel), ['Your library', 'Explore', 'Home', 'Search']);
      assert.equal(nested.some((node) => node.props.accessibilityLabel === 'Settings'), false);
    }
  });

  it('keeps detached Search selected on child pages while tapping it still returns and requests focus', () => {
    for (const amPlus of [false, true]) {
      const h = harness({ amPlus, compact: true });
      h.render(['(tabs)', 'search']);
      const tree = h.render(['playlist', '[id]']);
      const search = findAll(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Search')[0];
      assert.equal(search.props.accessibilityState.selected, true);
      const searchGlyphs = findAll(tree, (node) => node.type === 'Icon' && node.props.name === 'search');
      assert.ok(searchGlyphs.every((node) => node.props.color === '#1DB954'));
      if (amPlus) {
        const compact = findAll(tree, (node) => node.type === 'Pressable' && node.props.accessibilityRole === 'button')[0];
        assert.equal(icon(compact).props.color, '#FFFFFF', 'the compact fallback main glyph is not selected over Search');
      }
      search.props.onPress();
      assert.deepEqual(h.reselected, [], 'a covered Search tab must not receive a main-screen reselect');
      assert.equal(h.focusRequests(), 1);
      assert.deepEqual(h.navigation, ['dismiss', '/search']);
    }
  });

  it('returns to the selected origin tab without reselecting a screen covered by the stack', () => {
    const h = harness();
    h.render(['(tabs)', 'library']);
    const selected = mainItems(h.render(['playlist', '[id]']))
      .find((node) => node.props.accessibilityState.selected)!;
    assert.ok(selected);
    selected.props.onPress();
    assert.deepEqual(h.reselected, []);
    assert.deepEqual(h.navigation, ['dismiss', '/library']);
  });
});

describe('native dock lifecycle handoff through the production bar callbacks', () => {
  it('does not cache a rejected first native write and stops dispatching once both channels accept', () => {
    const h = harness({ amPlus: true, compact: true, motion: true });
    h.render(); h.accept.tabs = false; h.accept.dock = false; h.ready(10);
    h.dispatch();
    assert.equal(h.calls.tabs.length, 1); assert.equal(h.calls.dock.length, 1);
    h.dispatch();
    assert.equal(h.calls.tabs.length, 2, 'an unaccepted payload must remain unsent in the deduplication cache');
    assert.equal(h.calls.dock.length, 2);
    h.accept.tabs = true; h.accept.dock = true;
    h.dispatch();
    for (let frame = 0; frame < 10; frame++) h.dispatch();
    assert.equal(h.calls.tabs.length, 3); assert.equal(h.calls.dock.length, 3, 'successful idle geometry must not be resent');
    assert.equal(h.dock.progress.get(), 1);
  });

  it('does not mark the combined payload successful when only one native channel accepted', () => {
    for (const rejected of ['tabs', 'dock'] as const) {
      const h = harness({ amPlus: true, motion: true });
      h.render(); h.accept[rejected] = false; h.ready(20); h.dispatch();
      h.dispatch();
      assert.equal(h.calls[rejected].length, 2, `${rejected}: partial acknowledgement cannot swallow the rejected payload`);
      h.accept[rejected] = true; h.dispatch();
      const settled = { tabs: h.calls.tabs.length, dock: h.calls.dock.length };
      h.dispatch();
      assert.equal(h.calls.tabs.length, settled.tabs); assert.equal(h.calls.dock.length, settled.dock);
    }
  });

  it('replays identical compact progress to a fresh host without a scroll or tab activation', () => {
    const h = harness({ amPlus: true, compact: true, motion: true });
    h.render(); h.ready(30); h.dispatch();
    const oldDock = [...h.calls.dock[0]];
    h.ready(31); h.dispatch();
    assert.equal(h.calls.dock.length, 2);
    assert.equal(h.calls.dock[1][0], 31);
    assert.equal(h.calls.dock[1][1], oldDock[1]);
    assert.equal(h.calls.dock[1][1], 1, 'the native material must recover the retained compact foreground');
    assert.equal(h.dock.uiCompact.get(), true);
    assert.equal(h.dock.nativeInputHost.get(), 31);
    assert.deepEqual(h.calls.restore.at(-1), [31, 'test', true]);
    assert.deepEqual(h.calls.compact, [], 'an already matching RN target needs no redundant lifecycle callback');
  });

  it('reconciles a native compact target retained while the RN compact callback was paused', () => {
    const h = harness({ amPlus: true, compact: false, motion: true });
    h.render(); h.dock.uiCompact.set(true); h.dock.progress.set(1);
    h.ready(35); h.dispatch();
    assert.deepEqual(h.calls.restore.at(-1), [35, 'test', true], 'native scroll input receives the retained UI target');
    assert.deepEqual(h.calls.compact, [[true, 7]], 'a real RN/UI mismatch is delivered with the current generation');
    assert.equal(h.dock.uiCompact.get(), true); assert.equal(h.calls.dock.at(-1)![1], 1);
  });

  it('ignores old or duplicate host readiness without invalidating a later real tap', () => {
    const h = harness({ amPlus: true, motion: true });
    h.render(); h.ready(40); h.dispatch();
    h.ready(39); h.ready(40); h.dispatch();
    assert.equal(h.dock.nativeInputHost.get(), 40);
    assert.equal(h.calls.dock.length, 1);
    const tap = h.gesture('tap');
    tap.onBegin(); tap.onEnd({ x: 210 }, true);
    assert.ok(h.navigation.length > 0, 'a discarded old host must not split the RN and UI geometry generations');
  });

  it('the real background callback clears an interrupted press and drag without expanding the dock', () => {
    const h = harness({ amPlus: true, motion: true });
    h.render(); h.ready(50);
    const pan = h.gesture('pan');
    pan.onBegin(); pan.onStart(); pan.onUpdate({ x: 170, velocityX: 300, translationX: 60 });
    const input = h.pressInputs();
    assert.equal(input.dragging.get(), true);
    assert.ok(input.pressProgress.get() > 0);
    assert.ok(input.scaleX.get() > 1);
    assert.ok(input.selectionDestination.get() > 0 && input.selectionDestination.get() < 3,
      'a pan leaves an uncommitted lens destination between the route tabs');
    h.dock.uiCompact.set(true); h.dock.progress.set(0.4);
    h.appState('background');
    assert.equal(input.dragging.get(), false);
    assert.equal(input.pressProgress.get(), 0);
    assert.equal(input.scaleX.get(), 1); assert.equal(input.scaleY.get(), 1);
    assert.equal(input.dragVelocity.get(), 0); assert.equal(input.panelOffset.get(), 0);
    assert.equal(input.selectionDestination.get(), 0, 'foreground recovery returns the lens target to the committed Home route');
    assert.equal(input.selectionPosition.get(), 0, 'an interrupted fractional lens must not remain between routes');
    assert.equal(h.dock.uiCompact.get(), true, 'an interrupted gesture does not change the folding target');
    assert.equal(h.dock.progress.get(), 0.4, 'the material and foreground share the retained in-flight progress');
    pan.onEnd({ x: 350 }, true); pan.onFinalize();
    assert.deepEqual(h.navigation, [], 'the retired gesture cannot navigate after the lifecycle epoch changed');
    h.appState('active'); h.ready(51); h.dispatch();
    assert.equal(h.calls.dock.at(-1)![0], 51);
    assert.equal(h.dock.uiCompact.get(), true);
  });

  it('a focus-only fresh host also clears a held press even when AppState never changed', () => {
    const h = harness({ amPlus: true, motion: true });
    h.render(); h.ready(60);
    h.gesture('tap').onBegin();
    assert.ok(h.pressInputs().pressProgress.get() > 0);
    h.ready(61);
    assert.equal(h.pressInputs().pressProgress.get(), 0);
    assert.equal(h.pressInputs().scaleX.get(), 1);
    h.dispatch();
    assert.equal(h.calls.tabs.at(-1)![0], 61);
    assert.equal(h.calls.tabs.at(-1)![2], 0);
  });
});
