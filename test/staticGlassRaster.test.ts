import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** Execute the production renderer, not a second implementation of its policy. */
function renderer(path: string, name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration);
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, ...globals, require: (id: string) => {
    assert.equal(id, 'react/jsx-runtime');
    return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
  } });
  return exports[name];
}

function backdropHarness() {
  const profile = { blur: 9, refraction: 26, refractionHeight: 13, highlightWidth: 1.2, highlightOpacity: 0.64,
    depthEffect: true, chromaticAberration: true, tintColor: '#123456', tintOpacity: 0.33 };
  let dark = false, mode = 'custom';
  const render = renderer('../src/components/glass/index.tsx', 'GlassBackdrop', {
    useTheme: () => ({ surface: '#444444' }), useThemeMode: () => dark ? 'dark' : 'light',
    useGlassTuning: (select: (state: unknown) => unknown) => select({ mode, overrides: { controls: {} }, amPlusOverrides: { controls: {} } }),
    getKyantGlassProfile: () => profile, resolveGlassProfile: () => profile,
    sanitizeGlassOverrides: (value: unknown) => value, glassMaterialTuningMask: () => 0,
    StyleSheet: { absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
    isLiquidGlassAvailable: true, LiquidGlassView: 'NativeGlassDecoration', View: 'FallbackView',
  });
  return { render, profile, setDark: () => { dark = true; }, setMode: (value: string) => { mode = value; } };
}

test('only explicit static ordinary decorations receive a hardware raster layer; all optics remain exact', () => {
  const h = backdropHarness();
  for (const mode of ['custom', 'kyantDefault', 'amPlus']) {
    h.setMode(mode);
    const { props, type } = h.render({ staticBackdropColor: '#eeeeee', radius: 22 });
    assert.equal(type, 'NativeGlassDecoration');
    assert.equal(props.renderToHardwareTextureAndroid, true);
    assert.equal(props.pointerEvents, 'none'); assert.equal(props.children, undefined, 'foreground text/artwork never join the raster cache');
    assert.equal(props.radius, 22); assert.equal(props.staticBackdropColor, '#eeeeee');
    for (const key of ['refraction', 'refractionHeight', 'highlightWidth', 'highlightOpacity', 'depthEffect', 'chromaticAberration', 'tintOpacity']) {
      assert.equal(props[key], h.profile[key as keyof typeof h.profile], `rasterization cannot tune ${key}`);
    }
    assert.equal(props.blur, h.profile.blur);
    for (const variant of ['prominent', 'subtle', 'button']) {
      const control = h.render({ staticBackdropColor: '#eeeeee', variant });
      assert.equal(control.props.renderToHardwareTextureAndroid, false, `${variant} keeps its live recipe`);
      assert.equal(control.props.staticBackdropColor, null);
    }
    assert.equal(h.render({}).props.renderToHardwareTextureAndroid, false, 'a live regular surface remains uncached');
    assert.equal(h.render({ staticBackdropColor: null }).props.renderToHardwareTextureAndroid, false);
  }
});

test('theme/material updates remain native props and removing a static source explicitly releases the cache', () => {
  const h = backdropHarness();
  assert.equal(h.render({ staticBackdropColor: '#eeeeee' }).props.dark, false);
  h.profile.tintColor = '#abcdef'; h.profile.tintOpacity = 0.51; h.profile.refraction = 31;
  h.setDark();
  const changed = h.render({ staticBackdropColor: '#111111', radius: 26, blurred: false }).props;
  assert.equal(changed.dark, true); assert.equal(changed.staticBackdropColor, '#111111');
  assert.equal(changed.radius, 26); assert.equal(changed.blur, 0);
  assert.equal(changed.tintColor, '#abcdef'); assert.equal(changed.tintOpacity, 0.51); assert.equal(changed.refraction, 31);
  const live = h.render({ staticBackdropColor: null }).props;
  assert.equal(live.staticBackdropColor, null); assert.equal(live.renderToHardwareTextureAndroid, false);
  assert.equal(h.render({ staticBackdropColor: '#111111', enabled: false }), null);
});

test('the actual native view wrapper forwards rasterization without wrapping or caching interactive content', () => {
  const render = renderer('../modules/liquid-glass/index.tsx', 'LiquidGlassView', {
    NativeGlass: 'ActualExpoNativeGlass', isLiquidGlassAvailable: true, View: 'Fallback', processColor: (color: unknown) => color === '#ffffff' ? 0xffffffff : 0,
  });
  const result = render({ staticBackdropColor: '#ffffff', renderToHardwareTextureAndroid: true, radius: 22, pointerEvents: 'none' });
  assert.equal(result.type, 'ActualExpoNativeGlass');
  assert.equal(result.props.renderToHardwareTextureAndroid, true);
  assert.equal(result.props.staticBackdropColor, 0xffffffff); assert.equal(result.props.radius, 22);
  assert.equal(result.props.children, undefined);
  assert.equal(render({ staticBackdropColor: null, renderToHardwareTextureAndroid: false }).props.renderToHardwareTextureAndroid, false);
});
