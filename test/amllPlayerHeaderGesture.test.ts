import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as layoutRules from '@/lib/amllPlayerLayout';
import * as transitionRules from '@/lib/amllPlayerTransition';

type Event = { translationY: number; velocityY: number };
type Animation = { kind: string; target: number; done?: (finished: boolean) => void };
type Mutable = { value: any; animation?: Animation; get(): any; set(value: any): void };
type Deps = readonly unknown[] | undefined;
class Pan {
  options: Record<string, any> = {};
  callbacks: Record<string, (...args: any[]) => void> = {};
  enabled(value: boolean) { this.options.enabled = value; return this; }
  hitSlop(value: object) { this.options.hitSlop = value; return this; }
  maxPointers(value: number) { this.options.maxPointers = value; return this; }
  activeOffsetY(value: number[]) { this.options.activeOffsetY = value; return this; }
  failOffsetX(value: number[]) { this.options.failOffsetX = value; return this; }
  onTouchesDown(callback: (...args: any[]) => void) { this.callbacks.down = callback; return this; }
  onStart(callback: (...args: any[]) => void) { this.callbacks.start = callback; return this; }
  onUpdate(callback: (...args: any[]) => void) { this.callbacks.update = callback; return this; }
  onEnd(callback: (...args: any[]) => void) { this.callbacks.end = callback; return this; }
  onFinalize(callback: (...args: any[]) => void) { this.callbacks.finalize = callback; return this; }
}

