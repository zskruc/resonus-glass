import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Cleanup = () => void;
type Effect = () => void | Cleanup;
interface EffectSlot {
  kind: 'layout' | 'passive';
  deps: unknown[];
  create: Effect;
  dirty: boolean;
  active: boolean;
  cleanup?: Cleanup;
}

/**
 * Run the real hooks with only React's scheduling and the native boundaries
 * stubbed. Model the installed Fabric Suspense lifecycle explicitly: hide
 * cleans up layout effects and detaches refs, passive subscriptions survive,
 * then reappear attaches refs before replaying layout effects. State and refs
 * survive, and an unchanged passive effect is not remounted by Suspense.
 */
function hookHarness(file: string, dependencies: Record<string, unknown>, contextValue?: unknown) {
  let cursor = 0;
  const slots: unknown[] = [];
  const effects = new Set<EffectSlot>();
  const changed = (a: unknown[], b: unknown[]) => a.length !== b.length
    || a.some((value, i) => !Object.is(value, b[i]));
  const registerEffect = (kind: EffectSlot['kind'], create: Effect, deps: unknown[]) => {
    const index = cursor++;
    let slot = slots[index] as EffectSlot | undefined;
    if (!slot) {
      slot = { kind, deps, create, dirty: true, active: false };
      slots[index] = slot;
      effects.add(slot);
    } else {
      slot.dirty ||= changed(slot.deps, deps);
      slot.deps = deps;
      slot.create = create;
    }
  };
  const react = {
    useRef<T>(value: T): { current: T } {
      const index = cursor++;
      return (slots[index] ??= { current: value }) as { current: T };
    },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      const slot = (slots[index] ??= { value: typeof initial === 'function'
        ? (initial as () => T)() : initial }) as { value: T };
      return [slot.value, (next: T | ((previous: T) => T)) => {
        slot.value = typeof next === 'function' ? (next as (previous: T) => T)(slot.value) : next;
      }];
    },
    useCallback<T>(value: T, deps: unknown[]): T {
      const index = cursor++;
      let slot = slots[index] as { value: T; deps: unknown[] } | undefined;
      if (!slot || changed(slot.deps, deps)) slots[index] = slot = { value, deps };
      return slot.value;
    },
    useLayoutEffect: (create: Effect, deps: unknown[]) => registerEffect('layout', create, deps),
    useEffect: (create: Effect, deps: unknown[]) => registerEffect('passive', create, deps),
    createContext: <T,>(value: T) => ({ value }),
    useContext: <T,>(context: { value: T }) => (contextValue ?? context.value) as T,
  };
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length, 0);
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  runInNewContext(compiled.outputText, {
    exports,
    require(id: string) {
      if (id === 'react') return react;
      if (id in dependencies) return dependencies[id];
      throw new Error(`Unexpected hook runtime import: ${id}`);
    },
    setTimeout(callback: () => void) {
      const timer = nextTimer++;
      timers.set(timer, callback);
      return timer;
    },
    clearTimeout(timer: number) { timers.delete(timer); },
  });
  const flush = (kind: EffectSlot['kind']) => {
    for (const slot of effects) {
      if (slot.kind !== kind || (slot.active && !slot.dirty)) continue;
      slot.cleanup?.();
      slot.cleanup = slot.create() || undefined;
      slot.active = true;
      slot.dirty = false;
    }
  };
  return {
    render(name: string, ...args: unknown[]) { cursor = 0; return exports[name](...args); },
    commit() { flush('layout'); flush('passive'); },
    hide() {
      for (const slot of effects) {
        if (slot.kind !== 'layout' || !slot.active) continue;
        slot.cleanup?.();
        slot.cleanup = undefined;
        slot.active = false;
      }
    },
    unmount() {
      for (const slot of effects) {
        if (!slot.active) continue;
        slot.cleanup?.();
        slot.cleanup = undefined;
        slot.active = false;
      }
    },
    timers,
    tick() { for (const [key, callback] of [...timers]) { timers.delete(key); callback(); } },
  };
}

