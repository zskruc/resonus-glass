import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as amppDock from '../src/lib/amppDock';
import { resolveAppleMusicPlayerTransition } from '../src/lib/appleMusicPlayerTransition';

type Deps = readonly unknown[] | undefined;
type Element = { type: unknown; props: Record<string, any> };
type Timing = { timing: true; target: number };
type Mutable = { value: any; animation?: Timing; get(): any; set(value: any): void };
type Reaction = { prepare: () => unknown; react: (value: any, previous: any) => void; previous: unknown };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const mutable = (initial: unknown): Mutable => ({ value: initial,
  get() { return this.value; },
  set(value) {
    if (value?.timing) this.animation = value;
    else { this.value = value; this.animation = undefined; }
  },
});

// The real hooks and components execute with persistent React hook storage.
// Layout/passive effects, UI reactions and RN callbacks advance independently
// so first-render visibility and queued stale callbacks remain observable.
function runtime() {
  let cursor = 0;
  let dirty = false;
  let writes = 0;
  const slots: any[] = [];
  const layout: (() => void)[] = [];
  const passive: (() => void)[] = [];
  const cleanups = new Set<() => void>();
  const reactions = new Set<Reaction>();
  const values: Mutable[] = [];
  const queued: (() => void)[] = [];
  function slot<T>(create: () => T): T {
    const index = cursor++;
    if (!(index in slots)) slots[index] = create();
    return slots[index];
  }
  const changed = (a: Deps, b: Deps) => !a || !b || a.length !== b.length
    || a.some((value, index) => !Object.is(value, b[index]));
  function memo<T>(create: () => T, deps: Deps): T {
    const box = slot(() => ({ deps: undefined as Deps, value: undefined as T | undefined }));
    if (changed(box.deps, deps)) { box.deps = deps; box.value = create(); }
    return box.value as T;
  }
  function effect(create: () => (() => void) | void, deps: Deps, pending: (() => void)[]) {
    const box = slot(() => ({ deps: undefined as Deps, cleanup: undefined as (() => void) | undefined }));
    if (!changed(box.deps, deps)) return;
    box.deps = deps;
    pending.push(() => {
      if (box.cleanup) { cleanups.delete(box.cleanup); box.cleanup(); }
      box.cleanup = create() || undefined;
      if (box.cleanup) cleanups.add(box.cleanup);
    });
  }
  const react = {
    useRef: <T,>(value: T) => slot(() => ({ current: value })),
    useState: <T,>(initial: T | (() => T)) => {
      const box = slot(() => ({ value: typeof initial === 'function' ? (initial as () => T)() : initial }));
      return [box.value, (next: T | ((value: T) => T)) => {
        const value = typeof next === 'function' ? (next as (value: T) => T)(box.value) : next;
        if (!Object.is(value, box.value)) { box.value = value; dirty = true; writes++; }
      }];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: Deps) => memo(() => callback, deps),
    useLayoutEffect: (create: () => (() => void) | void, deps: Deps) => effect(create, deps, layout),
    useEffect: (create: () => (() => void) | void, deps: Deps) => effect(create, deps, passive),
  };
  const animated = {
    __esModule: true,
    default: { View: 'AnimatedView' },
    makeMutable: mutable,
    useSharedValue: (initial: unknown) => slot(() => { const value = mutable(initial); values.push(value); return value; }),
    useDerivedValue: (updater: () => unknown) => {
      const box = slot(() => ({ updater, get() { return this.updater(); } }));
      box.updater = updater; return box;
    },
    useAnimatedStyle: (updater: () => unknown) => {
      const box = slot(() => ({ updater })); box.updater = updater; return box;
    },
    useAnimatedReaction: (prepare: () => unknown, reactCallback: Reaction['react']) => {
      const reaction = slot(() => {
        const value = { prepare, react: reactCallback, previous: null } as Reaction;
        reactions.add(value); return value;
      });
      reaction.prepare = prepare; reaction.react = reactCallback;
    },
    cancelAnimation: (value: Mutable) => { value.animation = undefined; },
    withTiming: (target: number): Timing => ({ timing: true, target }),
  };
  const flush = (pending: (() => void)[]) => { while (pending.length) pending.shift()!(); };
  return {
    react, animated, values, queued,
    worklets: {
      scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => queued.push(() => callback(...args)),
      scheduleOnUI: (callback: (...args: any[]) => void, ...args: any[]) => callback(...args),
    },
    render<T>(component: () => T, runPassive = true): T {
      let result!: T;
      for (let attempt = 0; attempt < 20; attempt++) {
        cursor = 0; dirty = false; result = component();
        if (!dirty) break;
        assert.notEqual(attempt, 19, 'React render-phase state must settle');
      }
      flush(layout); if (runPassive) flush(passive);
      return result;
    },
    passive() { flush(passive); },
    ui() {
      for (const reaction of reactions) {
        const value = reaction.prepare();
        if (!Object.is(value, reaction.previous)) {
          const previous = reaction.previous; reaction.previous = value; reaction.react(value, previous);
        }
      }
    },
    drain() { flush(queued); },
    writes: () => writes,
    unmount() { for (const cleanup of cleanups) cleanup(); cleanups.clear(); },
  };
}

