import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MINI_SWIPE_TRAVEL, miniSwipeDirection, miniSwipeOffset } from '@/lib/miniPlayerSwipe';

describe('mini player swipe visual travel', () => {
  it('starts at rest and gives a small cue before a deliberate flick', () => {
    assert.equal(MINI_SWIPE_TRAVEL, 12);
    assert.equal(miniSwipeOffset(0), 0);
    assert.equal(miniSwipeOffset(12), 3);
    assert.equal(miniSwipeOffset(36), 6);
  });

  it('moves symmetrically and smoothly without reversing or exceeding the viewport budget', () => {
    let previous = 0;
    for (const distance of [1, 6, 12, 24, 36, 64, 96, 228, 344, 1000, 10_000, 1_000_000]) {
      const forward = miniSwipeOffset(distance);
      const backward = miniSwipeOffset(-distance);
      assert.ok(forward > previous, `visual travel must increase at ${distance}dp`);
      assert.ok(forward < MINI_SWIPE_TRAVEL, `visual travel must stay inside the frame at ${distance}dp`);
      assert.equal(backward, -forward);
      previous = forward;
    }
  });

  it('keeps even the largest finite input finite and inside the travel limit', () => {
    for (const input of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
      const result = miniSwipeOffset(input);
      assert.ok(Number.isFinite(result));
      assert.ok(Math.abs(result) <= MINI_SWIPE_TRAVEL);
      assert.equal(Math.sign(result), Math.sign(input));
    }
  });

  it('ignores invalid visual offsets', () => {
    for (const input of [NaN, Infinity, -Infinity]) {
      assert.equal(miniSwipeOffset(input), 0);
    }
  });
});

describe('mini player swipe release direction', () => {
  const layouts = [
    { name: 'Samsung expanded', width: 344, threshold: 86 },
    { name: 'compact with Search', width: 228, threshold: 64 },
    { name: 'compact without Search', width: 286, threshold: 71.5 },
    { name: 'wide expanded', width: 560, threshold: 96 },
    { name: 'narrow viewport', width: 80, threshold: 64 },
  ];

  it('requires the full deliberate distance in expanded, compact, and narrow layouts', () => {
    for (const { name, width, threshold } of layouts) {
      for (const direction of [-1, 1] as const) {
        assert.equal(miniSwipeDirection(direction * (threshold - 0.001), 0, width), 0, name);
        assert.equal(miniSwipeDirection(direction * threshold, 0, width), direction, name);
        assert.equal(miniSwipeDirection(direction * (threshold + 100), 0, width), direction, name);
      }
    }
  });

  it('uses actual drag distance rather than its much smaller visual offset', () => {
    for (const { width, threshold } of layouts) {
      assert.equal(miniSwipeDirection(-threshold, 0, width), -1);
      assert.equal(miniSwipeDirection(miniSwipeOffset(-threshold), 0, width), 0);
    }
  });

  it('allows a same-direction flick only after both minimum distance and velocity are reached', () => {
    for (const { width } of layouts) {
      for (const direction of [-1, 1] as const) {
        assert.equal(miniSwipeDirection(direction * 11.999, direction * 800, width), 0);
        assert.equal(miniSwipeDirection(direction * 12, direction * 799.999, width), 0);
        assert.equal(miniSwipeDirection(direction * 12, direction * 800, width), direction);
      }
    }
  });

  it('does not let a noisy high-velocity sample turn a tiny movement into a track change', () => {
    for (const distance of [0, Number.EPSILON, 1, 6, 11.999]) {
      for (const direction of [-1, 1] as const) {
        for (const velocity of [-1_000_000, 1_000_000]) {
          assert.equal(miniSwipeDirection(direction * distance, velocity, 344), 0);
        }
      }
    }
  });

  it('rejects a reversed flick and never switches opposite to an already-completed drag', () => {
    for (const { width, threshold } of layouts) {
      for (const direction of [-1, 1] as const) {
        assert.equal(miniSwipeDirection(direction * 12, -direction * 10_000, width), 0);
        assert.equal(miniSwipeDirection(direction * (threshold - 1), -direction * 10_000, width), 0);
        // Once the deliberate distance is complete, drag direction has priority.
        assert.equal(miniSwipeDirection(direction * threshold, -direction * 10_000, width), direction);
      }
    }
  });

  it('cannot commit with an invalid offset, velocity, or viewport', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      assert.equal(miniSwipeDirection(invalid, 1000, 344), 0);
      assert.equal(miniSwipeDirection(100, invalid, 344), 0);
    }
    for (const invalidWidth of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(miniSwipeDirection(-1000, -1000, invalidWidth), 0);
      assert.equal(miniSwipeDirection(1000, 1000, invalidWidth), 0);
    }
  });
});
