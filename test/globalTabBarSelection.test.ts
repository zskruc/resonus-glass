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

// Render the actual bar and inspect the props it hands to its visible controls.
// Only hooks and native boundaries are stubbed; route/selection logic is real.
function harness({ amPlus = false, compact = false } = {}) {
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
  const slot = <T,>(create: () => T): T => slots[cursor++] ??= create();
  const react = {
    useRef: <T,>(value: T) => slot(() => ({ current: value })),
    useState: <T,>(initial: T | (() => T)) => {
      const state = slot(() => ({ value: typeof initial === 'function' ? (initial as () => T)() : initial }));
      return [state.value, (value: T) => { state.value = value; }];
    },
    useCallback: (callback: unknown) => callback,
    useLayoutEffect() {}, useEffect() {},
  };
  const gesture = new Proxy({}, { get: () => () => gesture });
  const router = { canDismiss: () => true, dismissAll: () => navigation.push('dismiss'),
    navigate: (href: string) => navigation.push(href) };
  const dependencies: Record<string, any> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    'expo-router': { useSegments: () => segments, useRouter: () => router,
      useNavigationContainerRef: () => ({ isReady: () => false }) },
    'react-native': { I18nManager: { isRTL: false }, Pressable: 'Pressable', Text: 'Text', View: 'View',
      StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } },
    'react-native-gesture-handler': { Gesture: { Pan: () => gesture, Tap: () => gesture, Exclusive: () => gesture }, GestureDetector: 'GestureDetector' },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: <T,>(value: T) => slot(() => shared(value)),
      useDerivedValue: (compute: () => unknown) => ({ get: compute, get value() { return compute(); } }),
      useAnimatedStyle: (compute: () => unknown) => compute(), useAnimatedReaction() {},
      useReducedMotion: () => true, withTiming: (value: unknown) => value, withSpring: (value: unknown) => value },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'react-native-worklets': { scheduleOnRN() {}, scheduleOnUI() {} },
    '@/components/BarBlur': { useBarBlur: () => true },
    '@/components/glass': { FloatingGlassBackdrop: 'Backdrop' },
    '../../modules/liquid-glass': { isLiquidGlassAvailable: true, LiquidGlassTabsView: 'NativeTabs' },
    '@/hooks/useTabBar': { useTabBarShown: () => true,
      usePlayerDockUnderlay: () => ({ reveal: false, returning: false }) },
    './PlayerDockUnderlay': { PlayerDockUnderlay: 'Underlay', usePlayerDockMaterialReady: () => false },
    '@/hooks/useLiquidDock': { COMPACT_DOCK_GAP: 8, COMPACT_DOCK_SIZE: 43, useLiquidDock: () => ({
      progress: shared(compact ? 1 : 0), compact, uiCompact: shared(compact), expand() {}, hasSearch: true,
      enabled: true, scope: 'test', nativeInput: false, nativeInputHost: shared(0), requestNativeCompact() {},
    }) },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400 }) },
    '@/theme/motion': { motion: { duration: { exit: 150 }, reduceMotion: {} } },
    '@/i18n': { useT: () => (value: string) => value },
    '@/lib/tabOrigin': { ...tabOrigin, reselectTab: (tab: string) => reselected.push(tab),
      requestSearchFocus: () => { focusRequests++; } },
    '@/lib/tabNavigation': tabNavigation,
    '@/hooks/useLiquidTabsPress': { useLiquidTabsPress: () => ({ press() {}, release() {},
      releasePending: shared(false), releaseFrameReady: shared(0) }) },
    '@/lib/liquidDock': dockMath, '@/lib/amppDock': amppDock,
    '@/store/settings': { useSettings: (select: (state: unknown) => unknown) => select({ bottomTabs, showTabLabels: true }) },
    '@/store/glassTuning': { useGlassTuning: (select: (state: unknown) => unknown) => select({
      mode: amPlus ? 'amPlus' : 'kyantDefault', overrides: {}, amPlusOverrides: {},
    }), resolveGlassProfile: () => ({}) },
    '@/lib/glassMaterialTuning': { glassMaterialTuningMask: () => 0 },
    '@/theme': { useTheme: () => theme, useThemeMode: () => mode, BOTTOM_BAR_HORIZONTAL_MARGIN: 16,
      BOTTOM_BAR_MAX_WIDTH: 540, TAB_BAR_BOTTOM_GAP: 16, TAB_BAR_HEIGHT: 64 },
  };
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected bar import ${id}`);
    return dependencies[id];
  } });
  function render(route = segments) { segments = route; cursor = 0; return exports.GlobalTabBar() as Element; }
  return { render, reselected, navigation, bottomTabs, focusRequests: () => focusRequests,
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