function load(path: string, r: ReturnType<typeof runtime>, imports: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports: Record<string, any> = {};
  runInNewContext(compiled.outputText, { exports,
    require(name: string) {
      if (name === 'react') return r.react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native-reanimated') return r.animated;
      if (name === 'react-native-worklets') return r.worklets;
      assert.ok(Object.hasOwn(imports, name), `Unexpected ${path} import ${name}`);
      return imports[name];
    },
  });
  return exports;
}

function routes(r: ReturnType<typeof runtime>) {
  const context = { segments: ['(tabs)', 'index'], presentation: 'amll', alwaysShowTabs: true };
  const router = { useSegments: () => context.segments };
  const hook = load('hooks/useTabBar.ts', r, {
    'expo-router': router,
    '@/store/player': { currentSong: (state: any) => state.song,
      usePlayerStore: (select: (state: any) => unknown) => select({ song: { id: 'current' } }) },
    '@/store/settings': { useSettings: (select: (state: any) => unknown) => select({
      alwaysShowTabs: context.alwaysShowTabs, playerPresentation: context.presentation,
    }) },
  });
  return { context, router, hook };
}

function underlay() {
  const r = runtime();
  const bus = load('lib/playerReveal.ts', r);
  const view = load('components/PlayerDockUnderlay.tsx', r, {
    'react-native': { StyleSheet: { create: (styles: unknown) => styles } },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ height: 800 }) },
    '@/lib/playerReveal': bus,
  });
  return { r, bus, view };
}

function mini(initialRoot = '(tabs)', presentation = 'amll') {
  const r = runtime();
  const route = routes(r);
  route.context.segments = [initialRoot];
  route.context.presentation = presentation;
  const bus = load('lib/playerReveal.ts', r);
  const dock = { progress: mutable(0.75), uiEnabled: mutable(true), amPlus: true,
    compact: true, hasSearch: true, enabled: true };
  const component = load('components/GlobalMiniPlayer.tsx', r, {
    'expo-router': route.router,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 30, bottom: 20, left: 0, right: 0 }) },
    '@/lib/amppDock': amppDock,
    '@/lib/playerReveal': bus,
    '@/hooks/useTabBar': route.hook,
    '@/hooks/useLiquidDock': { COMPACT_DOCK_SIZE: 44, useLiquidDock: () => dock },
    '@/theme/motion': { motion: { duration: { fade: 200 }, reduceMotion: { decorative: 'system' } } },
    '@/theme': { MINI_PLAYER_GAP: 8, MINI_PLAYER_HEIGHT: 48, spacing: { sm: 8 }, TAB_BAR_BOTTOM_GAP: 0, TAB_BAR_HEIGHT: 62 },
    './MiniPlayer': { MiniPlayer: 'MiniPlayer' },
    './PlayerDockUnderlay': { PlayerDockUnderlay: 'PlayerDockUnderlay' },
  });
  let tree: Element;
  function render(root = route.context.segments[0], runPassive = true) {
    route.context.segments = [root]; tree = r.render(() => component.GlobalMiniPlayer(), runPassive); return tree;
  }
  render(); r.ui();
  return { r, dock, bus, render, tree: () => tree,
    wrapper: () => tree.props.children as Element,
    child: () => (tree.props.children as Element).props.children as Element,
    style: () => (tree.props.children as Element).props.style[1].updater(),
    opacity: () => r.values[2],
    finishOpacity() { const opacity = r.values[2]; if (opacity.animation) opacity.set(opacity.animation.target); },
  };
}