const source = readFileSync(new URL('../src/hooks/useAmllPlayerTransition.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} });
const mutable = (initial: unknown): Mutable => ({ value: initial,
  get() { return this.value; },
  set(next) { if (typeof next === 'object') this.animation = next; else this.value = next; },
});

// Execute the production transition hook and its actual native callbacks.
// The harness supplies hook storage, a native failure manager and explicit
// animation completions; it does not replace the header/close policy.
function harness(width = 412, height = 840, lyrics = false, fontScale = 1) {
  let cursor = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const queued: (() => void)[] = [];
  const values: Mutable[] = [];
  let navigations = 0;
  const slot = <T,>(create: () => T): T => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = create();
    return slots[index];
  };
  const changed = (a: Deps, b: Deps) => !a || !b || a.length !== b.length
    || a.some((value, index) => !Object.is(value, b[index]));
  const memo = <T,>(create: () => T, deps: Deps): T => {
    const saved = slot(() => ({ deps: undefined as Deps, value: undefined as T | undefined }));
    if (changed(saved.deps, deps)) { saved.deps = deps; saved.value = create(); }
    return saved.value as T;
  };
  const effect = (create: () => (() => void) | void, deps: Deps) => {
    const saved = slot(() => ({ deps: undefined as Deps, cleanup: undefined as (() => void) | undefined }));
    if (!changed(saved.deps, deps)) return;
    saved.deps = deps;
    effects.push(() => { saved.cleanup?.(); saved.cleanup = create() || undefined; });
  };
  const react = {
    useRef: (value: unknown) => slot(() => ({ current: value })),
    useState: (initial: unknown) => {
      const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [state.value, (next: any) => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useMemo: memo, useCallback: (callback: unknown, deps: Deps) => memo(() => callback, deps),
    useEffect: effect, useLayoutEffect: effect,
  };
  const navigation = { canGoBack: () => true, goBack: () => { navigations++; }, dispatch: () => { navigations++; } };
  const reveal = mutable(-1);
  const headerScrollOffset = mutable(0);
  const layout = layoutRules.amllPlayerLayout({ width, height, fontScale, showVolume: true, showQuality: true });
  const headerArea = layoutRules.amllPlayerHeaderArea(layout, lyrics, 30, 0);
  const props = { height, focused: true, enabled: true, headerArea, headerScrollOffset };
  const exports: Record<string, any> = {};
  runInNewContext(compiled.outputText, { exports,
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'expo-router') return {
        useRouter: () => ({ replace: () => { navigations++; } }),
        useNavigation: () => navigation, useLocalSearchParams: () => ({ reveal: '1' }),
        useFocusEffect: (callback: () => (() => void) | void) => effect(callback, [callback]),
      };
      if (name === 'expo-router/react-navigation') return { usePreventRemove() {} };
      if (name === 'react-native') return { BackHandler: { addEventListener: () => ({ remove() {} }) } };
      if (name === 'react-native-gesture-handler') return { Gesture: { Pan: () => new Pan() } };
      if (name === 'react-native-worklets') return {
        scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => queued.push(() => callback(...args)),
        scheduleOnUI: (callback: () => void) => callback(),
      };
      if (name === 'react-native-reanimated') return {
        useSharedValue: (initial: unknown) => slot(() => { const value = mutable(initial); values.push(value); return value; }),
        useAnimatedStyle: (updater: () => unknown) => ({ updater }),
        cancelAnimation: (value: Mutable) => { value.animation = undefined; },
        withTiming: (target: number, _options: unknown, done: (finished: boolean) => void) => ({ kind: 'timing', target, done }),
        withSpring: (target: number) => ({ kind: 'spring', target }),
      };
      if (name === '@/lib/amllPlayerLayout') return layoutRules;
      if (name === '@/lib/amllPlayerTransition') return transitionRules;
      if (name === '@/lib/playerReveal') return { revealOffset: reveal };
      if (name === '@/theme/motion') return { motion: { reduceMotion: { essential: 'system' }, duration: { move: 220 }, easing: {} } };
      throw new Error(`Unexpected transition import ${name}`);
    },
  });
  let result: any;
  const render = (next: Partial<typeof props> = {}) => {
    Object.assign(props, next); cursor = 0; result = exports.useAmllPlayerTransition(props);
    while (effects.length) effects.shift()!();
    return result;
  };
  render();
  const pan = () => result.handleGesture as Pan;
  const accepts = (x: number, y: number) => {
    if (!pan().options.enabled) return false;
    let failed = false;
    pan().callbacks.down({ allTouches: [{ x, y }] }, { fail() { failed = true; } });
    return !failed;
  };
  const drag = (x: number, y: number, translationY = 140, velocityY = 0) => {
    if (!accepts(x, y)) return false;
    const event: Event = { translationY, velocityY };
    pan().callbacks.start(); pan().callbacks.update(event); pan().callbacks.end(event, true); pan().callbacks.finalize(event, true);
    return true;
  };
  return { layout, headerArea, headerScrollOffset, accepts, drag, pan, render,
    root: () => values[0], queued: () => queued.length, navigations: () => navigations,
    drain() { while (queued.length) queued.shift()!(); },
    finish() {
      const value = values[0]; const animation = value.animation; value.animation = undefined;
      if (animation) { value.value = animation.target; animation.done?.(true); }
    },
  };
}

describe('AMLL visible header dismissal gesture', () => {
  it('covers the whole band below the status bar and above the large cover without taking cover or controls touches', () => {
    const h = harness();
    assert.equal(h.pan().options.hitSlop.top, -30);
    assert.equal(h.pan().options.hitSlop.height, h.headerArea.bottom - 30);
    assert.equal(h.headerArea.bottom, 30 + layoutRules.AMLL_TOP_PADDING + h.layout.headerHeight + h.layout.largeCover.y);
    assert.equal(h.accepts(1, 31), true);
    assert.equal(h.accepts(411, h.headerArea.bottom - 1), true);
    assert.equal(h.accepts(206, 29), false);
    assert.equal(h.accepts(206, h.headerArea.bottom), false);
    assert.equal(h.drag(206, h.headerArea.handleBottom + h.layout.controlsTop + 10), false);
    assert.equal(h.queued(), 0);
    assert.equal(h.root().get(), 0);
  });

  it('admits portrait lyric header cover, title, artist and empty margins, while rejecting lyric seeking and scroll starts', () => {
    const h = harness(412, 840, true);
    const top = h.headerArea.handleBottom;
    for (const [x, y] of [
      [h.layout.padding + 36, top + h.layout.smallCover.y + 36],
      [h.layout.padding + h.layout.smallCover.size + 24, top + h.layout.smallCover.y + 20],
      [h.layout.padding + h.layout.smallCover.size + 24, top + h.layout.smallCover.y + 50],
      [1, h.headerArea.bottom - 1], [411, h.headerArea.bottom - 1],
    ]) assert.equal(h.accepts(x, y), true, `${x}, ${y}`);
    assert.equal(h.headerArea.bottom, top + h.layout.lyricsTop);
    assert.equal(h.drag(200, h.headerArea.bottom + 1), false);
    assert.equal(h.drag(200, h.headerArea.bottom + 80), false);
    assert.equal(h.queued(), 0);
  });

  it('keeps landscape right-side lyrics and left-side transport outside the expanded information header', () => {
    const h = harness(1024, 720, true);
    assert.equal(h.accepts(1000, h.headerArea.handleBottom - 1), true);
    assert.equal(h.accepts(h.headerArea.columnLeft + 20, h.headerArea.handleBottom + h.layout.largeCover.y + 20), true);
    assert.equal(h.accepts(h.headerArea.columnRight - 1, h.headerArea.bottom - 1), true);
    assert.equal(h.drag(h.headerArea.columnRight + 30, h.headerArea.handleBottom + 20), false);
    assert.equal(h.drag(h.headerArea.columnLeft + 30, h.headerArea.handleBottom + h.layout.controlsTop + 1), false);
    assert.equal(h.queued(), 0);
  });

  it('shrinks the header to its visible content after a short/accessibility column has scrolled', () => {
    const h = harness(320, 440, true, 2.5);
    assert.equal(h.layout.scrollable, true);
    h.headerScrollOffset.set(40);
    assert.equal(h.accepts(100, h.headerArea.bottom - 41), true);
    assert.equal(h.drag(100, h.headerArea.bottom - 20), false);
    h.headerScrollOffset.set(1000);
    assert.equal(h.accepts(100, h.headerArea.handleBottom - 1), true);
    assert.equal(h.drag(100, h.headerArea.handleBottom + 1), false);
    assert.equal(h.queued(), 0);
  });

  it('lets an admitted header drag cross into the lyrics and commits exactly one close after the whole player leaves', () => {
    const h = harness(412, 840, true);
    assert.equal(h.drag(200, h.headerArea.bottom - 1, 200), true);
    assert.equal(h.queued(), 1);
    assert.equal(h.navigations(), 0);
    h.drain(); h.render();
    assert.equal(h.root().animation?.kind, 'timing');
    assert.equal(h.root().animation?.target, 840);
    h.finish(); h.drain(); h.render();
    assert.equal(h.navigations(), 1);
    h.drain(); h.render();
    assert.equal(h.navigations(), 1);
  });

  it('leaves header button taps unactivated and returns short or cancelled pulls without closing', () => {
    const h = harness(412, 840, true);
    assert.equal(JSON.stringify(h.pan().options.activeOffsetY), '[-6,6]');
    assert.equal(h.accepts(200, h.headerArea.handleBottom + 20), true);
    // A tap never enters Pan ACTIVE; native Pressable keeps its ordinary tap.
    h.pan().callbacks.finalize({ translationY: 0, velocityY: 0 }, false);
    assert.equal(h.root().animation, undefined);
    assert.equal(h.queued(), 0);
    h.drag(200, h.headerArea.handleBottom + 20, 60, 0);
    assert.equal(h.root().animation?.target, 0);
    assert.equal(h.queued(), 0);
    h.pan().callbacks.start(); h.pan().callbacks.update({ translationY: 70, velocityY: 0 });
    h.pan().callbacks.finalize({ translationY: 70, velocityY: 0 }, false);
    assert.equal(h.root().animation?.target, 0);
    assert.equal(h.queued(), 0);
  });

  it('disables dismissal when the player is hidden or inactive', () => {
    const h = harness(412, 840, true);
    h.render({ focused: false });
    assert.equal(h.drag(100, 31), false);
    h.render({ focused: true, enabled: false });
    assert.equal(h.drag(100, 31), false);
    assert.equal(h.queued(), 0);
  });
});
