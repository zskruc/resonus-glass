import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { MenuRequestScope } from '@/lib/menuRequest';

type Element = { type: any; key?: string; props: Record<string, any> };
type Scope = { slots: any[]; cursor: number };
const jsx = (type: unknown, props: object, key?: string) => ({ type, props, key });
const pressEvent = () => ({ nativeEvent: { timestamp: 123, target: 42 }, stopPropagation() {} });

// Mount the real speed card, shared frame/header, SheetModal and animation
// hook. Native presses deliberately deliver an event, then exit completion is
// delivered asynchronously, which reproduced the release-only X-button crash.
function harness(kind: 'speed' | 'actions' | 'hook' | 'edges' = 'actions') {
  let current!: Scope;
  const scopes = new Map<string, Scope>(), effects: (() => void)[] = [];
  const endings: ((finished: boolean) => void)[] = [], rn: (() => void)[] = [];
  const calls = { closed: 0, after: 0, defaultClose: 0, speed: 1 };
  const edgeArgs: unknown[][] = [];
  const openRef = { current: () => {} };
  const hook: { current?: any } = {};
  const changed = (a?: unknown[], b?: unknown[]) => !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const slot = <T,>(create: () => T): T => current.slots[current.cursor++] ??= create();
  const memo = (create: () => unknown, deps: unknown[]) => {
    const state = slot(() => ({ deps: undefined as unknown[] | undefined, value: undefined as unknown }));
    if (changed(state.deps, deps)) { state.deps = deps; state.value = create(); }
    return state.value;
  };
  const react = {
    memo: (component: unknown) => component, forwardRef: (component: unknown) => component,
    useState: (initial: unknown) => {
      const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [state.value, (next: unknown) => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (create: () => unknown, deps: unknown[]) => {
      const state = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as any }));
      if (!changed(state.deps, deps)) return;
      effects.push(() => { state.cleanup?.(); state.deps = deps; state.cleanup = create(); });
    },
  };
  const pan: Record<string, any> = {};
  for (const name of ['enabled', 'activeOffsetY', 'failOffsetY', 'onUpdate', 'onEnd']) pan[name] = () => pan;
  const colors = { text: '#FFF', textSecondary: '#CCC', accent: '#0F0', onAccent: '#000', surfaceHighlight: '#333' };
  const imports: Record<string, any> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Modal: 'Modal', ScrollView: 'ScrollView', Pressable: 'Pressable', View: 'View', Text: 'Text',
      Dimensions: { get: () => ({ width: 400, height: 800 }) }, useWindowDimensions: () => ({ width: 400, height: 800, fontScale: 1 }),
      StyleSheet: { absoluteFill: {}, create: (styles: object) => styles } },
    'react-native-gesture-handler': { Gesture: { Pan: () => pan }, GestureHandlerRootView: 'GestureRoot' },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: (value: unknown) => slot(() => ({ value })), useAnimatedStyle: (read: () => unknown) => ({ read }),
      withTiming: (target: number, _options: unknown, done?: (finished: boolean) => void) => { if (done) endings.push(done); return target; } },
    'react-native-worklets': { scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => {
      assert.equal(typeof callback, 'function', 'never schedule a native event as a callback'); rn.push(() => callback(...args));
    } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, right: 0, bottom: 20, left: 0 }) },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/glass': { GlassPressable: 'GlassPressable' }, '@/components/MenuGlassBackdrop': { MenuGlassBackdrop: 'Glass' },
    '@/lib/menuRequest': { MenuRequestScope }, '@/i18n': { useT: () => (value: string) => value },
    '@/theme': { useTheme: () => colors, useThemeMode: () => 'dark', themed: (make: (value: object) => unknown) => make(colors),
      spacing: { sm: 8 }, radius: { lg: 14 }, fontSize: { md: 16 } },
    '@/theme/motion': { SHEET_IN: { duration: 240 }, SHEET_OUT: { duration: 160 } },
    '@/store/player': { PLAYBACK_SPEEDS: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      usePlayerStore: (select: (value: object) => unknown) => select({ speed: calls.speed, setSpeed: (value: number) => { calls.speed = value; } }) },
  };
  function load(file: string) {
    const output = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const api: Record<string, any> = {};
    runInNewContext(output, { exports: api, require(name: string) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected sheet dependency ${name}`); return imports[name];
    } });
    return api;
  }
  const animation = load('hooks/useBottomSheetAnim.ts'); imports['@/hooks/useBottomSheetAnim'] = animation;
  const glass = load('components/MenuGlassCard.tsx'); imports['@/components/MenuGlassCard'] = glass;
  const modal = load('components/SheetModal.tsx'); imports['@/components/SheetModal'] = modal;
  const speed = load('components/SpeedSheet.tsx');
  function HookOnly() { hook.current = animation.useBottomSheetAnim(true, () => { calls.defaultClose++; }, 'card'); return null; }
  const edgeClose = (...args: unknown[]) => { edgeArgs.push(args); };
  const root = () => kind === 'edges' ? jsx(glass.MenuGlassCardFrame, { onClose: edgeClose,
    children: jsx(glass.MenuGlassCardHeader, { title: 'Edges', onClose: edgeClose }) })
    : kind === 'hook' ? jsx(HookOnly, {}) : kind === 'speed' ? jsx(speed.SpeedSheet, { openRef }) : jsx(modal.SheetModal, {
    openRef, presentation: 'card', onClosed: () => { calls.closed++; },
    children: (close: (after?: unknown) => void) => jsx('View', { children: [
      jsx(glass.MenuGlassCardHeader, { title: 'Test', onClose: close }),
      jsx('Pressable', { testID: 'direct-option', onPress: close }),
      jsx('Pressable', { testID: 'plain-option', onPress: () => close() }),
      jsx('Pressable', { testID: 'after-option', onPress: () => close(() => { calls.after++; }) }),
    ] }),
  });
  let tree: any;
  const render = () => {
    function visit(node: any, path: string): any {
      if (Array.isArray(node)) return node.map((child, index) => visit(child, `${path}.${child?.key ?? index}`));
      if (!node?.props) return node;
      if (typeof node.type === 'function') {
        const key = `${path}:${node.type.name}`;
        current = scopes.get(key) ?? { slots: [], cursor: 0 }; scopes.set(key, current); current.cursor = 0;
        return visit(node.type(node.props), `${key}.result`);
      }
      return { ...node, props: { ...node.props, children: visit(node.props.children, `${path}.children`) } };
    }
    tree = visit(root(), 'root'); while (effects.length) effects.shift()!(); return tree;
  };
  const find = (type: string, predicate: (props: any) => boolean = () => true): Element[] => {
    function visit(node: any): Element[] {
      if (Array.isArray(node)) return node.flatMap(visit);
      if (!node?.props) return [];
      return [...(node.type === type && predicate(node.props) ? [node] : []), ...visit(node.props.children)];
    }
    return visit(tree);
  };
  render(); if (kind !== 'hook' && kind !== 'edges') { openRef.current(); render(); }
  return { calls, hook, find, render, openRef, endings, edgeArgs,
    press(type: string, predicate?: (props: any) => boolean) { const item = find(type, predicate)[0]; assert.ok(item); item.props.onPress(pressEvent()); },
    finish() { for (const done of endings.splice(0)) done(true); while (rn.length) rn.shift()!(); render(); },
    visible: () => find('Modal')[0]?.props.visible,
  };
}

test('the actual SpeedSheet X accepts a native press event and closes without executing it', () => {
  const h = harness('speed'); assert.equal(h.visible(), true);
  assert.doesNotThrow(() => h.press('GlassPressable', (props) => props.accessibilityLabel === 'Close'));
  assert.doesNotThrow(() => h.finish()); assert.equal(h.visible(), false);
});

test('the real shared X and backdrop discard native arguments before calling the public close callback', () => {
  const h = harness('edges');
  h.press('GlassPressable', (props) => props.accessibilityLabel === 'Close');
  h.press('Pressable', (props) => props.accessibilityLabel === 'Close');
  assert.deepEqual(h.edgeArgs, [[], []]);
});

test('shared sheets close from backdrop, system Back, direct onPress and options without a callback', () => {
  for (const source of ['backdrop', 'back', 'direct-option', 'plain-option']) {
    const h = harness();
    if (source === 'back') h.find('Modal')[0].props.onRequestClose(pressEvent());
    else h.press('Pressable', (props) => source === 'backdrop' ? props.accessibilityLabel === 'Close' : props.testID === source);
    assert.equal(h.calls.closed, 0, 'keep the surface mounted until exit completes');
    assert.doesNotThrow(() => h.finish());
    assert.equal(h.calls.closed, 1, source); assert.equal(h.calls.after, 0, source); assert.equal(h.visible(), false);
  }
});

test('a valid after action runs once after exit, even with another close press during dismissal', () => {
  const h = harness(); h.press('Pressable', (props) => props.testID === 'after-option');
  h.press('GlassPressable', (props) => props.accessibilityLabel === 'Close');
  assert.equal(h.endings.length, 1);
  assert.equal(h.calls.after, 0); h.finish();
  assert.equal(h.calls.closed, 1); assert.equal(h.calls.after, 1); h.finish(); assert.equal(h.calls.after, 1);
});

test('an old exit completion cannot close a newly opened sheet or run its old action', () => {
  const h = harness(); h.press('Pressable', (props) => props.testID === 'after-option');
  h.openRef.current(); h.render(); h.finish();
  assert.equal(h.visible(), true); assert.equal(h.calls.closed, 0); assert.equal(h.calls.after, 0);
});

test('the common animation hook ignores event objects and uses its explicit default close', () => {
  for (const value of [undefined, pressEvent(), null, 'not-a-function']) {
    const h = harness('hook'); h.hook.current.dismiss(value); h.hook.current.dismiss(value);
    assert.equal(h.endings.length, 1); assert.doesNotThrow(() => h.finish()); assert.equal(h.calls.defaultClose, 1);
  }
});

test('changing actual playback speed retains the card until an explicit close', () => {
  const h = harness('speed'); h.press('Pressable', (props) => props.children?.props.children === '1.5×'); h.render();
  assert.equal(h.calls.speed, 1.5); assert.equal(h.visible(), true); assert.equal(h.endings.length, 0);
  h.press('GlassPressable', (props) => props.accessibilityLabel === 'Close'); h.finish(); assert.equal(h.visible(), false);
});
