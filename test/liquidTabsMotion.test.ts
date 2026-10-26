import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import * as policy from '../src/lib/liquidTabsMotion';
const { liquidTabsPressedScales, shouldReleaseLiquidTabsPress } = policy;

type Animation = { target: number; kind: 'spring' | 'timing' };
function shared<T>(initial: T) {
  let value = initial;
  let animation: Animation | null = null;
  return {
    get: () => value,
    set(next: T | Animation) {
      if (typeof next === 'object' && next !== null) animation = next as Animation;
      else { value = next as T; animation = null; }
    },
    get target() { return animation?.target; },
    finish() { if (animation) { value = animation.target as T; animation = null; } },
  };
}

/** Run the real UI hook with springs held until explicit display-frame delivery. */
function pressHarness(reduceMotion = false) {
  const pressProgress = shared(0), scaleX = shared(1), scaleY = shared(1);
  const dragVelocity = shared(0), panelOffset = shared(0);
  const selectionPosition = shared(0), selectionDestination = shared(3), dragging = shared(false);
  let prepare!: () => boolean;
  let reaction!: (value: boolean) => void;
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../src/hooks/useLiquidTabsPress.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(compiled.outputText, {
    exports,
    require(id: string) {
      if (id === 'react') return { useCallback: (callback: unknown) => callback };
      if (id === '@/lib/liquidTabsMotion') return policy;
      if (id === '@/theme/motion') return { motion: { reduceMotion: { decorative: 'system' } } };
      if (id === 'react-native-reanimated') return {
        useSharedValue: shared,
        withSpring: (target: number): Animation => ({ target, kind: 'spring' }),
        withTiming: (target: number): Animation => ({ target, kind: 'timing' }),
        useAnimatedReaction(next: typeof prepare, callback: typeof reaction) { prepare = next; reaction = callback; },
      };
      throw new Error(`Unexpected tabs animation import: ${id}`);
    },
  });
  const result = exports.useLiquidTabsPress({ count: 4, amPlus: true, reduceMotion, pressProgress, scaleX, scaleY,
    dragVelocity, panelOffset, selectionPosition, selectionDestination, dragging }) as {
      press: (deform?: boolean) => void; release: () => void;
      releasePending: ReturnType<typeof shared<boolean>>; releaseFrameReady: ReturnType<typeof shared<number>>;
    };
  return { ...result, pressProgress, scaleX, scaleY, selectionPosition, selectionDestination,
    dragging, react: () => reaction(prepare()) };
}

describe('source bottom-tabs selection gesture lifetime', () => {
  it('keeps the tap droplet enlarged until the selector approaches its current destination', () => {
    for (const count of [2, 3, 4, 5]) {
      const end = count - 1;
      const threshold = end * .025;
      assert.equal(shouldReleaseLiquidTabsPress(true, 0, false, end, end, count), false);
      assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, 0, end, count), false);
      assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, end - threshold * 1.01, end, count), false);
      assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, end - threshold * .99, end, count), true);
      assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, threshold * .99, 0, count), true);
    }
  });

  it('a new tap retargets the same held lens, rather than letting an old release end the new animation', () => {
    assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, 1.98, 2, 4), true);
    // A later commit changes the target to 0 and arms a new next-frame wait.
    assert.equal(shouldReleaseLiquidTabsPress(false, 0, false, 1.98, 0, 4), false);
    assert.equal(shouldReleaseLiquidTabsPress(true, 0, false, 1.98, 0, 4), false);
    assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, 1.98, 0, 4), false);
    assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, .02, 0, 4), true);
  });

  it('cannot release while held, cancelled by layout/hiding, or given invalid coordinates', () => {
    assert.equal(shouldReleaseLiquidTabsPress(true, 1, true, 2, 2, 4), false);
    assert.equal(shouldReleaseLiquidTabsPress(false, 1, false, 2, 2, 4), false);
    assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, NaN, 2, 4), false);
    assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, 2, Infinity, 4), false);
    // A cancelled drag can return to the actual route, then release normally.
    assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, .03, 0, 4), true);
    assert.equal(shouldReleaseLiquidTabsPress(true, 1, false, 0, 0, 1), true);
  });

  it('preserves source and AM++ shape scales while bounding narrow one/two-tab bars', () => {
    assert.deepEqual(liquidTabsPressedScales(4, false), [78 / 56, 78 / 56]);
    assert.deepEqual(liquidTabsPressedScales(4, true), [1.5, 1.45]);
    for (const amPlus of [false, true]) {
      assert.equal(liquidTabsPressedScales(1, amPlus)[0], 1);
      assert.equal(liquidTabsPressedScales(2, amPlus)[0], 1.1);
    }
  });

  it('runs the real tap press and holds the three springs until the current journey finishes', () => {
    const h = pressHarness();
    h.press();
    assert.equal(h.pressProgress.target, 1);
    assert.equal(h.scaleX.target, 1.5);
    assert.equal(h.scaleY.target, 1.45);
    h.release();
    h.react();
    assert.equal(h.pressProgress.target, 1);
    h.releaseFrameReady.finish();
    h.react();
    assert.equal(h.releasePending.get(), true);
    h.selectionPosition.set(2.96);
    h.react();
    assert.equal(h.releasePending.get(), false);
    assert.equal(h.pressProgress.target, 0);
    assert.equal(h.scaleX.target, 1);
    assert.equal(h.scaleY.target, 1);
  });

  it('cancels the old next-frame release for a new held press and honors reduced motion', () => {
    const h = pressHarness();
    h.press(); h.release();
    h.press();
    h.releaseFrameReady.finish();
    h.selectionPosition.set(3);
    h.react();
    assert.equal(h.releasePending.get(), false);
    assert.equal(h.pressProgress.target, 1);
    h.release(); h.releaseFrameReady.finish(); h.react();
    assert.equal(h.pressProgress.target, 0);
    const reduced = pressHarness(true);
    reduced.press(); reduced.release(); reduced.react();
    assert.equal(reduced.releasePending.get(), false);
    assert.equal(reduced.pressProgress.get(), 0);
    assert.equal(reduced.scaleX.get(), 1);
    assert.equal(reduced.scaleY.get(), 1);
  });
});