function publishFlight(bus: Record<string, any>, phase: 'opening' | 'closing' | 'handoff', progress: number, dragOffsetY = 0) {
  const frame = resolveAppleMusicPlayerTransition({
    viewportWidth: 384, viewportHeight: 800, progress, dragOffsetY,
    snapshot: { viewportWidth: 384, viewportHeight: 800,
      miniPlayer: { x: 16, y: 700, width: 352, height: 56 },
      miniArtwork: { x: 24, y: 708, width: 40, height: 40 },
      playerArtwork: { x: 32, y: 144, width: 320, height: 320 } },
  });
  assert.ok(frame);
  bus.playerArtworkFlight.set({ owner: bus.createPlayerSurfaceOwner(), phase, frame });
  return frame;
}

describe('player dock route ownership', () => {
  it('captures a visible Home dock for its player, then returns it without a second fade', () => {
    const r = runtime(); const route = routes(r);
    const render = (root: string, shown: boolean) => {
      route.context.segments = [root];
      return r.render(() => route.hook.usePlayerDockUnderlay(shown));
    };
    let state = render('(tabs)', true);
    assert.equal(state.reveal, false); assert.equal(state.returning, false);
    state = render('player', false);
    assert.equal(state.reveal, true); assert.equal(state.returning, false);
    state = render('(tabs)', true);
    assert.equal(state.reveal, false); assert.equal(state.returning, true);
    state = render('(tabs)', true);
    assert.equal(state.returning, true);
  });

  it('never exposes Home through a player opened from queue or a directly mounted modal', () => {
    for (const initial of ['(tabs)', 'queue', 'player']) {
      const r = runtime(); const route = routes(r);
      route.context.segments = [initial];
      r.render(() => route.hook.usePlayerDockUnderlay(initial === '(tabs)'));
      route.context.segments = ['queue']; r.render(() => route.hook.usePlayerDockUnderlay(false));
      route.context.segments = ['player'];
      assert.equal(r.render(() => route.hook.usePlayerDockUnderlay(false)).reveal, false);
    }
  });

  it('retains the original eligibility across player to queue to player until the covered stack returns Home', () => {
    const r = runtime(); const route = routes(r);
    const render = (root: string) => {
      route.context.segments = [root];
      return r.render(() => route.hook.usePlayerDockUnderlay(root === '(tabs)'));
    };
    render('(tabs)'); assert.equal(render('player').reveal, true);
    assert.equal(render('queue').reveal, false);
    assert.equal(render('player').reveal, true);
    assert.equal(render('(tabs)').returning, true);
    assert.equal(render('queue').returning, false);
    assert.equal(render('player').reveal, false);
  });

  it('keeps the legacy player out of the retained AMLL underlay path', () => {
    const r = runtime(); const route = routes(r); route.context.presentation = 'resonus';
    r.render(() => route.hook.usePlayerDockUnderlay(true));
    route.context.segments = ['player'];
    const state = r.render(() => route.hook.usePlayerDockUnderlay(false));
    assert.equal(state.reveal, false); assert.equal(state.returning, false);
  });
});

