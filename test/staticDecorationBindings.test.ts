import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { albumEraIndex } from '../src/lib/albumEras';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
const light = { background: '#fafafa', surface: '#dddddd', text: '#111111', textSecondary: '#555555', textMuted: '#666666', accent: '#aa2244', surfaceHighlight: '#dddddd', dark: false };
const profile = { blur: 7, refraction: 24, refractionHeight: 12, highlightWidth: .5, highlightOpacity: .8, depthEffect: true, chromaticAberration: true, tintOpacity: .4, tintColor: '#765432' };
const t = (key: string, values: Record<string, unknown> = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const react = { ...React, __esModule: true, default: React };
const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
function harness(platform = 'android') {
  const Theme = React.createContext(light);
  const native = { Platform: { OS: platform }, View: 'View', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', Switch: 'Switch', ActivityIndicator: 'Spinner',
    StyleSheet: { flatten, create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 1 },
    processColor(value: any) {
      if (typeof value === 'number' || typeof value === 'object') return value;
      if (value === 'invalid') return Number.NaN;
      if (value === 'transparent') return 0;
      if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) return (0xff000000 | Number.parseInt(value.slice(1), 16)) >>> 0;
      return undefined;
    },
  };
  const bridge = load('../modules/liquid-glass/index.tsx', { react, 'react/jsx-runtime': JSXRuntime, 'react-native': native,
    expo: { requireOptionalNativeModule: () => ({ isSupported: true }),
      requireNativeView: (_module: string, name?: string) => name ?? 'NativeMaterial' } });
  const theme = { useTheme: () => React.useContext(Theme), useThemeMode: () => React.useContext(Theme).dark ? 'dark' : 'light', themed: (make: any) => make(light) };
  const tuning = { mode: 'amPlus', overrides: { controls: profile, navigation: profile, miniPlayer: profile }, amPlusOverrides: { controls: profile, navigation: profile, miniPlayer: profile } };
  const glass = load('../src/components/glass/index.tsx', { react, 'react/jsx-runtime': JSXRuntime, 'react-native': native,
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, useAnimatedReaction() {}, useAnimatedStyle: (build: any) => build(),
      useSharedValue: (initial: any) => React.useRef({ value: initial, get() { return this.value; }, set(value: any) { this.value = value; } }).current },
    '@react-native-community/slider': { __esModule: true, default: 'Slider' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../modules/liquid-glass': bridge, '@/store/glassTuning': { useGlassTuning: (select: any) => select(tuning), resolveGlassProfile: () => profile, sanitizeGlassOverrides: (value: any) => value },
    '@/theme': theme, '@/theme/glassDefaults': { getKyantGlassProfile: () => profile }, '@/lib/glassMaterialTuning': { glassMaterialTuningMask: () => 63 },
    '@/lib/glassThemeTrace': { traceResolvedGlassTheme() {} }, '@/lib/glassSwitchSize': { GLASS_SWITCH_SIZE: {} },
    './StaticGlassBackdropContext': { DynamicGlassBackdrop: ({ children }: any) => React.createElement(React.Fragment, null, children) },
  });
  const card = load('../src/components/AlbumEraCard.tsx', { react, 'react/jsx-runtime': JSXRuntime, 'react-native': native,
    'expo-router': { router: { push() {} } }, '@/components/Cover': { Cover: 'Cover' }, '@/components/glass': glass,
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/i18n': { useT: () => t }, '@/theme': theme }).AlbumEraCard;
  return { Theme, bridge, glass, card, native, theme };
}

test('the mounted era card propagates explicit cache admission through real surface, material and native wrappers without changing optics', async () => {
  const h = harness(), props = { era: '1980s', year: 1980, count: 40, fraction: .5, downloaded: false, covers: [{ id: 'one', uri: 'file:///one.jpg' }] };
  let tree!: ReactTestRenderer;
  const render = (colors = light, enabled = true) => React.createElement(h.Theme.Provider, { value: colors }, React.createElement(h.card, { ...props, cacheStaticDecoration: enabled }));
  await act(async () => { tree = create(render()); });
  const native = () => tree.root.findByType('NativeMaterial' as any).props;
  assert.equal(native().cacheStaticDecoration, true);
  assert.equal(native().staticBackdropColor, 0xfffafafa);
  const optics = ['radius', 'blur', 'refraction', 'refractionHeight', 'highlightWidth', 'highlightOpacity', 'depthEffect', 'chromaticAberration', 'tintColor', 'tintOpacity'];
  const before = optics.map((key) => native()[key]);
  assert.deepEqual(before, [22, 7, 24, 12, .5, .8, true, true, 0xff765432, .4]);
  assert.equal(tree.root.findAllByType('Cover' as any).length, 1);
  for (const view of tree.root.findAllByType('View' as any)) assert.equal(view.props.cacheStaticDecoration, undefined, 'internal cache props do not leak onto ordinary native containers');
  await act(async () => { tree.update(render(light, false)); });
  assert.equal(native().cacheStaticDecoration, false, 'the memoized card must observe a bound/eligibility change');
  assert.deepEqual(optics.map((key) => native()[key]), before);
  const dark = { ...light, background: '#141414', dark: true };
  await act(async () => { tree.update(render(dark)); });
  assert.equal(native().cacheStaticDecoration, true); assert.equal(native().staticBackdropColor, 0xff141414); assert.equal(native().dark, true);
  await act(async () => { tree.unmount(); });
  const module = readFileSync(new URL('../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/LiquidGlassModule.kt', import.meta.url), 'utf8');
  assert.match(module, /Prop\("cacheStaticDecoration"\)\s*\{\s*view:\s*LiquidGlassView,\s*value:\s*Boolean\s*->\s*view\.cacheStaticDecoration\s*=\s*value\s*\}/, 'the emitted JS property has a matching Boolean native binding');
});

test('ordinary surfaces and floating controls stay live, nonregular variants cannot opt in, and invalid source colors never reach cache admission', async () => {
  const h = harness(); let tree!: ReactTestRenderer;
  const cases: [React.ElementType, Record<string, unknown>, boolean][] = [
    [h.glass.GlassSurface, { staticBackdropColor: '#fafafa' }, false],
    [h.glass.GlassSurface, { cacheStaticDecoration: true }, false],
    ...['button', 'subtle', 'prominent'].map((variant) => [h.glass.GlassSurface, { cacheStaticDecoration: true, staticBackdropColor: '#fafafa', variant }, false] as [React.ElementType, Record<string, unknown>, boolean]),
    [h.glass.FloatingGlassBackdrop, { target: 'miniPlayer', radius: 24 }, false],
    [h.glass.FloatingGlassBackdrop, { target: 'navigation', radius: 30 }, false],
    [h.bridge.LiquidGlassTabsView, { tabsCount: 4, cacheStaticDecoration: true, staticBackdropColor: '#fafafa' }, false],
  ];
  for (const [Component, props, expected] of cases) {
    await act(async () => { tree = create(React.createElement(Component, props)); });
    assert.equal(tree.root.findByType('NativeMaterial' as any).props.cacheStaticDecoration, expected);
    await act(async () => { tree.unmount(); });
  }
  for (const color of [Number.NaN, Number.POSITIVE_INFINITY, 'invalid', { dynamic: true }]) {
    await act(async () => { tree = create(React.createElement(h.bridge.LiquidGlassView, { cacheStaticDecoration: true, staticBackdropColor: color })); });
    const props = tree.root.findByType('NativeMaterial' as any).props;
    assert.equal(props.cacheStaticDecoration, false); assert.equal(props.staticBackdropColor, null);
    await act(async () => { tree.unmount(); });
  }
  await act(async () => { tree = create(React.createElement(h.glass.GlassPressable, { cacheStaticDecoration: true })); });
  assert.equal(tree.root.findByType('Pressable' as any).props.cacheStaticDecoration, undefined);
  await act(async () => { tree.unmount(); });
  const web = harness('web');
  await act(async () => { tree = create(React.createElement(web.bridge.LiquidGlassView, { cacheStaticDecoration: true, staticBackdropColor: '#fafafa' })); });
  assert.equal(tree.root.findByType('View' as any).props.cacheStaticDecoration, undefined);
  await act(async () => { tree.unmount(); });
});

test('the real era overview limits caching to twenty-four rows including unknown years while retaining its original clipping and geometry', async () => {
  const h = harness();
  const index = (decades: number, unknown = false) => albumEraIndex([{ offset: 0, albums: [
    ...Array.from({ length: decades }, (_, i) => ({ id: `album-${i}`, name: `Album ${i}`, year: 1900 + i * 10 })),
    ...(unknown ? [{ id: 'unknown', name: 'Unknown' }] : []),
  ] as any }]);
  const result = { index: index(23, true), complete: true, isError: false, issue: undefined, restart: async () => {} };
  const { default: Screen } = load('../src/app/album-eras.tsx', { react, 'react/jsx-runtime': JSXRuntime, 'react-native': h.native,
    'react-native-reanimated': { __esModule: true, default: { FlatList: 'List' } },
    'expo-router': { useLocalSearchParams: () => ({ downloaded: '1' }) },
    '@/api/data': { COVER: { thumb: 200 }, coverArtUrl: (id: string, size: number) => `${id}?size=${size}` },
    '@/components/AlbumEraCard': { AlbumEraCard: h.card }, '@/components/BackChevron': { BackChevron: 'Back' }, '@/components/BrowseFrame': { BrowseFrame: 'Frame' },
    '@/components/EmptyState': { EmptyState: 'Empty' }, '@/components/glass': h.glass,
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/hooks/useAlbumEras': { useAlbumEras: (downloaded: boolean) => { assert.equal(downloaded, true); return result; } },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => 'ui-thread-handler' }, '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 160 },
    '@/hooks/useScreenSize': { useListPadding: () => 20 }, '@/i18n': { useT: () => t },
    '@/lib/listPerf': { listPerf: { initialNumToRender: 10, maxToRenderPerBatch: 10, windowSize: 11, removeClippedSubviews: true } },
    '@/theme': { ...h.theme, spacing: { lg: 20 } },
  });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(Screen)); });
  const first = tree.root.findByType('List' as any).props;
  assert.equal(first.data.length, 24);
  assert.equal(first.removeClippedSubviews, true);
  assert.ok(first.data.every((item: any) => first.renderItem({ item }).props.cacheStaticDecoration === true));
  const oldRow = first.data[0]; const oldProps = first.renderItem({ item: oldRow }).props;
  result.index = index(24, true);
  await act(async () => { tree.update(React.createElement(Screen)); });
  const larger = tree.root.findByType('List' as any).props;
  assert.equal(larger.data.length, 25);
  assert.equal(larger.removeClippedSubviews, true);
  assert.ok(larger.data.every((item: any) => larger.renderItem({ item }).props.cacheStaticDecoration === false));
  assert.equal(JSON.stringify(larger.contentContainerStyle), JSON.stringify(first.contentContainerStyle));
  assert.equal(larger.windowSize, first.windowSize); assert.equal(larger.onScroll, first.onScroll);
  const updated = larger.renderItem({ item: larger.data.find((item: any) => item.key === oldRow.key) }).props;
  assert.equal(updated.downloaded, oldProps.downloaded); assert.equal(updated.covers[0].uri, oldProps.covers[0].uri);
  result.index = index(24);
  await act(async () => { tree.update(React.createElement(Screen)); });
  const bounded = tree.root.findByType('List' as any).props;
  assert.ok(bounded.data.every((item: any) => bounded.renderItem({ item }).props.cacheStaticDecoration === true));
  await act(async () => { tree.unmount(); });
});
