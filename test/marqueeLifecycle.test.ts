import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Element = { type: unknown; key?: string; props: Record<string, any> };
type Animation = { kind: string; target?: number; config?: Record<string, any>; animations?: Animation[];
  next?: Animation; delay?: number; repetitions?: number };
type Effect = { kind: 'layout' | 'focus'; pending: boolean; active: boolean;
  create: () => void | (() => void); deps?: unknown[]; cleanup?: () => void };
const jsx = (type: unknown, props: Record<string, any>, key?: string): Element => ({ type, props, key });

// Run the actual component AND its foreground/focus hook. Only native clocks,
// React scheduling and JSX reconciliation identities are represented here.
function harness(initial: Record<string, any> = {}) {
  let cursor = 0, focused = true;
  const slots: any[] = [], effects = new Set<Effect>(), ui: (() => void)[] = [];
  const listeners = new Set<(state: string) => void>();
  const starts: Animation[] = [];
  const values: { value: number; animation?: Animation; get(): number; set(next: number | Animation): void }[] = [];
  const slot = <T,>(create: () => T): T => slots[cursor++] ??= create();
  const changed = (old?: unknown[], next?: unknown[]) => !old || !next || old.length !== next.length
    || old.some((value, i) => !Object.is(value, next[i]));
  const effect = (kind: Effect['kind'], create: Effect['create'], deps: unknown[]) => {
    const entry = slot<Effect>(() => {
      const value = { kind, create, pending: true, active: false };
      effects.add(value); return value;
    });
    if (changed(entry.deps, deps)) { entry.deps = deps; entry.create = create; entry.pending = true; }
  };
  const react = {
    useState: (initialValue: unknown) => {
      const state = slot(() => ({ value: initialValue }));
      return [state.value, (value: unknown) => { state.value = value; }];
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const saved = slot(() => ({ value: callback, deps: undefined as unknown[] | undefined }));
      if (changed(saved.deps, deps)) { saved.value = callback; saved.deps = deps; }
      return saved.value;
    },
    useLayoutEffect: (create: Effect['create'], deps: unknown[]) => effect('layout', create, deps),
  };
  const appState = { currentState: 'active', addEventListener(_name: string, callback: (state: string) => void) {
    listeners.add(callback); return { remove() { listeners.delete(callback); } };
  } };
  const dependencies: Record<string, any> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ScrollView: 'ScrollView', Text: 'Text', View: 'View', AppState: appState,
      StyleSheet: { create: (style: unknown) => style } },
    'expo-router': { useFocusEffect: (create: Effect['create']) => effect('focus', create, [create]) },
    'react-native-worklets': { scheduleOnUI: (callback: () => void) => ui.push(callback) },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: (initialValue: number) => slot(() => {
        const value = { value: initialValue, animation: undefined as Animation | undefined,
          get() { return this.value; }, set(next: number | Animation) {
            if (typeof next === 'number') { this.value = next; this.animation = undefined; }
            else { this.animation = next; starts.push(next); }
          } };
        values.push(value); return value;
      }),
      useAnimatedStyle: (read: () => unknown) => ({ read }),
      cancelAnimation: (value: typeof values[number]) => { value.animation = undefined; },
      withTiming: (target: number, config: object) => ({ kind: 'timing', target, config }),
      withDelay: (delay: number, next: Animation) => ({ kind: 'delay', delay, next }),
      withRepeat: (next: Animation, repetitions: number) => ({ kind: 'repeat', next, repetitions }),
      withSequence: (_reduceMotion: string, ...animations: Animation[]) => ({ kind: 'sequence', animations }),
      Easing: { linear: 'linear' }, ReduceMotion: { Never: 'never' },
    },
  };
  function load(file: string) {
    const source = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports: Record<string, any> = {};
    runInNewContext(source, { exports, require(id: string) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected marquee import ${id}`); return dependencies[id];
    } });
    return exports;
  }
  dependencies['@/hooks/useForegroundEffect'] = load('hooks/useForegroundEffect.ts');
  const component = load('components/MarqueeText.tsx');
  let props = { text: 'A long title', enabled: true, active: true, ...initial };
  let tree!: Element;
  let nextNativeId = 1;
  let nativeIds = new Map<string, number>();
  function commit(kind: Effect['kind']) {
    for (const entry of effects) {
      if (entry.kind !== kind || !entry.pending) continue;
      entry.cleanup?.(); entry.cleanup = undefined; entry.active = false;
      if (kind === 'focus' && !focused) continue;
      entry.pending = false; entry.active = true; entry.cleanup = entry.create() || undefined;
    }
  }
  function render(next: Record<string, any> = {}) {
    props = { ...props, ...next }; cursor = 0; tree = component.MarqueeText(props);
    const ids = new Map<string, number>();
    function visit(node: unknown, path: string) {
      if (Array.isArray(node)) { node.forEach((child, index) => visit(child, `${path}.${index}`)); return; }
      if (!node || typeof node !== 'object' || !('props' in node)) return;
      const element = node as Element;
      const key = `${path}:${String(element.type)}:${element.key ?? ''}`;
      ids.set(key, nativeIds.get(key) ?? nextNativeId++);
      visit(element.props.children, key);
    }
    visit(tree, 'root'); nativeIds = ids;
    commit('layout'); commit('focus'); return tree;
  }
  function find(node: unknown, predicate: (element: Element) => boolean): Element[] {
    if (Array.isArray(node)) return node.flatMap((child) => find(child, predicate));
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Element;
    return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
  }
  const flushUI = () => { while (ui.length) ui.shift()!(); };
  render(); flushUI();
  return { render, starts, values, flushUI, animation: () => values[0].animation,
    ids: () => [...nativeIds.entries()],
    pendingUI: () => ui.length,
    measure(containerWidth = 120, textWidth = 300) {
      tree.props.onLayout({ nativeEvent: { layout: { width: containerWidth } } });
      find(tree, (node) => node.type === 'Text' && !!node.props.onLayout)[0]
        .props.onLayout({ nativeEvent: { layout: { width: textWidth } } });
      render(); flushUI();
    },
    focus(value: boolean) {
      focused = value;
      if (!focused) {
        for (const entry of effects) if (entry.kind === 'focus') {
          entry.cleanup?.(); entry.cleanup = undefined; entry.active = false; entry.pending = true;
        }
      } else commit('focus');
    },
    foreground(value: string) { appState.currentState = value; for (const callback of listeners) callback(value); },
    unmount() { for (const entry of effects) entry.cleanup?.(); effects.clear(); },
  };
}

test('explicit activity pauses preserve the measured native overflow tree and resume the remaining pass at the same speed', () => {
  const h = harness(); h.measure();
  const offset = h.values[0];
  assert.equal(h.animation()?.kind, 'repeat');
  offset.value = -78;
  const identities = h.ids();
  h.render({ active: false }); h.flushUI();
  assert.equal(offset.get(), -78);
  assert.equal(h.animation(), undefined, 'covered mini has no running native clock');
  assert.deepEqual(h.ids(), identities, 'neither measurer nor duplicated overflow text remounts on coverage');
  const starts = h.starts.length;
  h.render(); h.flushUI(); assert.equal(h.starts.length, starts); assert.equal(h.pendingUI(), 0);
  h.render({ active: true }); h.flushUI();
  assert.equal(offset.get(), -78, 'the first return frame does not snap to zero');
  assert.deepEqual(h.ids(), identities);
  const resumed = h.animation()!;
  assert.equal(resumed.kind, 'sequence');
  assert.equal(resumed.animations![0].target, -348);
  assert.equal(resumed.animations![0].config!.duration, 9000, '270 remaining pixels retain 30 pixels/second');
  assert.equal(resumed.animations![1].target, 0);
  assert.equal(resumed.animations![1].config!.duration, 0);
  assert.equal(resumed.animations![2].kind, 'repeat');
  assert.equal(resumed.animations![2].next!.delay, 2500);
  assert.equal(resumed.animations![2].next!.next!.config!.duration, 11600, 'subsequent full passes keep their full duration');
});

test('foreground/focus cleanup stops clocks while preserving explicit activity pose, including queued starts and unmount', () => {
  const h = harness(); h.measure(); const offset = h.values[0]; offset.value = -45;
  h.foreground('background'); h.flushUI();
  assert.equal(h.animation(), undefined); assert.equal(offset.get(), -45);
  h.foreground('active'); h.flushUI(); assert.equal(h.animation()?.kind, 'sequence');
  assert.equal(offset.get(), -45);
  h.focus(false); h.flushUI(); assert.equal(h.animation(), undefined);
  h.focus(true); h.flushUI(); assert.equal(h.animation()?.kind, 'sequence');
  h.render({ active: false }); h.render({ active: true }); h.render({ active: false }); h.flushUI();
  assert.equal(h.animation(), undefined, 'the last queued lifecycle state wins');
  assert.equal(offset.get(), -45);
  h.unmount(); h.flushUI(); assert.equal(h.animation(), undefined);
});

test('real title, measured-width and enabled endpoint changes reset the pass without starting hidden work', () => {
  const h = harness(); h.measure(); const offset = h.values[0]; offset.value = -80;
  h.render({ active: false, text: 'A different title' }); h.flushUI();
  assert.equal(offset.get(), 0); assert.equal(h.animation(), undefined);
  h.measure(100, 260); assert.equal(offset.get(), 0); assert.equal(h.animation(), undefined);
  h.render({ active: true }); h.flushUI(); assert.equal(h.animation()?.kind, 'repeat');
  offset.value = -50; h.measure(110, 260);
  assert.equal(offset.get(), 0); assert.equal(h.animation()?.kind, 'repeat');
  h.render({ enabled: false }); h.flushUI();
  assert.equal(offset.get(), 0); assert.equal(h.animation(), undefined);
  h.render({ enabled: true }); h.flushUI(); h.measure(110, 70);
  assert.equal(h.animation(), undefined, 'a fitted short title has no animation');
});

test('callers that omit activity keep the original default foreground restart behavior', () => {
  const h = harness({ active: undefined }); h.measure(); const offset = h.values[0];
  offset.value = -65; h.foreground('background'); h.flushUI(); assert.equal(h.animation(), undefined);
  h.foreground('active'); h.flushUI();
  assert.equal(offset.get(), 0);
  assert.equal(h.animation()?.kind, 'repeat');
});
