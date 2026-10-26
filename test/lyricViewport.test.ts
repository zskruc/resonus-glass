import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lyricBlurRadius } from '@/lib/lyricMotion';
import { collectLyricMeasurements, lyricViewportWindow, sameLyricViewportWindow, updateLyricViewportVisibility, type LyricVisibilityFlag } from '@/lib/lyricViewport';

function windowOf(...indices: number[]) {
  return { first: indices[0] ?? -1, last: indices[indices.length - 1] ?? -1, indices };
}

function measurements(count: number, rowHeight = 80) {
  return Array.from({ length: count }, (_, index) => [index, index * rowHeight, (index + 1) * rowHeight]).flat();
}

function flags(count: number) {
  let writes = 0;
  let reads = 0;
  const values = new Set<number>();
  const rows: LyricVisibilityFlag[] = Array.from({ length: count }, (_, index) => ({
    get: () => { reads++; return values.has(index); },
    set: (visible) => { writes++; if (visible) values.add(index); else values.delete(index); },
  }));
  return { rows, values, readCount: () => reads, writeCount: () => writes };
}

describe('shared lyric viewport filter budget', () => {
  it('uses measured bounds, including partial rows and exact viewport edges', () => {
    const bounds = measurements(20);
    assert.deepEqual(lyricViewportWindow(bounds, 80, 80, 0), windowOf(1));
    assert.deepEqual(lyricViewportWindow(bounds, 79, 82, 0), windowOf(0, 1, 2));
    assert.deepEqual(lyricViewportWindow(bounds, 0, 80, 64), windowOf(0, 1));
    assert.deepEqual(lyricViewportWindow(bounds, 5000, 80, 0), windowOf());
    assert.deepEqual(lyricViewportWindow([0, 0, 80, 2, 160, 240, 5, 400, 480], 170, 80, 0),
      windowOf(2));
  });

  it('handles wrapped rows and missing or invalid viewport measurements', () => {
    const bounds = [0, 0, 50, 1, 50, 300, 2, 300, 360];
    assert.deepEqual(lyricViewportWindow(bounds, 75, 180, 0), windowOf(1));
    for (const [offset, height] of [[0, 0], [0, -1], [Number.NaN, 80], [0, Number.POSITIVE_INFINITY]]) {
      assert.deepEqual(lyricViewportWindow(bounds, offset, height), windowOf());
    }
    assert.deepEqual(lyricViewportWindow([], 0, 500), windowOf());
  });

  it('bounds native filter ownership by viewport size rather than the number of lyrics', () => {
    for (const count of [100, 1000, 10000]) {
      const bounds = measurements(count);
      const state = flags(count);
      const window = lyricViewportWindow(bounds, (count - 15) * 80, 480);
      updateLyricViewportVisibility(state.rows, windowOf(), window);
      assert.ok(state.values.size <= 9);
      assert.ok(state.readCount() <= 9);
      for (const index of state.values) {
        // Even far from the playing line, visible text receives the full shared treatment.
        assert.equal(lyricBlurRadius(index, 0, true), 2.2);
      }
    }
  });

  it('releases old viewport layers on a long seek without visiting the whole list', () => {
    const state = flags(10000);
    const bounds = measurements(10000);
    const first = lyricViewportWindow(bounds, 800, 480);
    const next = lyricViewportWindow(bounds, 720000, 480);
    updateLyricViewportVisibility(state.rows, windowOf(), first);
    const before = state.readCount();
    updateLyricViewportVisibility(state.rows, first, next);
    assert.ok(state.readCount() - before <= 18);
    assert.deepEqual([...state.values], Array.from({ length: next.last - next.first + 1 }, (_, i) => next.first + i));
    const writes = state.writeCount();
    updateLyricViewportVisibility(state.rows, next, next);
    assert.equal(state.writeCount(), writes);
    updateLyricViewportVisibility(state.rows, next, windowOf());
    assert.equal(state.values.size, 0);
  });

  it('initializes replacement row flags even when the viewport indices stay unchanged', () => {
    const state = flags(30);
    const window = windowOf(10, 11, 12, 13, 14, 15);
    updateLyricViewportVisibility(state.rows, window, window);
    assert.equal(state.values.size, 6);
  });

  it('never fills unmeasured index gaps, even when stale sparse rows share a small viewport', () => {
    const state = flags(10000);
    const sparse = lyricViewportWindow([0, 0, 40, 9999, 40, 80], 0, 100, 0);
    updateLyricViewportVisibility(state.rows, windowOf(), sparse);
    assert.deepEqual([...state.values], [0, 9999]);
    assert.equal(state.readCount(), 2);
    const filled = windowOf(0, 5, 9999);
    assert.equal(sameLyricViewportWindow(sparse, filled), false);
    updateLyricViewportVisibility(state.rows, sparse, filled);
    assert.deepEqual([...state.values].sort((a, b) => a - b), [0, 5, 9999]);
  });

  it('skips invalid and backwards measurements from an incomplete font/layout batch', () => {
    const rows = [{ y: 0, h: 100 }, undefined, { y: 90, h: 30 }, { y: 100, h: 40 }, { y: 200, h: Number.NaN }];
    assert.deepEqual(collectLyricMeasurements(rows, rows.length), [0, 0, 100, 3, 100, 140]);
    assert.deepEqual(collectLyricMeasurements(rows, 1), [0, 0, 100]);
    assert.equal(sameLyricViewportWindow(windowOf(0, 3), windowOf(0, 3)), true);
  });
});