describe('player dock native clipping and material lifecycle', () => {
  it('moves only the clip boundary while counter-translation keeps dock content anchored at offset 0, partial and H', () => {
    const h = underlay(); h.bus.playerSurfaceHeight.set(800);
    const child = jsx('Dock', { bottom: 36 });
    const tree = h.r.render(() => h.view.PlayerDockUnderlay({ active: true, children: child })) as Element;
    const inner = tree.props.children as Element;
    assert.equal(inner.props.nativeID, 'resonus-dock-selection-host');
    assert.equal(tree.props.pointerEvents, 'box-none', 'the clip container passes through empty areas; dock controls own their route eligibility');
    assert.equal(tree.props.style[0].overflow, 'hidden');
    assert.equal(tree.props.style[1].height, 800);
    assert.equal(inner.props.children, child);
    for (const offset of [0, 240, 800, 0]) {
      h.bus.playerSurfaceOffset.set(offset);
      const frameY = tree.props.style[2].updater().transform[0].translateY;
      const contentY = inner.props.style[2].updater().transform[0].translateY;
      assert.equal(frameY, offset - 800);
      assert.equal(frameY + contentY, 0);
      assert.equal(800 + frameY, offset, 'exposed screen height follows the opaque player edge');
    }
  });

  it('normalizes source height changes and leaves the ordinary visible dock unclipped', () => {
    const h = underlay(); h.bus.playerSurfaceHeight.set(1600); h.bus.playerSurfaceOffset.set(400);
    let tree = h.r.render(() => h.view.PlayerDockUnderlay({ active: true, children: null })) as Element;
    assert.equal(tree.props.style[2].updater().transform[0].translateY, -600);
    h.bus.playerSurfaceOffset.set(-1);
    assert.equal(tree.props.style[2].updater().transform[0].translateY, -800);
    h.bus.playerSurfaceOffset.set(2400);
    assert.equal(tree.props.style[2].updater().transform[0].translateY, 0);
    tree = h.r.render(() => h.view.PlayerDockUnderlay({ active: false, children: null }));
    assert.equal(tree.props.style[2].updater().transform[0].translateY, 0);
    assert.equal(tree.props.children.props.style[2].updater().transform[0].translateY, 0);
  });

  it('fades Tabs and Mini from the same hero frame without clipping either until the route handoff', () => {
    const h = underlay();
    const mini = underlay();
    const child = jsx('Tabs', { bottom: 20 });
    const tree = h.r.render(() => h.view.PlayerDockUnderlay({ active: true, children: child })) as Element;
    const miniTree = mini.r.render(() => mini.view.PlayerDockUnderlay({ active: true, mini: true, children: null })) as Element;
    const inner = tree.props.children as Element;
    h.bus.playerSurfaceOffset.set(240);
    h.bus.playerSurfaceHeight.set(800);
    mini.bus.playerSurfaceOffset.set(240);
    mini.bus.playerSurfaceHeight.set(800);
    const frames: ['opening' | 'closing' | 'handoff', number, number][] = [
      ['opening', 0, 0], ['opening', .4, 0], ['opening', 1, 0],
      ['closing', 1, 0], ['closing', .4, 0], ['closing', .4, 240], ['closing', 0, 0], ['handoff', 0, 0],
    ];
    for (const [phase, progress, drag] of frames) {
      const frame = publishFlight(h.bus, phase, progress, drag);
      mini.bus.playerArtworkFlight.set(h.bus.playerArtworkFlight.get());
      const frameStyle = tree.props.style[2].updater();
      const contentStyle = inner.props.style[2].updater();
      const miniStyle = miniTree.props.style[2].updater();
      assert.equal(frameStyle.opacity, frame.miniContentOpacity);
      assert.equal(frameStyle.opacity, 1 - progress);
      assert.equal(frameStyle.opacity, miniStyle.opacity, 'both collapsed dock pieces become visible in the same frame');
      assert.equal(frameStyle.transform[0].translateY, 0, 'Tabs cannot remain behind the moving background-bottom clip');
      assert.equal(contentStyle.transform[0].translateY, 0);
      assert.equal(miniStyle.transform[0].translateY, 0);
      assert.equal(miniTree.props.children.props.style[2].updater().transform[0].translateY, 0);
      assert.equal(inner.props.nativeID, 'resonus-dock-selection-host');
      assert.equal(inner.props.children, child);
    }
    const frame = publishFlight(h.bus, 'closing', 0);
    frame.background.rect.y = -100;
    frame.background.rect.height = 56;
    assert.equal(tree.props.style[2].updater().transform[0].translateY, 0, 'hero background bounds do not reposition the dock');
    assert.equal(Math.abs(inner.props.style[2].updater().transform[0].translateY), 0);
    h.bus.playerArtworkFlight.set(null);
    mini.bus.playerArtworkFlight.set(null);
    assert.equal(tree.props.style[2].updater().opacity, 1);
    assert.equal(tree.props.style[2].updater().transform[0].translateY, -560, 'ordinary slide fallback resumes after the flight ends');
    assert.equal(inner.props.style[2].updater().transform[0].translateY, 560);
    assert.equal(miniTree.props.style[2].updater().opacity, 1);
    assert.equal(miniTree.props.style[2].updater().transform[0].translateY, -560);
    assert.equal(miniTree.props.children.props.style[2].updater().transform[0].translateY, 560);
  });

  it('uses shared Mini content opacity without moving it through opening, closing and handoff', () => {
    const h = underlay();
    let active = true;
    const render = () => h.r.render(() => h.view.PlayerDockUnderlay({ active, mini: true, children: null })) as Element;
    let tree = render();
    const frames: ['opening' | 'closing' | 'handoff', number][] = [
      ['opening', 0], ['opening', .4], ['opening', 1], ['closing', 1], ['closing', .4], ['closing', 0], ['handoff', 0],
    ];
    for (const [phase, progress] of frames) {
      const flight = publishFlight(h.bus, phase, progress);
      assert.equal(tree.props.style[2].updater().opacity, flight.miniContentOpacity);
      assert.equal(tree.props.style[2].updater().transform[0].translateY, 0);
      assert.equal(tree.props.children.props.style[2].updater().transform[0].translateY, 0);
      assert.equal(tree.props.pointerEvents, 'box-none', 'the wrapper leaves interaction eligibility to the retained MiniPlayer');
    }
    publishFlight(h.bus, 'opening', 1);
    active = false; tree = render();
    assert.equal(tree.props.style[2].updater().opacity, 1, 'an old flight cannot fade a returned or unrelated route');
    assert.equal(tree.props.style[2].updater().transform[0].translateY, 0);
    assert.equal(tree.props.children.props.style[2].updater().transform[0].translateY, 0);
  });

  it('rejects queued material-ready callbacks from earlier A to B to A bindings and after unmount', () => {
    const h = underlay(); let active = true;
    const render = (next = active) => { active = next; return h.r.render(() => h.view.usePlayerDockMaterialReady(active)); };
    assert.equal(render(), false); h.r.ui(); h.r.drain(); render();
    h.bus.playerSurfaceOffset.set(100); h.r.ui();
    render(false); h.r.ui(); render(true); h.r.ui();
    assert.equal(h.r.queued.length, 3);
    h.r.queued.shift()!(); assert.equal(render(), false);
    h.r.queued.shift()!(); assert.equal(render(), false);
    h.r.queued.shift()!(); assert.equal(render(), true);
    h.bus.playerSurfaceOffset.set(0); h.r.ui();
    h.r.unmount(); const writes = h.r.writes(); h.r.drain();
    assert.equal(h.r.writes(), writes);
  });

  it('uses distinct owners for different full player surfaces', () => {
    const h = underlay();
    const first = h.bus.createPlayerSurfaceOwner();
    const second = h.bus.createPlayerSurfaceOwner();
    assert.ok(first > 0); assert.notEqual(first, second);
  });

  it('prepares a fresh material binding after active false/true is coalesced between UI frames', () => {
    const h = underlay(); let active = true;
    const render = (next = active) => { active = next; return h.r.render(() => h.view.usePlayerDockMaterialReady(active)); };
    h.bus.playerSurfaceOffset.set(100);
    render(); h.r.ui(); h.r.drain(); assert.equal(render(), true);
    render(false); assert.equal(render(true), false);
    // No UI sample saw the intermediate false. The binding serial must still
    // notify the new React lifetime even though its visible boolean is true.
    h.r.ui(); h.r.drain(); assert.equal(render(), true);
  });


});

