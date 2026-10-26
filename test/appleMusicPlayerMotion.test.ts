import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import * as artworkRules from '@/lib/appleMusicPlayerTransition';

type Deps = readonly unknown[] | undefined;
type Animation = { kind: 'spring' | 'timing'; target: number; options: Record<string, unknown>; done?: (finished: boolean) => void };
type Mutable = { value: any; animation?: Animation; get(): any; set(value: any): void };
type Reaction = { prepare: () => any; react: (value: any, previous: any) => void; previous: any };
type Rect = artworkRules.AppleMusicRect;
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const hookSource = compile('../src/hooks/useAppleMusicPlayerMotion.ts');
const busSource = compile('../src/lib/playerReveal.ts');
const makeMutable = (initial: unknown): Mutable => ({ value: initial,
  get() { return this.value; },
  set(value) {
    if (value?.kind === 'spring' || value?.kind === 'timing') this.animation = value;
    else { this.value = value; this.animation = undefined; }
  },
});
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `expected ${expected}, received ${actual}`);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function assertContinuousFrame(actual: artworkRules.AppleMusicPlayerTransitionFrame,
  expected: artworkRules.AppleMusicPlayerTransitionFrame) {
  // Closing recovers the independent window clock from its scale. That
  // subtract/divide round trip may change translateY by a few IEEE-754 ULPs.
  // Keep every artwork/background/opacity value exact; tolerate only this
  // recovered scalar, at machine precision rather than a visible dp epsilon.
  const actualY = actual.underlay.translateY;
  const expectedY = expected.underlay.translateY;
  const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(actualY), Math.abs(expectedY));
  assert.ok(Math.abs(actualY - expectedY) <= tolerance,
    `window translation changed from ${expectedY} to ${actualY}`);
  assert.deepEqual(plain({ ...actual, underlay: { ...actual.underlay, translateY: expectedY } }), expected);
}
const mini = () => ({ viewportWidth: 400, viewportHeight: 800,
  miniPlayer: { x: 12, y: 700, width: 376, height: 56 },
  miniArtwork: { x: 20, y: 708, width: 40, height: 40 } });

