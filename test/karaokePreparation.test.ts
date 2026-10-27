import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as lyricMotion from '../src/lib/lyricMotion';
import * as lyricLifecycle from '../src/lib/lyricLifecycle';

type Element = { type: any; key?: string; props: Record<string, any> };
type Scope = { slots: any[]; cursor: number; cleanups: Set<() => void> };
const jsx = (type: unknown, props: object, key?: string) => ({ type, props, key });

// Execute every real component, hook, timing plan and animated style. The
// native boundaries retain identities by their React type/key path so a warm
// row's MaskedView/word layers can be distinguished from fresh cold mounts.
function harness() {
  let current!: Scope;
  const scopes = new Map<string, Scope>();
  const effects: (() => void)[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 0, newMasks = 0, newValues = 0, writes = 0;
  let nodes = new Map<string, unknown>();
  const store = { positionSec: 1, isPlaying: true, speed: 1 };
  const selections: unknown[] = [];
  const values: any[] = [];
  const slot = <T,>(create: () => T): T => current.slots[current.cursor++] ??= create();
  const changed = (left?: unknown[], right?: unknown[]) => !left || !right || left.length !== right.length
    || left.some((value, index) => !Object.is(value, right[index]));
  const effect = (create: () => void | (() => void), deps: unknown[]) => {
    const owner = current;
    const state = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as (() => void) | undefined }));
    if (!changed(state.deps, deps)) return;
    state.deps = deps;
    effects.push(() => { if (state.cleanup) { owner.cleanups.delete(state.cleanup); state.cleanup(); }
      state.cleanup = create() || undefined; if (state.cleanup) owner.cleanups.add(state.cleanup); });
  };
  const animated = { __esModule: true, default: { View: 'AnimatedView' },
    useSharedValue: (initial: number) => slot(() => {
      newValues++;
      const value = { current: initial, animation: undefined as any,
        get value() { return this.current; },
        set value(next: any) { if (next?.timing) this.animation = next; else { this.current = next; this.animation = undefined; } },
        get() { return this.value; }, set(next: any) { this.value = next; } };
      values.push(value); return value;
    }),
    useAnimatedStyle: (read: () => unknown) => ({ read }), useReducedMotion: () => false,
    cancelAnimation: (value: any) => { value.animation = undefined; },
    withTiming: (target: number, options: object) => ({ timing: true, target, ...options }),
    Easing: { linear: 'linear' }, ReduceMotion: { Never: 'never' },
  };
  const dependencies: Record<string, any> = {
    react: { memo: (component: unknown) => component, useRef: (initial: unknown) => slot(() => ({ current: initial })),
      useState: (initial: unknown) => { const state = slot(() => ({ value: initial })); return [state.value, (value: unknown) => {
        writes++; state.value = value;
      }]; }, useEffect: effect, useLayoutEffect: effect,
      useMemo: (create: () => unknown, deps: unknown[]) => {
        const state = slot(() => ({ value: undefined as unknown, deps: undefined as unknown[] | undefined }));
        if (changed(state.deps, deps)) { state.deps = deps; state.value = create(); } return state.value;
      } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: (styles: object) => styles, absoluteFill: { position: 'absolute' } } },
    'react-native-reanimated': animated,
    '@react-native-masked-view/masked-view': { __esModule: true, default: 'MaskedView' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '@/lib/lyricMotion': lyricMotion, '@/lib/lyricLifecycle': lyricLifecycle,
    '@/theme/motion': { motion: { duration: { depth: 720 } } },
    '@/store/player': { usePlayerStore: (select: (state: typeof store) => unknown) => {
      const value = select(store); selections.push(value); return value;
    } },
  };
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/KaraokeWords.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, { exports, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, setTimeout(callback: () => void, delay: number) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id: number) { timers.delete(id); } });
  let props: Record<string, any> = { words: Array.from({ length: 8 }, (_, i) => ({ value: `word${i}`, start: 1000 + i * 200 })),
    highlighted: false, warm: false, active: true, centered: false, textStyle: { fontSize: 28, lineHeight: 36 },
    activeColor: '#FFFFFF', inactiveColor: '#FFFFFF66', paddingVertical: 8 };
  let tree: any;
  const render = (next: object = {}) => {
    props = { ...props, ...next }; newMasks = 0; newValues = 0; selections.length = 0;
    const nextNodes = new Map<string, unknown>();
    const seen = new Set<string>();
    function visit(node: any, path: string): any {
      if (Array.isArray(node)) return node.map((child, index) => visit(child, `${path}.${child?.key ?? index}`));
      if (!node?.props) return node;
      const element = node as Element;
      if (typeof element.type === 'function') {
        const key = `${path}:${element.type.name}`; seen.add(key);
        if (!scopes.has(key)) scopes.set(key, { slots: [], cursor: 0, cleanups: new Set() });
        current = scopes.get(key)!; current.cursor = 0;
        return visit(element.type(element.props), `${key}.result`);
      }
      if (element.type === 'MaskedView' && nodes.get(path) !== element.type) newMasks++;
      nextNodes.set(path, element.type);
      return { ...element, props: { ...element.props, children: visit(element.props.children, `${path}.children`),
        maskElement: visit(element.props.maskElement, `${path}.mask`) } };
    }
    tree = visit(jsx(exports.KaraokeWords, props), 'row');
    for (const [key, scope] of scopes) if (!seen.has(key)) { for (const cleanup of scope.cleanups) cleanup(); scopes.delete(key); }
    while (effects.length) effects.shift()!();
    nodes = nextNodes;
    return tree;
  };
  return { render, store, values, selections, timers,
    masks: () => [...nodes.values()].filter((type) => type === 'MaskedView').length,
    newMasks: () => newMasks, newValues: () => newValues, writes: () => writes,
    prepare() { const pending = [...timers.values()]; timers.clear(); for (const timer of pending) timer.callback(); },
    unmount() { for (const scope of scopes.values()) for (const cleanup of scope.cleanups) cleanup(); scopes.clear(); },
  };
}

