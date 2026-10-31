import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function harness(os = 'android') {
  const refs: { current: unknown }[] = []; const calls: { tag: number; nativeId: string }[] = [];
  let cursor = 0, opens = 0, applied = true;
  let finish: ((value: boolean) => void) | undefined;
  const exported: Record<string, any> = {};
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  const imports: Record<string, unknown> = {
    react: { useId: () => '_r_photo_', useRef: (value: unknown) => refs[cursor++] ??= { current: value }, useCallback: (read: unknown) => read },
    'react/jsx-runtime': { jsx },
    'react-native': { Platform: { OS: os }, Pressable: 'Pressable', StyleSheet: { absoluteFill: {} },
      findNodeHandle: (node: { tag: number }) => node.tag },
    '@/i18n': { useT: () => (key: string) => key },
    '../../../modules/liquid-glass': { disableNativeViewFocusHighlight: (tag: number, nativeId: string) => {
      calls.push({ tag, nativeId });
      return applied ? Promise.resolve(true) : new Promise<boolean>((resolve) => { finish = resolve; });
    } },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/volta/VoltaArtistPhotoTarget.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: exported, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const render = () => { cursor = 0; return exported.VoltaArtistPhotoTarget({ onOpen: () => opens++, children: 'photo' }); };
  return { render, calls, opens: () => opens, defer: () => { applied = false; }, resolve: (value: boolean) => finish!(value) };
}

test('the photographic button keeps touch, keyboard and accessibility activation while changing only its native focus drawable', async () => {
  const h = harness(); const tree = h.render();
  assert.equal(tree.props.focusable, true); assert.equal(tree.props.accessible, true);
  assert.equal(tree.props.accessibilityRole, 'imagebutton'); assert.equal(tree.props.accessibilityLabel, 'View image');
  assert.equal(tree.props.importantForAccessibility, 'yes'); assert.equal(tree.props.collapsable, false);
  tree.props.onPress(); assert.equal(h.opens(), 1);
  tree.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }); assert.equal(h.opens(), 2);
  tree.props.onAccessibilityAction({ nativeEvent: { actionName: 'escape' } }); assert.equal(h.opens(), 2);
  tree.props.ref.current = { tag: 42 };
  tree.props.onLayout(); tree.props.onLayout(); await Promise.resolve();
  assert.equal(h.calls.length, 1, 'layout repeats do not schedule per-frame or duplicate native work');
  assert.equal(h.calls[0].tag, 42); assert.equal(h.calls[0].nativeId, tree.props.nativeID);
  tree.props.onFocus(); assert.equal(h.calls.length, 2, 'an infrequent native focus event can retry attachment without changing focus semantics');
  const next = h.render(); next.props.ref.current = { tag: 43 }; next.props.onLayout();
  assert.equal(h.calls.length, 3, 'a genuinely new native view receives its own one-time adjustment');
  const ios = harness('ios'); const nativeFree = ios.render(); nativeFree.props.ref.current = { tag: 44 }; nativeFree.props.onLayout();
  assert.equal(ios.calls.length, 0); assert.equal(nativeFree.props.accessible, true);
});

test('a late failed command cannot reconfigure an unmounted or replaced view', async () => {
  const h = harness(); h.defer(); const tree = h.render(); tree.props.ref.current = { tag: 42 }; tree.props.onLayout();
  tree.props.ref.current = null; h.resolve(false); await Promise.resolve();
  const next = h.render(); next.props.ref.current = { tag: 43 }; next.props.onLayout();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].tag, 43);
});