// Run the real hook and the real makeMutable-based bus in one module world.
// Only React storage, UI scheduling and native animation/clip boundaries are
// supplied here. Progress and completion are advanced independently so queued
// callbacks, the p=0 handoff frame and cancellation remain observable.
function world(nativeAvailable = true) {
  const bus: Record<string, any> = {};
  runInNewContext(busSource, { exports: bus, require: () => ({ makeMutable }) });
  const clips: number[][] = [];
  const mount = (initial: { fromMini?: boolean; revealing?: boolean; owner?: number; readArtwork?: (() => Rect | null) | null; clipReady?: boolean } = {}) => {
    let cursor = 0;
    let stateWrites = 0;
    let measurements = 0;
    const slots: any[] = [];
    const effects: (() => void)[] = [];
    const cleanups = new Set<() => void>();
    const reactions = new Set<Reaction>();
    const values: Mutable[] = [];
    const frames: (() => void)[] = [];
    const rn: (() => void)[] = [];
    const finishes: number[] = [];
    const owner = initial.owner ?? bus.createPlayerSurfaceOwner();
    const offset = makeMutable(initial.revealing ? 0 : 800);
    let artwork: Rect | null = { x: 25, y: 110, width: 350, height: 350 };
    const read = initial.readArtwork === null ? undefined : () => {
      measurements++;
      return initial.readArtwork ? initial.readArtwork() : artwork;
    };
    const props = { width: 400, height: 800, owner, fromMini: initial.fromMini ?? true,
      revealing: initial.revealing ?? false, offset, readArtwork: read,
      finish: (generation: number) => { finishes.push(generation); }, controlsHeight: 250,
      focused: true, artworkIdentity: 'track-A' };
    const slot = <T,>(create: () => T): T => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = create();
      return slots[index];
    };
    const changed = (a: Deps, b: Deps) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
    const memo = <T,>(create: () => T, deps: Deps): T => {
      const saved = slot(() => ({ deps: undefined as Deps, value: undefined as T | undefined }));
      if (changed(saved.deps, deps)) { saved.deps = deps; saved.value = create(); }
      return saved.value as T;
    };
    const effect = (create: () => (() => void) | void, deps: Deps) => {
      const saved = slot(() => ({ deps: undefined as Deps, cleanup: undefined as (() => void) | undefined }));
      if (!changed(saved.deps, deps)) return;
      saved.deps = deps;
      effects.push(() => {
        if (saved.cleanup) { cleanups.delete(saved.cleanup); saved.cleanup(); }
        saved.cleanup = create() || undefined;
        if (saved.cleanup) cleanups.add(saved.cleanup);
      });
    };
    const react = {
      useRef: (value: unknown) => slot(() => ({ current: value })),
      useState: (initial: unknown) => {
        const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
        return [state.value, (next: any) => { stateWrites++; state.value = typeof next === 'function' ? next(state.value) : next; }];
      },
      useCallback: (callback: unknown, deps: Deps) => memo(() => callback, deps),
      useLayoutEffect: effect,
    };
    const exported: Record<string, any> = {};
    runInNewContext(hookSource, { exports: exported,
      requestAnimationFrame: (callback: () => void) => { frames.push(callback); },
      require(name: string) {
        if (name === 'react') return react;
        if (name === 'react-native-worklets') return {
          scheduleOnUI: (callback: () => void) => callback(),
          scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => rn.push(() => callback(...args)),
        };
        if (name === 'react-native-reanimated') return {
          useSharedValue: (value: unknown) => slot(() => { const result = makeMutable(value); values.push(result); return result; }),
          useDerivedValue: (updater: () => unknown) => {
            const result = slot(() => ({ updater, get() { return this.updater(); } }));
            result.updater = updater; return result;
          },
          useAnimatedStyle: (updater: () => unknown) => ({ updater }),
          useAnimatedReaction: (prepare: () => any, react: (value: any, previous: any) => void) => {
            const reaction = slot(() => { const result = { prepare, react, previous: undefined }; reactions.add(result); return result; });
            reaction.prepare = prepare; reaction.react = react;
          },
          withSpring: (target: number, options: Record<string, unknown>, done?: Animation['done']) => ({ kind: 'spring', target, options, done }),
          withTiming: (target: number, options: Record<string, unknown>, done?: Animation['done']) => ({ kind: 'timing', target, options, done }),
          cancelAnimation: (value: Mutable) => { value.animation = undefined; },
          Easing: { out: (value: unknown) => value, cubic: 'cubic' },
        };
        if (name === '@/lib/appleMusicPlayerTransition') return artworkRules;
        if (name === '@/lib/playerReveal') return bus;
        if (name === '@/theme/motion') return { motion: { reduceMotion: { essential: 'system' } } };
        if (name === '../../modules/liquid-glass') return {
          isNativePlayerSurfaceClipAvailable: nativeAvailable,
          updateNativePlayerSurfaceClip: (...values: number[]) => { clips.push(values); },
        };
        throw new Error(`Unexpected artwork motion import ${name}`);
      },
    });
    const flushUI = () => {
      for (let turn = 0; turn < 20; turn++) {
        let changed = false;
        for (const reaction of reactions) {
          const value = reaction.prepare();
          if (JSON.stringify(value) === JSON.stringify(reaction.previous)) continue;
          const previous = reaction.previous; reaction.previous = value;
          reaction.react(value, previous); changed = true;
        }
        if (!changed) return;
      }
      assert.fail('UI reactions failed to settle');
    };
    let result: ReturnType<typeof import('../src/hooks/useAppleMusicPlayerMotion').useAppleMusicPlayerMotion>;
    const render = (next: Partial<typeof props> = {}) => {
      Object.assign(props, next); cursor = 0;
      result = exported.useAppleMusicPlayerMotion(props);
      while (effects.length) effects.shift()!();
      flushUI(); return result;
    };
    const advance = (value: Mutable, position: number, complete = false) => {
      const animation = value.animation;
      value.value = position;
      if (complete) { value.animation = undefined; animation?.done?.(true); }
      flushUI();
    };
    bus.playerSurfaceOwner.set(owner);
    render();
    const attachClip = () => {
      if (nativeAvailable && initial.clipReady !== false && values[3].get() <= 0) {
        result.onClipHostReady({ nativeEvent: { hostId: 1 } }); flushUI();
      }
    };
    if (initial.fromMini === false) attachClip();
    return {
      get result() { return result; }, owner, offset, finishes, render, flushUI, advance,
      // Production shared-value allocation order, not a replacement policy.
      progress: () => values[1],
      setArtwork: (value: Rect | null) => { artwork = value; },
      measurements: () => measurements, writes: () => stateWrites,
      pendingFrames: () => frames.length, pendingRN: () => rn.length,
      frame() { attachClip(); const next = frames.splice(0); for (const callback of next) callback(); flushUI(); },
      drainRN() { while (rn.length) rn.shift()!(); flushUI(); },
      unmount() { for (const cleanup of cleanups) cleanup(); cleanups.clear(); reactions.clear(); },
      style: (name: 'contentStyle' | 'artworkStyle' | 'controlsStyle') => (result[name] as unknown as { updater(): any }).updater(),
    };
  };
  bus.miniArtworkMetrics.set(mini());
  bus.playerCanReturnToMini.set(true);
  return { bus, clips, mount };
}