function find(node: any, type: string): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, type));
  if (!node?.props) return [];
  return [...(node.type === type ? [node] : []), ...find(node.props.children, type)];
}

test('cold takeover allocates per-word mask layers while a prepared next row reuses all of them', () => {
  const cold = harness(); cold.render(); assert.equal(cold.masks(), 0);
  cold.render({ highlighted: true }); assert.equal(cold.newMasks(), 8);
  const warm = harness(); warm.render({ warm: true });
  assert.equal([...warm.timers.values()][0].delay, 720);
  warm.prepare(); warm.render(); assert.equal(warm.newMasks(), 8);
  warm.render({ warm: false, highlighted: true });
  assert.equal(warm.masks(), 8);
  assert.equal(warm.newMasks(), 0, 'the line boundary reuses existing native mask identities');
  assert.equal(warm.newValues(), 0, 'word clocks and measured dimensions also retain their lifetime');
  assert.equal(warm.values[0].animation.duration, 1200);
});

test('prepared text stays fully filled and motionless without subscribing its clock to audio updates', () => {
  const h = harness(); h.render({ warm: true }); h.prepare();
  const tree = h.render();
  assert.deepEqual(h.selections, [0, false, 1]);
  for (const view of find(tree, 'AnimatedView').filter((view) => view.props.onLayout)) {
    view.props.onLayout({ nativeEvent: { layout: { width: 80, height: 36 } } });
    assert.deepEqual(JSON.parse(JSON.stringify(view.props.style.read())), { transform: [{ scale: 1 }] });
  }
  const solid = find(tree, 'AnimatedView').filter((view) => Array.isArray(view.props.style) && view.props.style[0]?.left === 0);
  assert.equal(solid.length, 8);
  assert.ok(solid.every((view) => view.props.style[2].read().width === 80));
  assert.ok(h.values.every((value) => value.animation === undefined));
});

test('preparation remains bounded to the current and requested next row and cancels across words, roles and unmount', () => {
  const h = harness(); h.render({ warm: true });
  const stale = [...h.timers.values()][0].callback;
  h.render({ warm: false }); stale(); h.render(); assert.equal(h.masks(), 0);
  h.render({ warm: true });
  h.render({ words: [{ value: 'replacement', start: 5000 }] });
  h.prepare(); h.render(); assert.equal(h.masks(), 1);
  h.render({ warm: false }); assert.equal(h.masks(), 0);
  h.render({ warm: true });
  const afterUnmount = [...h.timers.values()][0].callback;
  const writes = h.writes(); h.unmount(); afterUnmount();
  assert.equal(h.writes(), writes);
  assert.equal(h.timers.size, 0);
});

test('taking over before preparation settles preserves the existing fast-line path and inactive clocks remain frozen', () => {
  const h = harness(); h.render({ warm: true });
  h.render({ highlighted: true, warm: false });
  assert.equal(h.masks(), 8);
  assert.equal(h.timers.size, 0);
  const clock = h.values[0]; clock.value = 1700;
  h.render({ active: false });
  assert.equal(clock.value, 1700);
  assert.equal(clock.animation, undefined);
  assert.equal(h.newMasks(), 0);
});
