import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { showUndoToast, useToast } from '../src/store/toast';
import { DEFAULT_GLASS_PROFILES, getKyantGlassProfile } from '../src/theme/glassDefaults';
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
    AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' },
  };
  const theme = load('theme/index.ts', { react, 'react-native': native });
  theme.applyThemePreference('light');
  const nativeGlass = { LiquidGlassView: 'NativeGlass', LiquidGlassToggle: 'NativeToggle', LiquidGlassSlider: 'NativeSlider',
    isLiquidGlassAvailable: true, updateNativeDockProgress() {}, updateNativeButtonMotion() {} };
  const tuning = { mode: 'amPlus', amPlusOverrides: { controls: {} }, overrides: { controls: {} } };
  // Execute the actual GlassBackdrop too: the regression was the native dialog
  // recipe overriding the old dark snackbar tint, not the toast label alone.
  const glass = load('components/glass/index.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' } },
    '@react-native-community/slider': { __esModule: true, default: 'Slider' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../modules/liquid-glass': nativeGlass,
    '@/store/glassTuning': { useGlassTuning: (select: (state: unknown) => unknown) => select(tuning),
      sanitizeGlassOverrides: (value: unknown) => value,
      resolveGlassProfile: () => DEFAULT_GLASS_PROFILES.controls },
    '@/theme': theme, '@/theme/glassDefaults': { getKyantGlassProfile },
    '@/lib/glassMaterialTuning': { glassMaterialTuningMask: () => 0 },
    '@/lib/glassSwitchSize': { GLASS_SWITCH_SIZE: {} },
    './StaticGlassBackdropContext': { DynamicGlassBackdrop: 'DynamicGlassBackdrop' },
  });
  const module = load('components/Toast.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      FadeInDown: { duration: (ms: number) => ({ ms }) }, FadeOut: { duration: (ms: number) => ({ ms }) } },
    '@/components/glass': glass,
    '@/hooks/useScreenBottomPadding': { useFloatingBottom: () => 180 },
    '@/store/toast': { useToast: (select: (state: unknown) => unknown) => select(useToast.getState()) },
    '@/theme': theme,
  }, {
    setTimeout(callback: () => void, delay: number) { const job = { callback, delay, cancelled: false }; timers.push(job); return job; },
    clearTimeout(job: typeof timers[number]) { job.cancelled = true; },
  });
  let tree: Element | null;
  const render = () => { cursor = 0; tree = module.Toast(); return tree; };
  const backdrop = () => {
    const node = find(tree, (node) => node.type === glass.GlassBackdrop)!;
    return glass.GlassBackdrop(node.props) as Element;
  };
  const text = (label: string) => find(tree, (node) => node.type === 'Text' && node.props.children === label)!;
  const wash = () => find(tree, (node) => node.type === 'View' && flatten(node.props.style).opacity > 0)!;
  const action = () => find(tree, (node) => node.type === glass.GlassPressable)!;
  render();
  return { render, theme, tuning, nativeGlass, timers, backdrop, text, wash, action, tree: () => tree,
    subscriptions: () => themeSubscriptions,
    unmount() { effects.forEach((effect) => effect.cleanup?.()); useToast.getState().hide(); },
    actionHost: () => glass.GlassPressable(action().props, null) as Element,
  };
}

function composite(wash: string, opacity: number, background: string) {
  const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const front = channels(wash); const back = channels(background);
  return '#' + front.map((value, i) => Math.round(value * opacity + back[i] * (1 - opacity)).toString(16).padStart(2, '0')).join('');
}

describe('shared queue notification readability', () => {
  it('pairs actual light native dialog glass with dark themed ink and updates to dark theme without replacing the message', () => {
    const h = harness(); useToast.getState().show('已设为下一首'); h.render();
    assert.equal(h.backdrop().type, 'NativeGlass');
    assert.equal(h.backdrop().props.materialPreset, 'dialog');
    assert.equal(h.backdrop().props.tintColor, '#FAFAFA');
    assert.equal(flatten(h.text('已设为下一首').props.style).color, h.theme.colors.text);
    assert.notEqual(flatten(h.text('已设为下一首').props.style).color, '#FFFFFF');
    const before = h.subscriptions();
    h.theme.applyThemePreference('dark'); h.render();
    assert.ok(h.subscriptions() > before, 'Toast reads the actual theme subscription on render');
    assert.equal(h.backdrop().props.tintColor, '#121212');
    assert.equal(flatten(h.text('已设为下一首').props.style).color, '#FFFFFF');
    assert.equal(h.timers.length, 1, 'theme changes retain the original dismissal clock');
    h.unmount();
  });

  it('keeps message and action contrast across every theme tint and arbitrary glass pixels while retaining one glass surface', () => {
    const h = harness(); useToast.getState().show('Playing next', { label: 'Undo', run() {} });
    for (const tint of Object.keys(h.theme.BACKGROUND_TINTS)) for (const mode of ['light', 'dark']) {
      h.theme.applyBackgroundTint(tint); h.theme.applyThemePreference(mode); h.render();
      const wash = flatten(h.wash().props.style);
      assert.equal(h.wash().props.pointerEvents, 'none');
      assert.ok(wash.opacity > 0 && wash.opacity < 1, 'the local fill retains the original glass');
      for (const pixel of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF']) {
        const surface = composite(wash.backgroundColor, wash.opacity, pixel);
        for (const label of ['Playing next', 'Undo']) {
          const ink = flatten(h.text(label).props.style).color;
          assert.ok(paletteContrast(ink, surface) >= 4.5, `${mode}/${tint}/${pixel}/${label}`);
        }
      }
      assert.ok(h.backdrop());
      assert.equal(h.actionHost().type, 'Pressable', 'the action keeps its original plain control');
      assert.equal(h.actionHost().props.variant, undefined);
      assert.equal(flatten(h.text('Undo').props.style).textDecorationLine, 'underline');
    }
    h.theme.applyPureBlack(true); h.theme.applyThemePreference('dark'); h.render();
    const wash = flatten(h.wash().props.style);
    assert.ok(paletteContrast(flatten(h.text('Playing next').props.style).color, composite(wash.backgroundColor, wash.opacity, '#FFFFFF')) >= 4.5);
    h.unmount();
  });

  it('retains glass parameters, informational pass-through, fallback readability, Undo and dismissal cleanup', () => {
    const h = harness();
    assert.equal(h.tree(), null);
    useToast.getState().show('Added to queue'); h.render();
    assert.equal(h.tree()!.props.pointerEvents, 'none');
    const profile = getKyantGlassProfile('dialog', false);
    for (const key of ['blur', 'refraction', 'refractionHeight', 'highlightWidth', 'highlightOpacity', 'depthEffect', 'chromaticAberration'])
      assert.equal(h.backdrop().props[key], profile[key as keyof typeof profile], key);
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
    assert.equal(h.backdrop().type, 'View');
    assert.equal(flatten(h.backdrop().props.style).backgroundColor, h.theme.colors.surface);
    h.timers.at(-1)!.callback(); h.render();
    assert.equal(h.tree(), null);
    useToast.getState().show('Last'); h.render();
    h.unmount(); assert.equal(h.timers.at(-1)!.cancelled, true);
  });
});