describe('GlobalMiniPlayer dismissal underlay', () => {
  it('publishes native return eligibility only while the captured MiniPlayer belongs beneath this AMLL route', () => {
    const h = mini();
    assert.equal(h.bus.playerCanReturnToMini.get(), false);
    h.render('player', false);
    assert.equal(h.bus.playerCanReturnToMini.get(), true, 'layout effect publishes before passive fades');
    h.render('queue'); assert.equal(h.bus.playerCanReturnToMini.get(), false);
    h.render('player'); assert.equal(h.bus.playerCanReturnToMini.get(), true, 'queue covering the same player retains its origin');
    h.render('(tabs)'); assert.equal(h.bus.playerCanReturnToMini.get(), false);
    h.render('queue'); h.render('player'); assert.equal(h.bus.playerCanReturnToMini.get(), false, 'a later queue origin cannot borrow Home');
    for (const [origin, presentation] of [['queue', 'amll'], ['player', 'amll'], ['(tabs)', 'resonus']]) {
      const other = mini(origin, presentation);
      other.render('player');
      assert.equal(other.bus.playerCanReturnToMini.get(), false, `${origin}/${presentation} has no captured AMLL MiniPlayer`);
    }
  });

  it('paints the revealed and returning mini fully opaque before passive effects, with interactions restored only after pop', () => {
    const h = mini();
    h.opacity().set(0.35);
    h.render('player', false);
    assert.equal(h.tree().props.active, true);
    assert.equal(h.style().opacity, 1);
    assert.equal(h.child().props.active, false);
    assert.equal(h.wrapper().props.pointerEvents, 'none');
    assert.equal(h.wrapper().props.accessibilityElementsHidden, true);
    assert.equal(h.wrapper().props.importantForAccessibility, 'no-hide-descendants');
    h.r.passive();
    h.opacity().set(0.2);
    h.render('(tabs)', false);
    assert.equal(h.tree().props.active, false);
    assert.equal(h.style().opacity, 1);
    assert.equal(h.child().props.active, true);
    assert.equal(h.wrapper().props.pointerEvents, 'box-none');
    assert.equal(h.wrapper().props.accessibilityElementsHidden, false);
    assert.equal(h.wrapper().props.importantForAccessibility, 'auto');
    h.r.passive();
    assert.equal(h.opacity().get(), 1);
    assert.equal(h.opacity().animation, undefined, 'returning does not schedule another entry fade');
  });

  it('freezes the visible dock geometry and animation progress while the player covers it', () => {
    const h = mini(); const bottom = h.wrapper().props.style[0].bottom;
    const translation = h.style().transform[0].translateY;
    h.dock.compact = false; h.dock.hasSearch = false; h.dock.enabled = false;
    h.dock.progress.set(0); h.dock.uiEnabled.set(false);
    h.render('player'); h.r.ui();
    assert.equal(h.wrapper().props.style[0].bottom, bottom);
    assert.equal(h.child().props.compact, true);
    assert.equal(h.child().props.hasSearch, true);
    assert.equal(h.child().props.dockEnabled, true);
    assert.equal(h.child().props.dockProgress.get(), 0.75);
    assert.equal(h.style().transform[0].translateY, translation);
  });

  it('keeps queue-origin players hidden instead of revealing a dock from farther down the stack', () => {
    const h = mini(); h.render('queue'); h.finishOpacity();
    h.render('player');
    assert.equal(h.tree().props.active, false);
    assert.equal(h.style().opacity, 0);
    assert.equal(h.child().props.active, false);
    assert.equal(h.wrapper().props.pointerEvents, 'none');
  });

});
