import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { showUndoToast, useToast } from '../src/store/toast';
import { create } from 'zustand';
import * as glassDefaults from '../src/theme/glassDefaults';
import { glassMaterialTuningMask } from '../src/lib/glassMaterialTuning';
import { paletteContrast } from '../src/lib/playerPalette';

type Element = { type: any; props: Record<string, any> };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
function find(tree: any, predicate: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) return tree.map((node) => find(node, predicate)).find(Boolean);
  if (!tree?.props) return;
  return predicate(tree) ? tree : find(tree.props.children, predicate);
}
function flatten(style: any): Record<string, any> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {};
}
function load(file: string, imports: Record<string, unknown>, globals: object = {}) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports: Record<string, any> = {};
  runInNewContext(compiled.outputText, { exports, ...globals, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected ${file} dependency ${name}`);
    return imports[name];
  } });
  return exports;
}

function harness() {
  useToast.getState().hide();
  let cursor = 0;
  const effects: { deps?: unknown[]; cleanup?: () => void }[] = [];
  const timers: { callback: () => void; delay: number; cancelled: boolean }[] = [];
  let themeSubscriptions = 0;
  const react = {
    forwardRef: (render: unknown) => render,
    createRef: () => ({ current: null }),
    useEffect(create: () => (() => void) | void, deps: unknown[]) {
      const saved = effects[cursor++] ??= {};
      if (saved.deps && deps.every((value, i) => Object.is(value, saved.deps![i]))) return;
      saved.cleanup?.(); saved.deps = deps; saved.cleanup = create() || undefined;
    },
    useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) { themeSubscriptions++; return snapshot(); },
  };
  const native = { Text: 'Text', View: 'View', Pressable: 'Pressable', TextInput: 'TextInput', Switch: 'Switch',
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      flatten },
    Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) },
    AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android', Version: 36 },
  };
  const theme = load('theme/index.ts', { react, 'react-native': native });
  theme.applyThemePreference('light');
  const nativeCalls: unknown[][] = [];
  const reactions: { prepare: () => unknown; react: (state: unknown) => void }[] = [];
  const animated = { __esModule: true, default: { View: 'AnimatedView' },
    useSharedValue(value: unknown) { return { get: () => value, set(next: unknown) { value = next; } }; },
    useAnimatedReaction(prepare: () => unknown, react: (state: unknown) => void) { reactions.push({ prepare, react }); },
    useAnimatedStyle: (updater: () => unknown) => updater(),
  };
  const nativeGlass = { LiquidGlassView: 'NativeGlass', LiquidGlassToggle: 'NativeToggle', LiquidGlassSlider: 'NativeSlider',
    isLiquidGlassAvailable: true,
    isGlassThemeTraceEnabled: false,
    updateNativeDockProgress: (...args: unknown[]) => nativeCalls.push(args),
    updateNativeButtonMotion: (...args: unknown[]) => nativeCalls.push(args),
  };
  // Real mode/override resolution and real MiniPlayer blur preference; only
  // filesystem persistence and native hooks are replaced at this boundary.
  const tuningModule = load('store/glassTuning.ts', { zustand: { create },
    '@/lib/storage': { getItem: async () => null, setItemStrict: async () => {} },
    '@/theme/glassDefaults': glassDefaults,
  });
  const tuning = tuningModule.useGlassTuning;
  const settings = { blurBars: true, blurMiniPlayer: true };
  const barBlur = load('components/BarBlur.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
    'react-native-reanimated': animated,
    '@/store/settings': { useSettings: (select: (state: unknown) => unknown) => select(settings) },
    '@/theme': theme, '../../modules/liquid-glass': nativeGlass,
  });
  // Execute the actual FloatingGlassBackdrop used by MiniPlayer, including its
  // current tuning selection and the optional native motion mapper guards.
  const glassThemeTrace = load('lib/glassThemeTrace.ts', { '../../modules/liquid-glass': nativeGlass });
  const glass = load('components/glass/index.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'react-native-reanimated': animated,
    '@react-native-community/slider': { __esModule: true, default: 'Slider' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../modules/liquid-glass': nativeGlass,
    '@/store/glassTuning': { ...tuningModule, useGlassTuning: (select: (state: unknown) => unknown) => select(tuning.getState()) },
    '@/theme': theme, '@/theme/glassDefaults': glassDefaults,
    '@/lib/glassMaterialTuning': { glassMaterialTuningMask },
    '@/lib/glassThemeTrace': glassThemeTrace,
    '@/lib/glassSwitchSize': { GLASS_SWITCH_SIZE: {} },
    './StaticGlassBackdropContext': { DynamicGlassBackdrop: 'DynamicGlassBackdrop' },
  });
  const module = load('components/Toast.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      FadeInDown: { duration: (ms: number) => ({ ms }) }, FadeOut: { duration: (ms: number) => ({ ms }) } },
    '@/components/glass': glass, './BarBlur': barBlur,
    '@/hooks/useScreenBottomPadding': { useFloatingBottom: () => 180 },
    '@/store/toast': { useToast: (select: (state: unknown) => unknown) => select(useToast.getState()) },
    '@/theme': theme,
  }, {
    setTimeout(callback: () => void, delay: number) { const job = { callback, delay, cancelled: false }; timers.push(job); return job; },
    clearTimeout(job: typeof timers[number]) { job.cancelled = true; },
  });
  let tree: Element | null;
  const render = () => { cursor = 0; tree = module.Toast(); return tree; };
  const material = () => find(tree, (node) => node.type === glass.FloatingGlassBackdrop)!;
  const backdrop = () => {
    reactions.length = 0;
    return glass.FloatingGlassBackdrop(material().props) as Element;
  };
  const text = (label: string) => find(tree, (node) => node.type === 'Text' && node.props.children === label)!;
  const action = () => find(tree, (node) => node.type === glass.GlassPressable)!;
  render();
  return { render, theme, tuning, nativeGlass, timers, backdrop, material, text, action, settings, tree: () => tree,
    profile: tuningModule.resolveGlassProfile, nativeCalls,
    flushMotion() { for (const { prepare, react } of reactions) { const state = prepare(); assert.equal(state, null); react(state); } },
    subscriptions: () => themeSubscriptions,
    unmount() { effects.forEach((effect) => effect.cleanup?.()); useToast.getState().hide(); },
    actionHost: () => glass.GlassPressable(action().props, null) as Element,
  };
}

describe('shared queue notification with MiniPlayer glass', () => {
  it('uses the current MiniPlayer material without a wash or dock motion and updates themed ink in place', () => {
    const h = harness(); useToast.getState().show('已设为下一首'); h.render();
    assert.equal(h.material().props.target, 'miniPlayer');
    assert.equal(h.material().props.blurred, true);
    assert.equal(h.material().props.tint, undefined, 'no artwork or theme overlay changes the mini material');
    assert.equal(h.backdrop().type, 'NativeGlass');
    assert.equal(h.backdrop().props.materialPreset, 'amPlus');
    assert.equal(h.backdrop().props.tintColor, '#FAFAFA');
    assert.equal(find(h.tree(), (node) => node.type === 'View'), undefined, 'no local contrast wash remains');
    for (const key of ['dockProgress', 'dockExpandedWidth', 'dockCompactWidth', 'dockCompactHeight', 'dockCompactOffsetX',
      'buttonPressProgress', 'buttonPressX', 'buttonPressY']) assert.equal(h.material().props[key], undefined, key);
    assert.equal(h.backdrop().props.onMotionHostReady, undefined);
    h.flushMotion(); assert.equal(h.nativeCalls.length, 0);
    assert.equal(flatten(h.text('已设为下一首').props.style).color, h.theme.colors.text);
    assert.notEqual(flatten(h.text('已设为下一首').props.style).color, '#FFFFFF');
    const before = h.subscriptions();
    h.theme.applyThemePreference('dark'); h.render();
    assert.ok(h.subscriptions() > before);
    assert.equal(h.backdrop().props.tintColor, '#121212');
    assert.equal(flatten(h.text('已设为下一首').props.style).color, '#FFFFFF');
    assert.equal(h.timers.length, 1, 'theme changes retain the original dismissal clock');
    h.unmount();
  });

  it('resolves all MiniPlayer modes and actual user overrides, retains blur preference, and keeps the ink halo limited to glyphs', () => {
    const h = harness(); useToast.getState().show('Playing next', { label: 'Undo', run() {} });
    const patch = { blur: 11, refraction: 19, refractionHeight: 13, highlightWidth: 2,
      highlightOpacity: .7, tintColor: '#506070', tintOpacity: .22, depthEffect: true, chromaticAberration: true };
    for (const mode of ['amPlus', 'custom', 'kyantDefault', 'iphoneReference']) for (const dark of [false, true]) {
      h.tuning.getState().setMode(mode);
      h.tuning.getState().update('controls', { blur: 31, refraction: 47, tintColor: '#FF0000' });
      h.tuning.getState().update('miniPlayer', patch);
      h.theme.applyThemePreference(dark ? 'dark' : 'light'); h.render();
      const state = h.tuning.getState();
      const overrides = (mode === 'amPlus' ? state.amPlusOverrides : state.overrides).miniPlayer;
      const profile = h.profile('miniPlayer', dark, overrides, mode);
      const native = h.backdrop().props;
      assert.equal(native.materialPreset, mode === 'amPlus' ? 'amPlus' : mode === 'kyantDefault' ? 'button' : 'custom');
      for (const key of ['blur', 'refraction', 'refractionHeight', 'highlightWidth', 'highlightOpacity', 'depthEffect', 'chromaticAberration'])
        assert.equal(native[key], profile[key], `${mode}/${dark}/${key}`);
      assert.equal(native.tintColor, profile.tintColor ?? 'transparent');
      assert.equal(native.tintOpacity, profile.tintOpacity);
      assert.equal(native.materialTuningMask, mode === 'amPlus' ? glassMaterialTuningMask(overrides) : 0);
      assert.equal(native.onMotionHostReady, undefined);
      h.flushMotion(); assert.equal(h.nativeCalls.length, 0);
      h.settings.blurMiniPlayer = false; h.render();
      assert.equal(h.material().props.blurred, false);
      assert.equal(h.backdrop().props.blur, 0);
      assert.equal(h.backdrop().props.refraction, 0);
      assert.equal(h.backdrop().props.refractionHeight, 0);
      h.settings.blurMiniPlayer = true;
    }
    for (const tint of Object.keys(h.theme.BACKGROUND_TINTS)) for (const mode of ['light', 'dark']) {
      h.theme.applyBackgroundTint(tint); h.theme.applyThemePreference(mode); h.render();
      for (const label of ['Playing next', 'Undo']) {
        const ink = flatten(h.text(label).props.style);
        assert.equal(ink.color, h.theme.colors.text);
        assert.ok(paletteContrast(ink.color, h.theme.colors.background) >= 4.5);
        assert.equal(ink.textShadowOffset.width, 0);
        assert.equal(ink.textShadowOffset.height, 0);
        assert.ok(ink.textShadowRadius > 0 && ink.textShadowRadius <= 1);
        assert.equal(ink.textShadowColor, `${h.theme.colors.onInverse}80`);
      }
      assert.equal(h.actionHost().type, 'Pressable', 'the action keeps its original plain control');
      assert.equal(h.actionHost().props.variant, undefined);
      assert.equal(flatten(h.text('Undo').props.style).textDecorationLine, 'underline');
    }
    h.unmount();
  });

  it('retains informational pass-through, shared transparent fallback, Undo and dismissal cleanup', () => {
    const h = harness();
    assert.equal(h.tree(), null);
    useToast.getState().show('Added to queue'); h.render();
    assert.equal(h.tree()!.props.pointerEvents, 'none');
    assert.equal(h.timers.at(-1)!.delay, 2600);
    let committed = 0; let undone = 0;
    showUndoToast('Removed from queue', 'Undo', { commit: () => committed++, undo: () => undone++ }); h.render();
    assert.equal(committed, 0); assert.equal(h.timers[0].cancelled, true);
    assert.equal(h.tree()!.props.pointerEvents, 'box-none');
    assert.equal(h.timers.at(-1)!.delay, 4000);
    h.action().props.onPress(); h.render();
    assert.equal(undone, 1); assert.equal(committed, 0); assert.equal(h.tree(), null);
    useToast.getState().show('Playing next'); h.render();
    h.nativeGlass.isLiquidGlassAvailable = false;
    h.tuning.getState().setMode('custom');
    assert.equal(h.backdrop().type, 'AnimatedView');
    assert.equal(flatten(h.backdrop().props.style).backgroundColor, 'transparent');
    assert.equal(flatten(h.backdrop().props.style).transform, undefined, 'fallback cannot inherit dock translation');
    h.timers.at(-1)!.callback(); h.render();
    assert.equal(h.tree(), null);
    useToast.getState().show('Last'); h.render();
    h.unmount(); assert.equal(h.timers.at(-1)!.cancelled, true);
  });
});