describe('mounted Apple Music artwork motion lifecycle', () => {
  it('waits for the native background host before publishing a hero and wakes once when that host arrives', () => {
    const w = world(); const h = w.mount({ clipReady: false });
    h.frame(); h.frame();
    assert.equal(h.result.phase.get(), 'preparing');
    assert.equal(h.measurements(), 0);
    assert.equal(h.style('contentStyle').opacity, 0);
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    assert.equal(w.clips.length, 0);
    assert.equal(h.pendingFrames(), 1);
    h.result.onClipHostReady({ nativeEvent: { hostId: 61 } }); h.flushUI();
    assert.equal(h.pendingFrames(), 1, 'ready must not duplicate an already queued attempt');
    h.frame();
    assert.equal(h.result.phase.get(), 'opening');
    assert.equal(h.measurements(), 1);
    assert.ok(w.bus.playerArtworkFlight.get());
    assert.equal(w.clips.at(-1)?.[0], 61);
    assert.equal(h.style('contentStyle').backgroundColor, 'transparent');
    h.result.onClipHostReady({ nativeEvent: { hostId: 61 } }); h.flushUI();
    assert.equal(h.pendingFrames(), 0, 'an attached host cannot replay an opening');
  });

  it('bounds a permanently missing host, paints an opaque slide fallback and accepts a late host without restarting entry', () => {
    const w = world(); const h = w.mount({ clipReady: false });
    for (let attempt = 0; attempt < 4; attempt++) h.frame();
    assert.equal(h.pendingFrames(), 0);
    assert.equal(h.result.phase.get(), 'idle');
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    assert.equal(h.style('contentStyle').backgroundColor, '#25252D');
    assert.equal(h.style('contentStyle').opacity, 1);
    assert.equal(h.offset.animation?.target, 0);
    h.advance(h.offset, 0, true); h.drainRN();
    assert.equal(h.render().entryReady, true, 'a missing event cannot block controls forever');
    h.result.onClipHostReady({ nativeEvent: { hostId: 62 } }); h.flushUI();
    assert.equal(h.result.phase.get(), 'idle');
    assert.equal(h.pendingFrames(), 0);
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    assert.equal(h.style('contentStyle').backgroundColor, 'transparent');
    assert.deepEqual(w.clips.at(-1), [62, 0, 0, 400, 800, 0, 1]);
  });

  it('refuses a hero close before the host is ready so Close or Back can abandon preparation through the parent fallback', () => {
    const w = world(); const h = w.mount({ clipReady: false });
    assert.equal(h.result.beginClose(7), false);
    assert.equal(h.pendingRN(), 0);
    h.result.abandon(); h.flushUI(); h.frame();
    assert.equal(h.result.phase.get(), 'idle');
    assert.equal(h.pendingFrames(), 0);
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    assert.equal(h.style('contentStyle').backgroundColor, '#25252D');
  });

  it('prepares without showing full content, then flies one measured cover while keeping fixed geometry', () => {
    const w = world(); const h = w.mount();
    assert.equal(h.result.phase.get(), 'preparing');
    assert.equal(h.result.entryReady, false);
    assert.equal(h.style('contentStyle').opacity, 0);
    assert.equal(h.result.surfaceOffset.get(), 800);
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    h.result.onClipHostReady({ nativeEvent: { hostId: 41, cornerRadius: 44 } }); h.flushUI();
    assert.deepEqual(w.clips.at(-1), [41, 0, 0, 400, 800, 0, 0]);
    h.frame();
    assert.equal(h.result.phase.get(), 'opening');
    assert.equal(h.progress().animation?.kind, 'spring');
    assert.equal(h.progress().animation?.target, 1);
    assert.equal(h.progress().animation?.options.duration, 200);
    assert.equal(h.progress().animation?.options.dampingRatio, 1);
    assert.equal(h.style('artworkStyle').opacity, 0);
    let flight = w.bus.playerArtworkFlight.get();
    assert.equal(flight.owner, h.owner);
    assert.deepEqual(plain(flight.frame.artwork.rect), { ...mini().miniArtwork, cornerRadius: 7 });
    assert.equal(flight.frame.artwork.baseWidth, 350);
    assert.equal(h.measurements(), 1);
    w.bus.miniArtworkMetrics.set({ ...mini(), miniArtwork: { x: 100, y: 600, width: 48, height: 48 } });
    h.setArtwork({ x: 10, y: 10, width: 72, height: 72 });
    h.advance(h.progress(), .5);
    flight = w.bus.playerArtworkFlight.get();
    assert.deepEqual(plain(flight.frame.artwork.rect), { x: 22.5, y: 409, width: 195, height: 195, cornerRadius: 8.5 });
    assert.equal(h.style('controlsStyle').transform[0].translateY, 125);
    assert.deepEqual(w.clips.at(-1), [41, 6, 350, 388, 428, 29, .5]);
    assert.equal(h.measurements(), 1, 'endpoints remain frozen between frames');
    assert.equal(h.pendingRN(), 0, 'geometry does not dispatch JS every frame');
    h.advance(h.progress(), 1, true);
    assert.equal(h.result.phase.get(), 'idle');
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    assert.equal(h.style('artworkStyle').opacity, 1);
    assert.equal(h.pendingRN(), 1);
    h.drainRN(); assert.equal(h.render().entryReady, true);
  });

  it('bounds missing endpoint retries and finishes the existing slide before enabling entry', () => {
    const w = world(); w.bus.miniArtworkMetrics.set(null);
    const h = w.mount();
    for (let attempt = 0; attempt < 4; attempt++) h.frame();
    assert.equal(h.pendingFrames(), 0);
    assert.equal(h.measurements(), 4, 'one attempt plus three bounded next-frame retries');
    assert.equal(h.result.phase.get(), 'idle');
    assert.equal(h.offset.animation?.kind, 'timing');
    assert.equal(h.offset.animation?.target, 0);
    assert.equal(h.pendingRN(), 0);
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    h.advance(h.offset, 0, true); h.drainRN();
    assert.equal(h.render().entryReady, true);
  });

  it('allows an artwork layout to supply measurements before the queued frame without starting twice', () => {
    const w = world(); const h = w.mount();
    h.result.onClipHostReady({ nativeEvent: { hostId: 1 } }); h.flushUI();
    h.result.onArtworkLayout(); h.flushUI();
    const opening = h.progress().animation;
    h.frame();
    assert.equal(h.result.phase.get(), 'opening');
    assert.equal(h.measurements(), 1);
    assert.equal(h.progress().animation, opening);
  });

  it('preserves the original unavailable-native and non-mini entry paths', () => {
    for (const options of [{ native: false }, { readArtwork: null }, { fromMini: false }]) {
      const w = world('native' in options ? options.native : true);
      const h = w.mount(options);
      assert.equal(h.result.handlesEntry, false);
      assert.equal(h.result.entryReady, true);
      assert.equal(h.result.phase.get(), 'idle');
      assert.equal(h.pendingFrames(), 0);
      assert.equal(h.measurements(), 0);
      assert.equal(w.bus.playerArtworkFlight.get(), null);
    }
  });

  it('starts dismissal from the released painted artwork and waits at p=0 before the single route handoff', () => {
    const w = world(); const h = w.mount({ fromMini: false });
    h.offset.set(160); h.setArtwork({ x: 25, y: 270, width: 350, height: 350 });
    assert.equal(h.result.beginClose(7), true); h.flushUI();
    assert.equal(h.result.phase.get(), 'closing');
    assert.equal(w.bus.playerArtworkFlight.get().frame.artwork.rect.y, 270);
    assert.equal(h.offset.get(), 160, 'release drag is animated, not reset before the first frame');
    assert.equal(h.offset.animation?.target, 0);
    assert.equal(h.progress().animation?.target, 0);
    h.advance(h.offset, 80); h.advance(h.progress(), .5);
    assert.equal(w.bus.playerArtworkFlight.get().frame.artwork.rect.y, 489);
    const complete = h.progress().animation?.done;
    h.advance(h.offset, 0, true); h.advance(h.progress(), 0);
    assert.equal(h.result.phase.get(), 'closing');
    assert.equal(h.pendingRN(), 0);
    assert.equal(h.style('artworkStyle').opacity, 0);
    assert.deepEqual(plain(w.bus.playerArtworkFlight.get().frame.artwork.rect), { ...mini().miniArtwork, cornerRadius: 7 });
    complete?.(true); h.flushUI();
    assert.equal(h.result.phase.get(), 'handoff');
    assert.equal(h.pendingRN(), 1);
    assert.equal(w.bus.playerArtworkFlight.get().phase, 'handoff');
    complete?.(true); h.drainRN();
    assert.deepEqual(h.finishes, [7]);
    assert.equal(h.style('artworkStyle').opacity, 0, 'the mini destination takes ownership only at actual route handoff');
    h.unmount(); assert.equal(w.bus.playerArtworkFlight.get(), null);
  });

  it('reverses an in-flight opening continuously and ignores its stale opening completion', () => {
    const w = world(); const h = w.mount(); h.frame();
    const openingDone = h.progress().animation?.done;
    h.advance(h.progress(), .37);
    const before = plain(w.bus.playerArtworkFlight.get().frame);
    assert.equal(h.result.beginClose(8), true); h.flushUI();
    assert.equal(h.progress().get(), .37);
    assertContinuousFrame(w.bus.playerArtworkFlight.get().frame, before);
    assert.equal(h.measurements(), 1);
    openingDone?.(true); h.flushUI();
    assert.equal(h.result.phase.get(), 'closing');
    assert.equal(h.pendingRN(), 0);
    h.advance(h.progress(), 0, true); h.drainRN();
    assert.deepEqual(h.finishes, [8]);
  });

  it('extends MiniPlayer upward pulling into the same measured interpolation and settles only after the pull relinquishes ownership', () => {
    const w = world(); w.bus.revealOffset.set(800);
    const h = w.mount({ revealing: true }); h.frame();
    assert.equal(h.progress().animation, undefined);
    assert.equal(w.bus.playerArtworkFlight.get().frame.artwork.rect.width, 40);
    w.bus.revealOffset.set(400); h.flushUI();
    near(w.bus.playerArtworkFlight.get().frame.artwork.rect.width, 195);
    near(h.result.surfaceOffset.get(), 400);
    w.bus.revealOffset.set(0); h.flushUI();
    assert.equal(h.result.phase.get(), 'opening');
    assert.equal(w.bus.playerArtworkFlight.get().frame.artwork.rect.width, 350);
    assert.equal(h.pendingRN(), 0);
    w.bus.revealOffset.set(-1); h.flushUI();
    assert.equal(h.result.phase.get(), 'idle');
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    h.drainRN(); assert.equal(h.render().entryReady, true);
  });

  it('carries an interrupted MiniPlayer pull into Back without resetting its rectangle or adding the drag twice', () => {
    const w = world(); w.bus.revealOffset.set(520);
    const h = w.mount({ revealing: true }); h.frame();
    const before = plain(w.bus.playerArtworkFlight.get().frame);
    assert.equal(h.result.beginClose(9), true); h.flushUI();
    near(h.progress().get(), .35);
    assert.equal(h.offset.get(), 0);
    assert.equal(w.bus.revealOffset.get(), -1);
    assertContinuousFrame(w.bus.playerArtworkFlight.get().frame, before);
    h.advance(h.progress(), 0, true); h.drainRN();
    assert.deepEqual(h.finishes, [9]);
  });

  it('returns a cancelled MiniPlayer pull to its own mini endpoint without committing a close', () => {
    const w = world(); w.bus.revealOffset.set(400);
    const h = w.mount({ revealing: true }); h.frame();
    w.bus.revealOffset.set(800); h.flushUI();
    assert.equal(w.bus.playerArtworkFlight.get().frame.artwork.rect.width, 40);
    assert.equal(h.result.phase.get(), 'opening');
    assert.equal(h.style('artworkStyle').opacity, 0);
    assert.equal(h.pendingRN(), 0);
    h.unmount(); h.drainRN();
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    assert.deepEqual(h.finishes, []);
  });

  it('springs an ordinary cancelled header drag back without starting an artwork flight or navigation', () => {
    const w = world(); const h = w.mount({ fromMini: false });
    h.offset.set(90); h.result.cancelDrag(); h.flushUI();
    assert.equal(h.offset.get(), 90);
    assert.equal(h.offset.animation?.kind, 'spring');
    assert.equal(h.offset.animation?.target, 0);
    assert.equal(h.progress().animation, undefined);
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    h.advance(h.offset, 0, true); h.drainRN();
    assert.deepEqual(h.finishes, []);
  });

  it('rejects queue-origin, stale viewport and unavailable endpoint dismissals so the parent retains its slide fallback', () => {
    for (const reason of ['queue', 'viewport', 'missing', 'native'] as const) {
      const w = world(reason !== 'native'); const h = w.mount({ fromMini: false });
      h.offset.set(180);
      if (reason === 'queue') w.bus.playerCanReturnToMini.set(false);
      if (reason === 'viewport') w.bus.miniArtworkMetrics.set({ ...mini(), viewportWidth: 800, viewportHeight: 400 });
      if (reason === 'missing') h.setArtwork(null);
      assert.equal(h.result.beginClose(1), false);
      assert.equal(h.offset.get(), 180);
      assert.equal(h.offset.animation, undefined);
      assert.equal(h.result.phase.get(), 'idle');
      assert.equal(w.bus.playerArtworkFlight.get(), null);
      assert.equal(h.pendingRN(), 0);
    }
  });

  it('keeps a newer player flight safe from an old owner completion and cleanup', () => {
    const w = world(); const old = w.mount(); old.frame();
    old.advance(old.progress(), .4);
    old.result.beginClose(1); old.flushUI();
    const staleDone = old.progress().animation?.done;
    const fresh = w.mount(); fresh.frame(); fresh.advance(fresh.progress(), .6);
    const freshFlight = w.bus.playerArtworkFlight.get();
    staleDone?.(true); old.flushUI();
    assert.equal(old.pendingRN(), 0);
    assert.equal(old.result.beginClose(2), false);
    old.unmount();
    assert.equal(w.bus.playerArtworkFlight.get(), freshFlight);
    assert.equal(w.bus.playerArtworkFlight.get().owner, fresh.owner);
    old.drainRN(); assert.deepEqual(old.finishes, []);
  });

  it('drops a queued entry-ready update after unmount and stops queued measurement retries', () => {
    const w = world(); const h = w.mount(); h.frame();
    h.advance(h.progress(), 1, true);
    assert.equal(h.pendingRN(), 1);
    h.unmount(); h.drainRN(); assert.equal(h.writes(), 0);
    const retry = w.mount({ readArtwork: () => null });
    retry.frame(); assert.equal(retry.measurements(), 1);
    retry.unmount(); retry.frame();
    assert.equal(retry.measurements(), 1);
    assert.equal(retry.pendingFrames(), 0);
    assert.equal(retry.pendingRN(), 0);
  });

  it('ignores unsuccessful native animation completions and an entry fallback completion after unmount', () => {
    const w = world(); const h = w.mount(); h.frame();
    h.progress().animation?.done?.(false); h.flushUI();
    assert.equal(h.result.phase.get(), 'opening');
    assert.equal(h.pendingRN(), 0);
    h.result.beginClose(6); h.flushUI();
    h.progress().animation?.done?.(false); h.flushUI();
    assert.equal(h.result.phase.get(), 'closing');
    assert.equal(h.pendingRN(), 0);
    assert.deepEqual(h.finishes, []);
    const fallback = w.mount({ readArtwork: () => null });
    for (let attempt = 0; attempt < 4; attempt++) fallback.frame();
    const staleFallbackDone = fallback.offset.animation?.done;
    fallback.unmount(); staleFallbackDone?.(true); fallback.drainRN();
    assert.equal(fallback.writes(), 0);
  });

  it('abandons portrait opening measurements on rotation without replaying entry or accepting its old spring', () => {
    const w = world(); const h = w.mount(); h.frame(); h.advance(h.progress(), .4);
    const staleDone = h.progress().animation?.done;
    h.render({ width: 800, height: 400 });
    assert.equal(h.result.phase.get(), 'idle');
    assert.equal(h.offset.get(), 0);
    assert.equal(w.bus.playerArtworkFlight.get(), null);
    assert.equal(h.pendingFrames(), 0);
    assert.equal(h.measurements(), 1);
    staleDone?.(true); h.drainRN();
    assert.equal(h.render().entryReady, true);
    assert.equal(h.result.phase.get(), 'idle');
    assert.deepEqual(h.finishes, []);
  });

  it('does not restore an opaque full player when a closing viewport invalidates its portrait endpoints', () => {
    const w = world(); const h = w.mount({ fromMini: false }); h.offset.set(0);
    h.result.onClipHostReady({ nativeEvent: { hostId: 21 } });
    h.result.beginClose(10); h.flushUI(); h.advance(h.progress(), .4);
    const staleDone = h.progress().animation?.done;
    h.render({ width: 800, height: 400 });
    assert.equal(w.bus.playerArtworkFlight.get(), null, 'portrait hero coordinates cannot survive rotation');
    assert.equal(h.result.phase.get(), 'idle');
    assert.equal(h.result.running.get(), false);
    assert.equal(h.offset.get(), 400, 'the current viewport hides the surface before route removal');
    assert.equal(h.result.surfaceOffset.get(), 400);
    assert.equal(w.bus.revealOffset.get(), -1);
    assert.equal(h.progress().animation, undefined);
    assert.equal(h.pendingRN(), 1);
    staleDone?.(true); h.drainRN();
    assert.deepEqual(h.finishes, [10]);
  });

  it('removes the global flight immediately on focus loss and restores only the current owner on focus return', () => {
    const w = world(); const h = w.mount(); h.frame(); h.advance(h.progress(), .4);
    assert.equal(w.bus.playerArtworkFlight.get().owner, h.owner);
    h.render({ focused: false });
    assert.equal(w.bus.playerArtworkFlight.get(), null, 'an unrelated modal must not receive the old global artwork');
    h.render({ focused: true });
    assert.equal(w.bus.playerArtworkFlight.get().owner, h.owner);
    assert.equal(w.bus.playerArtworkFlight.get().frame.fullContentOpacity, .4);
  });

  it('retains its original underlying route after an upper Artist page takes focus and returns', () => {
    const w = world(); w.bus.playerUnderlayRouteKey.set('playlist-origin');
    const h = w.mount(); h.frame(); h.advance(h.progress(), .4);
    assert.equal(w.bus.playerUnderlayFrame.get().routeKey, 'playlist-origin');
    h.render({ focused: false });
    w.bus.playerUnderlayRouteKey.set('artist-above-player'); h.flushUI();
    assert.equal(w.bus.playerUnderlayFrame.get(), null);
    h.render({ focused: true });
    assert.equal(w.bus.playerUnderlayFrame.get().routeKey, 'playlist-origin');
    h.result.beginClose(20); h.flushUI();
    assert.equal(w.bus.playerUnderlayFrame.get().routeKey, 'playlist-origin');
  });

  it('captures an initially absent origin when its later layout effect publishes the first key', () => {
    const w = world(); const h = w.mount(); h.frame(); h.advance(h.progress(), .4);
    assert.equal(w.bus.playerUnderlayFrame.get(), null);
    w.bus.playerUnderlayRouteKey.set('late-home-origin'); h.flushUI();
    assert.equal(w.bus.playerUnderlayFrame.get().routeKey, 'late-home-origin');
    w.bus.playerUnderlayRouteKey.set('later-artist'); h.flushUI();
    assert.equal(w.bus.playerUnderlayFrame.get().routeKey, 'late-home-origin');
  });

  it('captures a fresh origin for a new player owner and keeps it safe from old owner cleanup', () => {
    const w = world(); w.bus.playerUnderlayRouteKey.set('first-home');
    const old = w.mount(); old.frame(); old.advance(old.progress(), .4);
    old.render({ focused: false });
    w.bus.playerUnderlayRouteKey.set('new-artist-origin');
    const fresh = w.mount(); fresh.frame(); fresh.advance(fresh.progress(), .6);
    assert.equal(w.bus.playerUnderlayFrame.get().routeKey, 'new-artist-origin');
    const freshFrame = w.bus.playerUnderlayFrame.get();
    old.unmount(); assert.equal(w.bus.playerUnderlayFrame.get(), freshFrame);
    w.bus.playerUnderlayRouteKey.set('another-page'); fresh.flushUI();
    assert.equal(w.bus.playerUnderlayFrame.get().routeKey, 'new-artist-origin');
  });

  it('settles a changed track during opening and completes a changed track during closing while hidden', () => {
    for (const closing of [false, true]) {
      const w = world(); const h = w.mount(); h.frame(); h.advance(h.progress(), .4);
      if (closing) { h.result.beginClose(12); h.flushUI(); }
      const staleDone = h.progress().animation?.done;
      h.render({ artworkIdentity: 'track-B' });
      assert.equal(h.result.phase.get(), 'idle');
      assert.equal(w.bus.playerArtworkFlight.get(), null);
      assert.equal(h.offset.get(), closing ? 800 : 0);
      assert.equal(h.progress().animation, undefined);
      assert.equal(h.pendingRN(), 1);
      staleDone?.(true); h.drainRN();
      assert.deepEqual(h.finishes, closing ? [12] : []);
      if (!closing) assert.equal(h.render().entryReady, true);
    }
  });

  it('writes exact native clip values only when geometry or the native host changes, and has no idle animation loop', () => {
    const w = world(); const h = w.mount({ fromMini: false }); h.offset.set(0);
    w.clips.length = 0; // Ignore the initial attached host; verify the explicit replacement below.
    h.result.onClipHostReady({ nativeEvent: { hostId: 12 } }); h.flushUI();
    assert.deepEqual(w.clips, [[12, 0, 0, 400, 800, 0, 1]]);
    for (let frame = 0; frame < 20; frame++) h.flushUI();
    assert.equal(w.clips.length, 1);
    assert.equal(h.pendingFrames(), 0);
    assert.equal(h.pendingRN(), 0);
    h.result.beginClose(2); h.flushUI(); h.advance(h.progress(), .5);
    assert.deepEqual(w.clips.at(-1), [12, 6, 350, 388, 428, 7, .5]);
    const count = w.clips.length;
    h.flushUI(); h.render(); h.flushUI(); assert.equal(w.clips.length, count);
    h.result.onClipHostReady({ nativeEvent: { hostId: 13 } }); h.flushUI();
    assert.deepEqual(w.clips.at(-1), [13, 6, 350, 388, 428, 7, .5]);
    assert.equal(w.clips.length, count + 1);
  });
});