function imageHarness(settleMs = 0) {
  const calls: string[] = [];
  const makeImage = (name: string) => {
    let animating = false;
    return {
      get animating() { return animating; },
      async startAnimating() { animating = true; calls.push(`${name}:start`); },
      async stopAnimating() { animating = false; calls.push(`${name}:stop`); },
    };
  };
  const image = makeImage('image');
  const ref: { current: typeof image | null } = { current: image };
  const listeners = new Map<string, Set<() => void>>();
  let focused = true;
  const navigation = {
    isFocused: () => focused,
    addListener(event: string, callback: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback);
      return () => listeners.get(event)!.delete(callback);
    },
  };
  const appListeners = new Set<(state: string) => void>();
  const AppState = {
    currentState: 'active',
    addEventListener(_event: string, callback: (state: string) => void) {
      appListeners.add(callback);
      return { remove: () => appListeners.delete(callback) };
    },
  };
  const hooks = hookHarness('../src/hooks/useImageAnimation.ts', {
    'expo-router': { useNavigation: () => navigation }, 'react-native': { AppState },
  });
  const render = (enabled = true, source = 'same.gif') => {
    hooks.render('useImageAnimation', ref, enabled, source, 0, settleMs);
    hooks.commit();
  };
  const app = (state: string) => {
    AppState.currentState = state;
    for (const callback of [...appListeners]) callback(state);
  };
  const focus = (value: boolean) => {
    focused = value;
    for (const callback of [...(listeners.get(value ? 'focus' : 'blur') ?? [])]) callback();
  };
  return { ...hooks, render, calls, image, makeImage, ref, app, focus };
}

describe('background image lifecycle', () => {
  it('restarts the same loaded image after refs return, without another display event', () => {
    const h = imageHarness();
    h.render();
    h.calls.length = 0;
    h.app('background');
    assert.equal(h.calls.at(-1), 'image:stop');
    h.hide();
    h.ref.current = null;
    h.app('active');
    assert.ok(!h.calls.includes('image:start'));
    h.ref.current = h.image;
    h.render();
    assert.equal(h.calls.at(-1), 'image:start');
    assert.equal(h.image.animating, true);
  });

  it('stops the recorded old image even after its ref was replaced', () => {
    const h = imageHarness(150);
    h.render();
    h.ref.current = h.makeImage('replacement');
    h.calls.length = 0;
    h.hide();
    assert.deepEqual(h.calls, ['image:stop']);
    assert.equal(h.image.animating, false);
    assert.equal(h.timers.size, 0);
  });

  it('keeps animation disabled across hide and foreground restoration', () => {
    const h = imageHarness();
    h.render();
    h.render(false);
    h.hide();
    h.ref.current = null;
    h.app('background');
    h.app('active');
    h.calls.length = 0;
    h.ref.current = h.image;
    h.render(false);
    assert.equal(h.image.animating, false);
    assert.ok(!h.calls.includes('image:start'));
  });

  it('keeps a blurred screen stopped after its ref returns', () => {
    const h = imageHarness();
    h.render();
    h.focus(false);
    h.hide();
    h.ref.current = null;
    h.app('background');
    h.app('active');
    h.calls.length = 0;
    h.ref.current = h.image;
    h.render();
    assert.equal(h.image.animating, false);
    assert.ok(!h.calls.includes('image:start'));
    h.focus(true);
    assert.equal(h.calls.at(-1), 'image:start');
  });

  it('cancels settle timers and removes subscriptions on unmount', () => {
    const h = imageHarness(150);
    h.render();
    assert.equal(h.timers.size, 1);
    h.calls.length = 0;
    h.unmount();
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.at(-1), 'image:stop');
    h.app('active');
    h.focus(true);
    h.tick();
    assert.ok(!h.calls.includes('image:start'));
  });
});

describe('background dock lifecycle', () => {
  it('keeps a folded dock on reappear but expands on real focus and availability changes', () => {
    let focused = true;
    let expands = 0;
    const mutable = <T,>(value: T) => ({ get: () => value, set(next: T) { value = next; } });
    const dock = {
      progress: mutable(0), uiEnabled: mutable(true), uiCompact: mutable(false),
      generation: mutable(0), notifyCompact() {}, enabled: true,
      expand() { expands++; dock.uiCompact.set(false); },
    };
    const hooks = hookHarness('../src/hooks/useLiquidDock.tsx', {
      'react/jsx-runtime': {},
      'expo-router': { useIsFocused: () => focused },
      'react-native': {},
      'react-native-reanimated': { makeMutable: mutable, ReduceMotion: { System: 0 },
        useAnimatedScrollHandler: (handlers: unknown) => handlers },
      'react-native-worklets': {}, '@/lib/liquidDock': {}, '@/store/player': {},
      '@/store/settings': {}, './useTabBar': {},
    }, dock);
    const render = () => { hooks.render('useLiquidDockScrollHandler'); hooks.commit(); };
    render();
    assert.equal(expands, 1);
    dock.uiCompact.set(true);
    hooks.hide();
    render();
    assert.equal(expands, 1);
    assert.equal(dock.uiCompact.get(), true);

    focused = false;
    render();
    focused = true;
    render();
    assert.equal(expands, 2);
    assert.equal(dock.uiCompact.get(), false);

    dock.enabled = false;
    render();
    dock.enabled = true;
    render();
    assert.equal(expands, 3);
  });
});
