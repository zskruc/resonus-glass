import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Element = { type: unknown; props: Record<string, any> };
type Binding = { moduleName: string; viewName: string | undefined };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const compiled = ts.transpileModule(readFileSync(new URL('../modules/liquid-glass/index.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Run the actual production module and wrappers. Only Expo/native lookup and
// JSX are mocked; binding and availability policy come from index.tsx itself.
function load({ platform = 'android', clipApi = true, glassSupported = true } = {}) {
  const requested: Binding[] = [];
  const bindings = new Map<string | undefined, Binding>();
  const updatePlayerSurfaceClip = () => {};
  let lookups = 0;
  const native = { isSupported: glassSupported, ...(clipApi ? { updatePlayerSurfaceClip } : {}) };
  const react = { forwardRef: (render: (props: object, ref: unknown) => Element) =>
    (props: object) => render(props, null) };
  const exports: Record<string, any> = {};
  runInNewContext(compiled, { exports, require(name: string) {
    if (name === 'react') return { __esModule: true, default: react };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { Platform: { OS: platform }, View: 'FallbackView',
      processColor: (value: unknown) => typeof value === 'number' ? value : value === 'transparent' ? 0 : 0xff123456 };
    if (name === 'expo') return {
      requireOptionalNativeModule(moduleName: string) {
        assert.equal(moduleName, 'ResonusLiquidGlass'); lookups++; return native;
      },
      requireNativeView(moduleName: string, viewName?: string) {
        const value = { moduleName, viewName }; requested.push(value); bindings.set(viewName, value); return value;
      },
    };
    assert.fail(`Unexpected surface-clip runtime import: ${name}`);
  } });
  return { api: exports, bindings, requested, updatePlayerSurfaceClip, lookups: () => lookups };
}

describe('background-only player clip binding', () => {
  it('keeps Glass/tabs on the original default binding and existing controls on their named views', () => {
    const h = load();
    const glass = h.api.LiquidGlassView({ materialPreset: 'amPlus', dark: true, refraction: 24 }) as Element;
    const tabs = h.api.LiquidGlassTabsView({ tabsCount: 3, tabHorizontalInset: 4, tabVerticalInset: 4 }) as Element;
    assert.equal(glass.type, h.bindings.get(undefined));
    assert.equal(tabs.type, glass.type);
    assert.notEqual(glass.type, h.bindings.get('PlayerSurfaceClip'));
    assert.equal(glass.props.materialPreset, 'amPlus');
    assert.equal(glass.props.refraction, 24);
    assert.equal(glass.props.dark, true);
    assert.equal(h.api.LiquidGlassToggle({ value: true }).type, h.bindings.get('LiquidGlassToggle'));
    assert.equal(h.api.LiquidGlassSlider({ value: .5 }).type, h.bindings.get('LiquidGlassSlider'));
  });

  it('uses the explicitly named decorative host and unique event while preserving the raw HostFunction', () => {
    const h = load();
    const child = { testID: 'background-only' };
    const ready = () => {};
    const style = { width: 400, height: 800 };
    const clip = h.api.PlayerSurfaceClipView({ children: child, style, onClipHostReady: ready,
      pointerEvents: 'auto', accessible: true, importantForAccessibility: 'yes' }) as Element;
    assert.equal(clip.type, h.bindings.get('PlayerSurfaceClip'));
    assert.equal(clip.props.children, child);
    assert.equal(clip.props.style, style);
    assert.equal(clip.props.onClipHostReady, ready);
    assert.equal('onMotionHostReady' in clip.props, false);
    assert.equal(clip.props.initialOpacity, 0);
    assert.equal(clip.props.collapsable, false);
    assert.equal(clip.props.pointerEvents, 'none');
    assert.equal(clip.props.accessible, false);
    assert.equal(clip.props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(h.api.updateNativePlayerSurfaceClip, h.updatePlayerSurfaceClip);
  });

  it('does not tie the background clip API to Android 12 glass availability', () => {
    const h = load({ glassSupported: false });
    assert.equal(h.api.isLiquidGlassAvailable, false);
    assert.equal(h.api.isNativePlayerSurfaceClipAvailable, true);
    assert.equal(h.api.PlayerSurfaceClipView({}).type, h.bindings.get('PlayerSurfaceClip'));
    assert.equal(h.api.LiquidGlassView({}).type, 'FallbackView');
  });

  it('retains Glass with an older APK and strips unsupported native clip props from its fallback', () => {
    const h = load({ clipApi: false });
    assert.equal(h.api.updateNativePlayerSurfaceClip, null);
    assert.equal(h.api.isNativePlayerSurfaceClipAvailable, false);
    assert.equal(h.api.LiquidGlassView({}).type, h.bindings.get(undefined));
    const child = { testID: 'background' };
    const fallback = h.api.PlayerSurfaceClipView({ children: child, initialOpacity: 0, onClipHostReady() {} }) as Element;
    assert.equal(fallback.type, 'FallbackView');
    assert.equal(fallback.props.children, child);
    assert.equal(fallback.props.pointerEvents, 'none');
    assert.equal('initialOpacity' in fallback.props, false);
    assert.equal('onClipHostReady' in fallback.props, false);
    assert.equal(h.bindings.has('PlayerSurfaceClip'), false);
  });

  it('never loads Android native bindings for other platforms', () => {
    for (const platform of ['ios', 'web']) {
      const h = load({ platform });
      assert.equal(h.lookups(), 0);
      assert.equal(h.requested.length, 0);
      assert.equal(h.api.PlayerSurfaceClipView({}).props.pointerEvents, 'none');
    }
  });

  it('samples only the public display corner on attachment, with an older-device zero fallback', () => {
    const view = readFileSync(new URL('../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/PlayerSurfaceClipView.kt', import.meta.url), 'utf8');
    assert.match(view, /onClipHostReady\(mapOf\("hostId" to hostToken, "cornerRadius" to attachmentCornerRadiusDp\(\)\)\)/);
    assert.match(view, /if \(Build\.VERSION\.SDK_INT < 31\) return 0f/);
    assert.match(view, /rootWindowInsets\?\.getRoundedCorner\(RoundedCorner\.POSITION_TOP_LEFT\)\?\.radius \?: 0/);
    assert.match(view, /return radius \/ density/);
    assert.equal([...view.matchAll(/attachmentCornerRadiusDp\(\)/g)].length, 2,
      'the helper is called only when publishing attachment readiness, never on a frame update');
    assert.doesNotMatch(view, /getDeclared|reflect\.|displayCornerRadius/);
  });

  it('protects the installed Expo first-View alias and native RN/RNGH touch contract', () => {
    const module = readFileSync(new URL('../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/LiquidGlassModule.kt', import.meta.url), 'utf8');
    const registrations = [...module.matchAll(/\bView\((\w+)::class\)\s*\{/g)].map((match) => match[1]);
    assert.equal(registrations[0], 'LiquidGlassView');
    assert.ok(registrations.indexOf('PlayerSurfaceClipView') > 0);
    assert.match(module, /View\(PlayerSurfaceClipView::class\)\s*\{\s*Name\("PlayerSurfaceClip"\)\s*Events\("onClipHostReady"\)/);
    const expo = readFileSync(new URL('../node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/modules/ModuleDefinitionBuilder.kt', import.meta.url), 'utf8');
    assert.match(expo, /if \(!viewManagerDefinitions\.contains\(DEFAULT_MODULE_VIEW\)\)\s*\{\s*viewManagerDefinitions\[DEFAULT_MODULE_VIEW\] = definition/);
    const view = readFileSync(new URL('../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/PlayerSurfaceClipView.kt', import.meta.url), 'utf8');
    assert.match(view, /class PlayerSurfaceClipView[^\n]*ReactPointerEventsView/);
    assert.match(view, /override val pointerEvents:\s*PointerEvents\s+get\(\)\s*=\s*PointerEvents\.NONE/);
    const rn = readFileSync(new URL('../node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt', import.meta.url), 'utf8');
    assert.match(rn, /if \(view is ReactPointerEventsView\)\s*\{\s*view\.pointerEvents/);
    const rngh = readFileSync(new URL('../node_modules/react-native-gesture-handler/android/src/main/java/com/swmansion/gesturehandler/react/RNViewConfigurationHelper.kt', import.meta.url), 'utf8');
    assert.match(rngh, /if \(view is ReactPointerEventsView\)\s*\{\s*\(view as ReactPointerEventsView\)\.pointerEvents/);
  });
});
