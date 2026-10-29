import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as layoutRules from '@/lib/amllPlayerLayout';
import * as transitionRules from '@/lib/amllPlayerTransition';
import * as artworkRules from '@/lib/appleMusicPlayerTransition';

type Event = { translationY: number; velocityY: number };
type Animation = { kind: string; target: number; options?: Record<string, unknown>; done?: (finished: boolean) => void };
type Mutable = { value: any; animation?: Animation; get(): any; set(value: any): void };
type Deps = readonly unknown[] | undefined;
class Pan {
  options: Record<string, any> = {};
  callbacks: Record<string, (...args: any[]) => void> = {};
  enabled(value: boolean) { this.options.enabled = value; return this; }
  hitSlop(value: object) { this.options.hitSlop = value; return this; }
  maxPointers(value: number) { this.options.maxPointers = value; return this; }
  activeOffsetY(value: number | number[]) { this.options.activeOffsetY = value; return this; }
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
const revealCompiled = ts.transpileModule(readFileSync(new URL('../src/lib/playerReveal.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const artworkCompiled = ts.transpileModule(readFileSync(new URL('../src/hooks/useAppleMusicPlayerMotion.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mutable = (initial: unknown): Mutable => ({ value: initial,
  get() { return this.value; },
  set(next) {
    if (next?.kind) this.animation = next;
    else { this.value = next; this.animation = undefined; }
  },
});

// Execute the production transition hook and its actual native callbacks.
// The harness supplies hook storage, a native failure manager and explicit
// animation completions; it does not replace the header/close policy.
function harness(width = 412, height = 840, lyrics = false, fontScale = 1, nativeArtwork = false) {
  let cursor = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const queued: (() => void)[] = [];
  const frames: (() => void)[] = [];
  const clips: number[][] = [];
  const values: Mutable[] = [];
  const reactions = new Set<{ prepare: () => any; react: (value: any, previous: any) => void; previous: any }>();
  const flushUI = () => {
    for (let turn = 0; turn < 10; turn++) {
      let changed = false;
      for (const reaction of reactions) {
        const value = reaction.prepare();
        if (Object.is(value, reaction.previous) || JSON.stringify(value) === JSON.stringify(reaction.previous)) continue;
        const previous = reaction.previous; reaction.previous = value;
        reaction.react(value, previous); changed = true;
      }
      if (!changed) break;
    }
  };
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
  const bus: Record<string, any> = {};
  runInNewContext(revealCompiled, { exports: bus, require: () => ({ makeMutable: mutable }) });
  if (nativeArtwork) {
    bus.playerCanReturnToMini.set(true);
    bus.miniArtworkMetrics.set({ viewportWidth: width, viewportHeight: height,
      miniPlayer: { x: 12, y: height - 140, width: width - 24, height: 56 },
      miniArtwork: { x: 20, y: height - 132, width: 40, height: 40 } });
  }
  const headerScrollOffset = mutable(0);
  const layout = layoutRules.amllPlayerLayout({ width, height, fontScale, showVolume: true, showQuality: true });
  const headerArea = layoutRules.amllPlayerHeaderArea(layout, lyrics, 30, 0);
  let measurements = 0;
  const props = { width, height, focused: true, enabled: true, headerArea, headerScrollOffset,
    readArtwork: nativeArtwork ? () => { measurements++; return { x: 28, y: 100, width: width - 56, height: width - 56 }; } : undefined };
  const exports: Record<string, any> = {};
  const artworkExports: Record<string, any> = {};
  const artworkFallbacks = new WeakMap<object, object>();
  runInNewContext(compiled.outputText, { exports,
    require: function requireModule(name: string): any {
      if (name === 'react') return react;
      if (name === 'expo-router') return {
        useRouter: () => ({ replace: () => { navigations++; } }),
        useNavigation: () => navigation, useLocalSearchParams: () => nativeArtwork ? { artwork: '1' } : { reveal: '1' },
        useFocusEffect: (callback: () => (() => void) | void) => effect(callback, [callback]),
      };
      if (name === 'expo-router/react-navigation') return { usePreventRemove(_prevent: boolean, callback: (event: unknown) => void) { preventRemove = callback; } };
      if (name === 'react-native') return { BackHandler: { addEventListener: (_name: string, callback: () => boolean) => {
        back = callback; return { remove() {} };
      } } };
      if (name === 'react-native-gesture-handler') return { Gesture: { Pan: () => new Pan() } };
      if (name === 'react-native-worklets') return {
        scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => queued.push(() => callback(...args)),
        scheduleOnUI: (callback: () => void) => callback(),
      };
      if (name === 'react-native-reanimated') return {
        useSharedValue: (initial: unknown) => slot(() => { const value = mutable(initial); values.push(value); return value; }),
        useDerivedValue: (updater: () => unknown) => {
          const value = slot(() => ({ updater, get() { return this.updater(); } }));
          value.updater = updater; return value;
        },
        useAnimatedStyle: (updater: () => unknown) => ({ updater }),
        useAnimatedReaction: (prepare: () => any, react: (value: any, previous: any) => void) => {
          const reaction = slot(() => { const value = { prepare, react, previous: undefined as any }; reactions.add(value); return value; });
          reaction.prepare = prepare; reaction.react = react;
        },
        cancelAnimation: (value: Mutable) => { value.animation = undefined; },
        withTiming: (target: number, options: unknown, done: (finished: boolean) => void) => ({ kind: 'timing', target, options, done }),
        withSpring: (target: number, options: unknown, done: (finished: boolean) => void) => ({ kind: 'spring', target, options, done }),
        Easing: { out: (value: unknown) => value, cubic: 'cubic' },
      };
      if (name === '@/lib/amllPlayerLayout') return layoutRules;
      if (name === '@/lib/amllPlayerTransition') return transitionRules;
      if (name === '@/lib/playerReveal') return bus;
      if (name === '@/lib/appleMusicPlayerTransition') return artworkRules;
      if (name === '../../modules/liquid-glass') return {
        isNativePlayerSurfaceClipAvailable: nativeArtwork,
        updateNativePlayerSurfaceClip: (...values: number[]) => { clips.push(values); },
      };
      if (name === './useAppleMusicPlayerMotion' && nativeArtwork) {
        if (!artworkExports.useAppleMusicPlayerMotion) runInNewContext(artworkCompiled, {
          exports: artworkExports, require: requireModule,
          requestAnimationFrame: (callback: () => void) => { frames.push(callback); },
        });
        return artworkExports;
      }
      if (name === './useAppleMusicPlayerMotion') return {
        // This suite exercises the existing header/navigation fallback when no
        // artwork reader or native clip host was supplied. The new hook has
        // its own mounted-hook suite; keep this boundary out of its lifecycle.
        useAppleMusicPlayerMotion: ({ offset, readArtwork }: { offset: Mutable; readArtwork?: unknown }) => {
          assert.equal(readArtwork, undefined);
          if (!artworkFallbacks.has(offset)) artworkFallbacks.set(offset, {
            running: { get: () => false }, phase: { get: () => 'idle' },
            surfaceOffset: { get: () => bus.revealOffset.get() >= 0 ? bus.revealOffset.get() : offset.get() },
            beginClose: () => false, beginDrag: () => false, updateDrag: () => false,
            shouldDismissDrag() { assert.fail('unavailable artwork cannot decide a morph dismissal'); },
            abandon() {}, cancelDrag() { assert.fail('unavailable artwork cannot own a header drag'); },
            available: false, handlesEntry: false, entryReady: true,
            contentStyle: {}, artworkStyle: {}, controlsStyle: {}, onArtworkLayout() {}, onClipHostReady() {}, onContentClipHostReady() {},
          });
          return artworkFallbacks.get(offset);
        },
      };
      if (name === '@/theme/motion') return { motion: { reduceMotion: { essential: 'system' }, duration: { move: 220 }, easing: {} } };
      throw new Error(`Unexpected transition import ${name}`);
    },
  });
  let result: any;
  let back: () => boolean;
  let preventRemove: (event: unknown) => void;
  const render = (next: Partial<typeof props> = {}) => {
    Object.assign(props, next); cursor = 0; result = exports.useAmllPlayerTransition(props);
    while (effects.length) effects.shift()!();
    flushUI();
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
    const range = pan().options.activeOffsetY;
    const activates = Array.isArray(range) ? translationY < range[0] || translationY > range[1]
      : range >= 0 ? translationY > range : translationY < range;
    if (!activates) return false;
    const event: Event = { translationY, velocityY };
    pan().callbacks.start(); pan().callbacks.update(event); flushUI();
    pan().callbacks.end(event, true); pan().callbacks.finalize(event, true); flushUI();
    return true;
  };
  return { layout, headerArea, headerScrollOffset, accepts, drag, pan, render, bus, flushUI,
    clips, measurements: () => measurements,
    style: () => result.rootStyle.updater(),
    motionAnimation: () => values.find((value) => value.animation?.kind === 'spring')?.animation,
    frame() {
      if (nativeArtwork && !clips.length) { result.onClipHostReady({ nativeEvent: { hostId: 1, cornerRadius: 40 } }); flushUI(); }
      const pending = frames.splice(0); for (const callback of pending) callback(); flushUI();
    },
    advanceMotion(position: number, complete = false) {
      const progress = values.find((value) => value.animation?.kind === 'spring');
      assert.ok(progress, `missing motion spring for ${position}`);
      const animation = progress.animation;
      progress.value = position;
      if (complete) { progress.animation = undefined; animation?.done?.(true); }
      flushUI();
    },
    close: () => result.close(), back: () => back(),
    navigateBack: () => preventRemove({ data: { action: { type: 'GO_BACK' } } }),
    unmount() { for (const value of slots) value?.cleanup?.(); reactions.clear(); },
    root: () => values[0], queued: () => queued.length, navigations: () => navigations,
    drain() { while (queued.length) queued.shift()!(); flushUI(); },
    finish() {
      const value = values[0]; const animation = value.animation; value.animation = undefined;
      if (animation) { value.value = animation.target; animation.done?.(true); }
      flushUI();
    },
  };
}

describe('AMLL visible header dismissal gesture', () => {
  it('covers the whole band below the status bar through artwork and metadata while excluding all playback controls', () => {
    const h = harness();
    assert.equal(h.pan().options.hitSlop.top, -30);
    assert.equal(h.pan().options.hitSlop.height, h.headerArea.bottom - 30);
    assert.equal(h.headerArea.bottom, 30 + layoutRules.AMLL_TOP_PADDING + h.layout.headerHeight + h.layout.controlsTop);
    assert.equal(h.accepts(1, 31), true);
    assert.equal(h.accepts(411, h.headerArea.bottom - 1), true);
    assert.equal(h.accepts(206, 29), false);
    assert.equal(h.accepts(206, h.headerArea.bottom), false);
    assert.equal(h.accepts(206, h.headerArea.handleBottom + h.layout.largeCover.y + h.layout.largeCover.size / 2), true);
    assert.equal(h.accepts(206, h.headerArea.handleBottom + h.layout.metadataTop + 20), true);
    assert.equal(h.drag(206, h.headerArea.handleBottom + h.layout.controlsTop + 10), false);
    assert.equal(h.queued(), 0);
    assert.equal(h.root().get(), 0);
  });

  it('closes once from the large artwork while leaving upward column scrolling and taps available', () => {
    const h = harness(320, 440, false, 2.5);
    const coverY = h.headerArea.handleBottom + h.layout.largeCover.y + h.layout.largeCover.size / 2;
    assert.equal(h.layout.scrollable, true);
    assert.equal(h.drag(160, coverY, -160), false, 'upward scrolling cannot activate dismissal');
    assert.equal(h.drag(160, coverY, 0), false, 'metadata/cover taps cannot activate dismissal');
    assert.equal(h.queued(), 0);
    assert.equal(h.root().get(), 0);
    assert.equal(h.drag(160, coverY, 200), true);
    h.drain(); h.render(); h.finish(); h.drain(); h.render();
    assert.equal(h.navigations(), 1);
    h.drain(); h.render();
    assert.equal(h.navigations(), 1);
  });

  it('keeps playback controls outside the enlarged cover area after an accessibility column scroll', () => {
    const h = harness(320, 440, false, 2.5);
    h.headerScrollOffset.set(80);
    assert.equal(h.accepts(160, h.headerArea.bottom - 81), true);
    assert.equal(h.drag(160, h.headerArea.bottom - 79), false);
    h.headerScrollOffset.set(1000);
    assert.equal(h.accepts(160, h.headerArea.handleBottom - 1), true);
    assert.equal(h.drag(160, h.headerArea.handleBottom + 1), false);
    assert.equal(h.queued(), 0);
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
    assert.equal(h.pan().options.activeOffsetY, 6);
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

  it('publishes the exact dragged surface offset and follows a cancelled pull back to a covered dock', () => {
    const h = harness(412, 840, true);
    h.pan().callbacks.start();
    h.pan().callbacks.update({ translationY: 600, velocityY: 0 }); h.flushUI();
    assert.equal(h.bus.playerSurfaceOffset.get(), 600);
    assert.equal(h.bus.playerSurfaceHeight.get(), 840);
    assert.equal(h.bus.playerDockClipOffset(600, 840, 840), -240);
    h.pan().callbacks.finalize({ translationY: 600, velocityY: 0 }, false);
    h.finish();
    assert.equal(h.bus.playerSurfaceOffset.get(), 0);
    assert.equal(h.bus.playerDockClipOffset(0, 840, 840), -840);
    assert.equal(h.navigations(), 0);
  });

  it('uses the same dock progress for button, hardware Back and navigation close, retaining the full endpoint through pop', () => {
    for (const source of ['close', 'back', 'navigateBack'] as const) {
      const h = harness(412, 840, true);
      h[source]();
      h.root().value = 420; h.flushUI();
      assert.equal(h.bus.playerSurfaceOffset.get(), 420, source);
      assert.equal(h.navigations(), 0, source);
      h.finish(); h.drain(); h.render();
      assert.equal(h.bus.playerSurfaceOffset.get(), 840, source);
      assert.equal(h.navigations(), 1, source);
      h.unmount();
      assert.equal(h.bus.playerSurfaceOffset.get(), 840, `${source}: no disappearing dock before globals receive route pop`);
    }
  });

  it('does not let an old player cleanup clear a newer player or mini reveal owner', () => {
    const h = harness();
    const owner = h.bus.playerSurfaceOwner.get();
    h.bus.playerSurfaceOwner.set(owner + 1);
    h.bus.playerSurfaceOffset.set(320);
    h.bus.revealOffset.set(125);
    h.unmount();
    assert.equal(h.bus.playerSurfaceOwner.get(), owner + 1);
    assert.equal(h.bus.playerSurfaceOffset.get(), 320);
    assert.equal(h.bus.revealOffset.get(), 125);
  });

  it('keeps a live mini-player pull owned across a viewport height change', () => {
    const h = harness();
    const owner = h.bus.playerSurfaceOwner.get();
    h.bus.revealOffset.set(420); h.flushUI();
    h.render({ height: 412 });
    assert.equal(h.bus.playerSurfaceOwner.get(), owner);
    assert.equal(h.bus.revealOffset.get(), 420);
    assert.equal(h.bus.playerSurfaceOffset.get(), 420);
    assert.equal(h.bus.playerSurfaceHeight.get(), 412);
    assert.equal(h.navigations(), 0);
  });
});

describe('mounted player header and LNPopup motion coordination', () => {
  function open(lyrics = false) {
    const h = harness(412, 840, lyrics, 1, true);
    h.frame(); h.advanceMotion(1, true); h.drain(); h.render();
    assert.equal(h.bus.playerArtworkFlight.get(), null);
    assert.equal(h.root().get(), 0);
    return h;
  }

  it('uses the shared morph while a cover or lyric-header finger moves, keeping the root fixed until one final route commit', () => {
    for (const lyrics of [false, true]) {
      const h = open(lyrics);
      const y = lyrics ? h.headerArea.bottom - 1
        : h.headerArea.handleBottom + h.layout.largeCover.y + h.layout.largeCover.size / 2;
      assert.equal(h.accepts(200, y), true);
      h.pan().callbacks.start(); h.pan().callbacks.update({ translationY: 140, velocityY: 300 }); h.flushUI();
      const dragged = h.bus.playerArtworkFlight.get();
      assert.equal(dragged.phase, 'dragging');
      assert.ok(dragged.frame.artwork.rect.width < 356);
      assert.ok(dragged.frame.background.rect.y > 0);
      assert.ok(dragged.frame.miniContentOpacity > 0);
      assert.equal(h.root().get(), 0, 'the parent cannot add its old page translation to the morph');
      assert.equal(h.style().transform[0].translateY, 0);
      assert.equal(h.measurements(), 2, 'one entry capture and one drag capture');
      assert.equal(h.navigations(), 0);
      h.pan().callbacks.end({ translationY: 140, velocityY: 300 }, true);
      h.pan().callbacks.finalize({ translationY: 140, velocityY: 300 }, true);
      assert.equal(h.queued(), 1, 'only the final close request crosses to RN');
      h.drain(); h.render();
      assert.equal(h.bus.playerArtworkFlight.get().phase, 'closing');
      assert.equal(h.navigations(), 0);
      assert.equal(h.style().transform[0].translateY, 0);
      h.advanceMotion(0, true);
      assert.equal(h.bus.playerArtworkFlight.get().phase, 'handoff');
      assert.equal(h.navigations(), 0, 'native progress completion must still pass the removal gate');
      h.drain(); h.render();
      assert.equal(h.navigations(), 1);
      h.drain(); h.render(); assert.equal(h.navigations(), 1);
    }
  });

  it('returns a short reversed gesture to the full player without sending a close request or moving the page root', () => {
    const h = open(true);
    h.pan().callbacks.start(); h.pan().callbacks.update({ translationY: 140, velocityY: -50 }); h.flushUI();
    const before = JSON.stringify(h.bus.playerArtworkFlight.get().frame);
    h.pan().callbacks.end({ translationY: 140, velocityY: -50 }, true);
    h.pan().callbacks.finalize({ translationY: 140, velocityY: -50 }, true); h.flushUI();
    assert.equal(h.bus.playerArtworkFlight.get().phase, 'cancelling');
    assert.equal(JSON.stringify(h.bus.playerArtworkFlight.get().frame), before);
    assert.equal(h.queued(), 0);
    assert.equal(h.style().transform[0].translateY, 0);
    h.advanceMotion(1, true); h.drain(); h.render();
    assert.equal(h.bus.playerArtworkFlight.get(), null);
    assert.equal(h.bus.playerSurfaceOffset.get(), 0);
    assert.equal(h.style().transform[0].translateY, 0);
    assert.equal(h.navigations(), 0);
  });

  it('admits an opening interruption, carries its painted frame into Back and ignores a late opening completion', () => {
    const h = harness(412, 840, false, 1, true);
    h.frame();
    const oldOpening = h.motionAnimation()?.done;
    h.advanceMotion(.6);
    const before = JSON.stringify(h.bus.playerArtworkFlight.get().frame);
    assert.equal(h.accepts(200, h.headerArea.bottom - 1), true);
    h.pan().callbacks.start(); h.flushUI();
    assert.equal(h.bus.playerArtworkFlight.get().phase, 'dragging');
    assert.equal(JSON.stringify(h.bus.playerArtworkFlight.get().frame), before);
    assert.equal(h.style().transform[0].translateY, 0);
    assert.equal(h.back(), true); h.flushUI();
    assert.equal(h.bus.playerArtworkFlight.get().phase, 'closing');
    oldOpening?.(true); h.flushUI();
    assert.equal(h.bus.playerArtworkFlight.get().phase, 'closing');
    assert.equal(h.navigations(), 0);
    h.advanceMotion(0, true); h.drain(); h.render();
    assert.equal(h.navigations(), 1);
  });

  it('keeps a missing-endpoint slide at its current position when Back arrives before entry has finished', () => {
    const h = harness(412, 840, false, 1, true);
    h.bus.miniArtworkMetrics.set(null);
    for (let attempt = 0; attempt < 4; attempt++) h.frame();
    assert.equal(h.root().animation?.kind, 'timing');
    assert.equal(h.root().animation?.target, 0);
    h.root().value = 200; h.flushUI();
    assert.equal(h.style().transform[0].translateY, 200);
    h.back(); h.flushUI();
    assert.equal(h.root().get(), 200, 'fallback closing starts from the already painted slide position');
    assert.equal(h.root().animation?.target, 840);
    assert.equal(h.bus.playerArtworkFlight.get(), null);
    assert.equal(h.navigations(), 0);
    h.finish(); h.drain(); h.render();
    assert.equal(h.navigations(), 1);
  });
});
