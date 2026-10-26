import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as amppDock from '../src/lib/amppDock';
import * as dockMath from '../src/lib/liquidDock';

type Cleanup = () => void;
type Effect = () => void | Cleanup;
interface EffectSlot {
  scope: string;
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
  let scope = 'default';
  let slots: unknown[] = [];
  const scopes = new Map([[scope, slots]]);
  const effects = new Set<EffectSlot>();
  const changed = (a: unknown[], b: unknown[]) => a.length !== b.length
    || a.some((value, i) => !Object.is(value, b[i]));
  const registerEffect = (kind: EffectSlot['kind'], create: Effect, deps: unknown[]) => {
    const index = cursor++;
    let slot = slots[index] as EffectSlot | undefined;
    if (!slot) {
      slot = { scope, kind, deps, create, dirty: true, active: false };
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
    useMemo<T>(create: () => T, deps: unknown[]): T {
      const index = cursor++;
      let slot = slots[index] as { value: T; deps: unknown[] } | undefined;
      if (!slot || changed(slot.deps, deps)) slots[index] = slot = { value: create(), deps };
      return slot.value;
    },
    useLayoutEffect: (create: Effect, deps: unknown[]) => registerEffect('layout', create, deps),
    useEffect: (create: Effect, deps: unknown[]) => registerEffect('passive', create, deps),
    createContext<T>(value: T) {
      const context = {
        value,
        Provider(props: { value: T; children: unknown }): unknown {
          context.value = props.value;
          return props.children;
        },
      };
      return context;
    },
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
  const renderScoped = (nextScope: string, name: string, ...args: unknown[]) => {
    scope = nextScope;
    if (!scopes.has(scope)) scopes.set(scope, []);
    slots = scopes.get(scope)!;
    cursor = 0;
    return exports[name](...args);
  };
  return {
    react,
    renderScoped,
    render(name: string, ...args: unknown[]) { return renderScoped('default', name, ...args); },
    commit() { flush('layout'); flush('passive'); },
    hide(hiddenScope?: string) {
      for (const slot of effects) {
        if (slot.kind !== 'layout' || !slot.active || (hiddenScope && slot.scope !== hiddenScope)) continue;
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
  function dockHarness(nativeAvailable = false) {
    let focused = true;
    let segments = ['(tabs)'];
    let pathname = '/';
    let hasSong = true;
    let withBar = true;
    let keyboardVisible = false;
    const keyboardListeners = new Map<string, () => void>();
    let nativeOwner: { host: number; scope: string; serial: number } | null = null;
    const nativeExpansions: number[] = [];
    let springs = 0;
    const springSpecs: { target: number; stiffness: number; damping: number }[] = [];
    const glass = { mode: 'kyantDefault' };
    let scrollHandlers: Record<string, (event: unknown, context: unknown) => void>;
    const mutable = <T,>(value: T) => ({
      writes: [] as T[],
      get: () => value,
      set(next: T) { this.writes.push(next); value = next; },
    });
    const settings = { bottomTabs: [{ key: 'index', enabled: true }, { key: 'search', enabled: true }] };
    const dependencies = {
      'react/jsx-runtime': { jsx: (type: (props: unknown) => unknown, props: unknown) => type(props) },
      'expo-router': { useIsFocused: () => focused, useSegments: () => segments, usePathname: () => pathname },
      'react-native': { Keyboard: { isVisible: () => keyboardVisible,
        addListener: (event: string, callback: () => void) => {
          keyboardListeners.set(event, callback);
          return { remove() { keyboardListeners.delete(event); } };
        } } },
      '../../modules/liquid-glass': {
        isLiquidGlassAvailable: nativeAvailable,
        readNativeDockScrollIntent: (host: number, scope: string) =>
          nativeOwner?.host === host && nativeOwner.scope === scope ? nativeOwner.serial : 0,
        expandNativeDockScrollInput: (host: number) => {
          nativeExpansions.push(host);
          if (nativeOwner?.host === host) nativeOwner.serial = 0;
        },
      },
      'react-native-reanimated': {
        makeMutable: mutable, ReduceMotion: { System: 0 },
        useSharedValue: <T,>(initial: T) => hooks.react.useRef(mutable(initial)).current,
        useAnimatedScrollHandler: (handlers: unknown) => handlers,
        withSpring: (target: number, config: { stiffness: number; damping: number }) => {
          springs++; springSpecs.push({ target, ...config }); return target;
        },
      },
      'react-native-worklets': {
        scheduleOnUI: (worklet: () => void) => worklet(),
        scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args),
      },
      '@/lib/liquidDock': dockMath,
      '@/lib/amppDock': amppDock,
      '@/store/glassTuning': { useGlassTuning: (select: (state: typeof glass) => unknown) => select(glass) },
      '@/store/player': { currentSong: () => hasSong ? {} : null,
        usePlayerStore: (select: (state: unknown) => unknown) => select({}) },
      '@/store/settings': { useSettings: (select: (state: typeof settings) => unknown) => select(settings) },
      './useTabBar': { useTabBarShown: () => withBar },
    };
    const hooks = hookHarness('../src/hooks/useLiquidDock.tsx', dependencies);
    interface Dock {
      compact: boolean;
      progress: ReturnType<typeof mutable<number>>;
      uiCompact: ReturnType<typeof mutable<boolean>>;
      generation: ReturnType<typeof mutable<number>>;
      enabled: boolean;
      amPlus: boolean;
      scope: string;
      nativeInput: boolean;
      nativeInputHost: ReturnType<typeof mutable<number>>;
      requestNativeCompact: (compact: boolean, scope: string) => void;
      notifyCompact: (compact: boolean, generation: number) => void;
      expand: () => void;
    }
    const read = () => hooks.renderScoped('consumer', 'useLiquidDock') as Dock;
    const render = () => {
      hooks.renderScoped('provider', 'LiquidDockProvider', { children: null });
      scrollHandlers = hooks.renderScoped('scroll', 'useLiquidDockScrollHandler') as typeof scrollHandlers;
      hooks.commit();
      return read();
    };
    const fold = () => {
      const dock = read();
      dock.uiCompact.set(true);
      dock.progress.set(1);
      dock.notifyCompact(true, dock.generation.get());
      return render();
    };
    return { hooks, render, fold, read, springs: () => springs, springSpecs, nativeExpansions,
      nativeIntent(host: number, scope: string, serial: number) { nativeOwner = { host, scope, serial }; },
      keyboard(value: boolean) {
        keyboardVisible = value;
        keyboardListeners.get(value ? 'keyboardDidShow' : 'keyboardDidHide')?.();
      },
      mode(value: string) { glass.mode = value; },
      scroll: (name: string, y: number, context: unknown) => scrollHandlers[name]({
        contentOffset: { y }, layoutMeasurement: { height: 500 }, contentSize: { height: 2000 },
      }, context),
      focus(value: boolean) { focused = value; },
      navigate(path: string, pattern: string[]) { pathname = path; segments = pattern; },
      song(value: boolean) { hasSong = value; },
      bar(value: boolean) { withBar = value; },
    };
  }

  it('keeps a folded dock when only frozen children reappear', () => {
    const h = dockHarness();
    let dock = h.render();
    assert.deepEqual(dock.generation.writes, [1]);
    assert.deepEqual(dock.progress.writes, [0]);
    dock = h.fold();
    assert.equal(dock.compact, true);
    // The real provider is outside Freeze; only its visible subtree reappears.
    h.hooks.hide('scroll');
    dock = h.render();
    assert.equal(dock.compact, true);
    assert.equal(dock.uiCompact.get(), true);
    assert.equal(dock.progress.get(), 1);
    assert.deepEqual(dock.generation.writes, [1]);
    assert.equal(h.springs(), 0);
  });

  it('resets once per actual route, including different IDs with the same file pattern', () => {
    const h = dockHarness();
    h.render();
    h.fold();
    h.focus(false);
    h.navigate('/artist/first', ['artist', '[id]']);
    let dock = h.render();
    assert.equal(dock.compact, false);
    assert.equal(dock.uiCompact.get(), false);
    assert.equal(dock.progress.get(), 0);
    assert.deepEqual(dock.generation.writes, [1, 2]);
    h.focus(true);
    h.render();
    assert.deepEqual(dock.generation.writes, [1, 2]);

    h.fold();
    const oldGeneration = dock.generation.get();
    h.navigate('/artist/second', ['artist', '[id]']);
    dock = h.render();
    assert.equal(dock.compact, false);
    assert.equal(dock.uiCompact.get(), false);
    assert.deepEqual(dock.generation.writes, [1, 2, 3]);
    dock.notifyCompact(true, oldGeneration);
    dock = h.render();
    assert.equal(dock.compact, false, 'an outgoing list cannot refold the new route');
    assert.equal(dock.progress.get(), 0);
    assert.deepEqual(dock.progress.writes, [0, 1, 0, 1, 0]);
    assert.equal(h.springs(), 0, 'focus must not add a second zero-distance spring');
  });

  it('resets availability changes once and animates only a real folded expansion', () => {
    const h = dockHarness();
    h.render();
    h.fold();
    h.song(false);
    let dock = h.render();
    assert.equal(dock.enabled, false);
    assert.equal(dock.compact, false);
    assert.equal(dock.progress.get(), 0);
    assert.deepEqual(dock.generation.writes, [1, 2]);
    h.song(true);
    dock = h.render();
    assert.equal(dock.enabled, true);
    assert.deepEqual(dock.generation.writes, [1, 2, 3]);
    dock.expand();
    dock = h.render();
    assert.equal(h.springs(), 0, 'an already expanded dock has no spring work');
    assert.deepEqual(dock.generation.writes, [1, 2, 3, 4]);

    dock = h.fold();
    const oldGeneration = dock.generation.get();
    dock.expand();
    dock.notifyCompact(true, oldGeneration);
    dock = h.render();
    assert.equal(dock.compact, false);
    assert.equal(dock.uiCompact.get(), false);
    assert.equal(dock.progress.get(), 0);
    assert.equal(h.springs(), 1);
  });

  it('resets once when appearance changes and rejects a previous mode scroll generation', () => {
    const h = dockHarness();
    h.render();
    const previous = h.fold();
    const previousGeneration = previous.generation.get();
    h.mode('amPlus');
    let dock = h.render();
    assert.equal(dock.amPlus, true);
    assert.equal(dock.compact, false);
    assert.equal(dock.progress.get(), 0);
    assert.deepEqual(dock.generation.writes, [1, 2]);
    dock.notifyCompact(true, previousGeneration);
    dock = h.render();
    assert.equal(dock.compact, false);
    assert.equal(h.springs(), 0);
    h.render();
    assert.deepEqual(dock.generation.writes, [1, 2], 'stable appearances do not reset repeatedly');

    dock = h.fold();
    dock.expand();
    h.render();
    assert.equal(h.springSpecs.at(-1)?.stiffness, 250);
    assert.equal(h.springSpecs.at(-1)?.damping, amppDock.amppSpringDamping(false));
    h.mode('kyantDefault');
    dock = h.render();
    assert.equal(dock.amPlus, false);
    dock = h.fold();
    dock.expand();
    h.render();
    assert.equal(h.springSpecs.at(-1)?.stiffness, 350);
    assert.equal(h.springSpecs.at(-1)?.damping, 30);
    assert.equal(h.springs(), 2, 'appearance changes add no zero-distance spring');
  });

  it('keeps strict drag intent while choosing AM++ springs in both directions', () => {
    const h = dockHarness();
    h.mode('amPlus');
    h.render();
    const context = {};
    h.scroll('onBeginDrag', 100, context);
    h.scroll('onScroll', 150, context);
    h.scroll('onEndDrag', 170, context);
    h.scroll('onMomentumBegin', 170, context);
    h.scroll('onScroll', 600, context);
    assert.equal(h.springs(), 0, 'short drag and following inertia cannot fold the dock');
    h.scroll('onBeginDrag', 600, context);
    h.scroll('onScroll', 696, context);
    let dock = h.render();
    assert.equal(dock.compact, true);
    assert.equal(h.springSpecs.at(-1)?.target, 1);
    assert.equal(h.springSpecs.at(-1)?.stiffness, 250);
    assert.equal(h.springSpecs.at(-1)?.damping, amppDock.amppSpringDamping(true));
    h.scroll('onBeginDrag', 696, context);
    h.scroll('onScroll', 616, context);
    dock = h.render();
    assert.equal(dock.compact, false);
    assert.equal(h.springSpecs.at(-1)?.target, 0);
    assert.equal(h.springSpecs.at(-1)?.damping, amppDock.amppSpringDamping(false));
  });

  it('consumes a valid native signed intent once on the UI scroll path and preserves source springs', () => {
    const h = dockHarness(true);
    h.mode('amPlus');
    let dock = h.render();
    assert.equal(dock.nativeInput, true);
    dock.nativeInputHost.set(41);
    h.nativeIntent(41, dock.scope, 1);
    const context = {};
    h.scroll('onBeginDrag', 100, context);
    dock = h.render();
    assert.equal(dock.compact, true);
    assert.equal(h.springs(), 1);
    assert.equal(h.springSpecs.at(-1)?.damping, amppDock.amppSpringDamping(true));
    h.scroll('onScroll', 900, context);
    dock.requestNativeCompact(true, dock.scope);
    h.render();
    assert.equal(h.springs(), 1, 'the bridge fallback cannot restart an already consumed UI intent');
    h.nativeIntent(41, dock.scope, -2);
    h.scroll('onEndDrag', 880, context);
    dock = h.render();
    assert.equal(dock.compact, false);
    assert.equal(h.springs(), 2);
    assert.equal(h.springSpecs.at(-1)?.damping, amppDock.amppSpringDamping(false));
  });

  it('rejects stale native hosts/scopes and clears page ownership for keyboard or player handoffs', () => {
    const h = dockHarness(true);
    h.mode('amPlus');
    let dock = h.render();
    dock.nativeInputHost.set(41);
    const oldScope = dock.scope;
    const context = {};
    h.nativeIntent(42, oldScope, 1);
    h.scroll('onScroll', 300, context);
    assert.equal(h.springs(), 0, 'another native host cannot drive this dock');
    h.nativeIntent(41, 'previous-page', 1);
    h.scroll('onScroll', 400, context);
    assert.equal(h.springs(), 0);
    h.navigate('/artist/new', ['artist', '[id]']);
    dock = h.render();
    h.nativeIntent(41, oldScope, 2);
    dock.requestNativeCompact(true, oldScope);
    h.scroll('onScroll', 500, context);
    assert.equal(h.springs(), 0, 'an outgoing scope cannot fold the new route');
    h.keyboard(true);
    dock = h.render();
    assert.equal(dock.enabled, false);
    h.nativeIntent(41, dock.scope, 3);
    h.scroll('onScroll', 600, context);
    assert.equal(h.springs(), 0);
    h.keyboard(false);
    h.bar(false);
    h.navigate('/player', ['player']);
    dock = h.render();
    assert.equal(dock.enabled, false);
    assert.equal(dock.compact, false);
    assert.ok(h.nativeExpansions.includes(41), 'handoffs synchronously reset native touch/fling ownership');
  });

  it('manual expansion clears native inertia so a delayed collapse event cannot fold it again', () => {
    const h = dockHarness(true);
    h.mode('amPlus');
    let dock = h.render();
    dock.nativeInputHost.set(41);
    h.nativeIntent(41, dock.scope, 1);
    h.scroll('onScroll', 100, {});
    dock = h.render();
    assert.equal(dock.compact, true);
    const scope = dock.scope;
    dock.expand();
    dock = h.render();
    assert.equal(dock.compact, false);
    assert.equal(h.nativeExpansions.at(-1), 41);
    dock.requestNativeCompact(true, scope);
    h.scroll('onScroll', 1000, {});
    dock = h.render();
    assert.equal(dock.compact, false);
    assert.equal(h.springs(), 2, 'one collapse plus one explicit expand, with no stale restart');
  });
});
