import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function productionRenderer(path: string, name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn);
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(fn.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, ...globals, require: (id: string) => {
      assert.equal(id, 'react/jsx-runtime'); return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
    } });
  return exports[name];
}

test('the production decorative renderer retains only explicitly requested ordinary static material without changing optics', () => {
  const profile = { blur: 9, refraction: 26, refractionHeight: 13, highlightWidth: 1.2, highlightOpacity: 0.64,
    depthEffect: true, chromaticAberration: true, tintColor: '#123456', tintOpacity: 0.33 };
  const render = productionRenderer('../src/components/glass/index.tsx', 'GlassBackdrop', {
    useTheme: () => ({ surface: '#444444' }), useThemeMode: () => 'dark',
    useGlassTuning: (select: (state: unknown) => unknown) => select({ mode: 'custom', overrides: { controls: {} }, amPlusOverrides: { controls: {} } }),
    getKyantGlassProfile: () => profile, resolveGlassProfile: () => profile,
    sanitizeGlassOverrides: (value: unknown) => value, glassMaterialTuningMask: () => 0,
    StyleSheet: { absoluteFill: { position: 'absolute' } }, isLiquidGlassAvailable: true, LiquidGlassView: 'NativeGlass', View: 'Fallback',
  });
  const { props } = render({ staticBackdropColor: '#111111', retainCompositionWhenClipped: true, radius: 22 });
  assert.equal(props.retainCompositionWhenClipped, true); assert.equal(props.renderToHardwareTextureAndroid, undefined);
  assert.equal(props.staticBackdropColor, '#111111'); assert.equal(props.radius, 22); assert.equal(props.dark, true);
  for (const key of ['refraction', 'refractionHeight', 'highlightWidth', 'highlightOpacity', 'depthEffect', 'chromaticAberration', 'tintOpacity']) assert.equal(props[key], profile[key as keyof typeof profile]);
  assert.equal(props.blur, 9); assert.equal(props.children, undefined, 'text and album art remain outside the retained decoration');
  assert.equal(render({ staticBackdropColor: '#111111' }).props.retainCompositionWhenClipped, false, 'other static settings cards keep the original default');
  assert.equal(render({ retainCompositionWhenClipped: true }).props.retainCompositionWhenClipped, false);
  for (const variant of ['button', 'subtle', 'prominent']) assert.equal(render({ variant, staticBackdropColor: '#111111', retainCompositionWhenClipped: true }).props.retainCompositionWhenClipped, false);
  profile.tintColor = '#abcdef'; assert.equal(render({ staticBackdropColor: '#222222', retainCompositionWhenClipped: true }).props.tintColor, '#abcdef');
});

test('the real Expo native wrapper defaults retention off and forwards an explicit opt-in', () => {
  const render = productionRenderer('../modules/liquid-glass/index.tsx', 'LiquidGlassView', {
    NativeGlass: 'ActualExpoNativeGlass', isLiquidGlassAvailable: true, View: 'Fallback', processColor: (value: unknown) => value === '#ffffff' ? 0xffffffff : 0,
  });
  assert.equal(render({ staticBackdropColor: '#ffffff' }).props.retainCompositionWhenClipped, false);
  const { props } = render({ staticBackdropColor: '#ffffff', retainCompositionWhenClipped: true });
  assert.equal(props.retainCompositionWhenClipped, true); assert.equal(props.staticBackdropColor, 0xffffffff);
  assert.equal(props.renderToHardwareTextureAndroid, undefined); assert.equal(props.children, undefined);
});

test('real React release and mode updates are wired through SDK57 hooks while normal clipping cleanup remains intact', () => {
  const module = readFileSync(new URL('../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/LiquidGlassModule.kt', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/LiquidGlassView.kt', import.meta.url), 'utf8');
  assert.match(module, /OnViewDestroys \{ view: LiquidGlassView -> view\.releaseClippedComposition\(\) \}/);
  assert.match(module, /OnViewDidUpdateProps \{ view: LiquidGlassView -> view\.synchronizeClippedCompositionLifetime\(\) \}/);
  assert.match(view, /DisposeOnLifecycleDestroyed\(owner\)/);
  assert.match(view, /setViewTreeLifecycleOwner\(activity\)/); assert.match(view, /setViewTreeSavedStateRegistryOwner\(activity\)/);
  assert.match(view, /retainCompositionWhenClipped && staticBackdropColor != null && glassEnabled/);
  assert.match(view, /tabsCount == 0 && dockCompactWidth <= 0f && !progressiveBlur/);
  assert.match(view, /override fun onDetachedFromWindow\(\)[\s\S]*?detachBackdrop\(\)[\s\S]*?super\.onDetachedFromWindow\(\)/);
  assert.doesNotMatch(view, /setLayerType\(/);
});
