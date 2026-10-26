import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRACK_SWIPE_CONFIRM, TRACK_SWIPE_INTENT, trackSwipeOffset, trackSwipeRelease } from '../src/lib/trackSwipe';

describe('song-row swipe action parity', () => {
  it('keeps the deliberate intent and strict 90dp release threshold', () => {
    assert.equal(TRACK_SWIPE_INTENT, 30);
    assert.equal(TRACK_SWIPE_CONFIRM, 90);
    for (const direction of [-1, 1] as const) {
      assert.equal(trackSwipeRelease(direction * 89.99, 0, true, true), 0);
      assert.equal(trackSwipeRelease(direction * 90, 0, true, true), 0);
      assert.equal(trackSwipeRelease(direction * 90.01, 0, true, true), direction);
    }
  });

  it('preserves the existing 50ms velocity projection, including a reversed release', () => {
    assert.equal(trackSwipeRelease(40, 1000, true, true), 0);
    assert.equal(trackSwipeRelease(40, 1001, true, true), 1);
    assert.equal(trackSwipeRelease(-40, -1001, true, true), -1);
    assert.equal(trackSwipeRelease(120, -1000, true, true), 0);
    assert.equal(trackSwipeRelease(-40, 3000, true, true), 1);
  });

  it('never commits or moves into a disabled action', () => {
    assert.equal(trackSwipeRelease(1000, 1000, false, true), 0);
    assert.equal(trackSwipeRelease(-1000, -1000, true, false), 0);
    assert.equal(trackSwipeOffset(200, 70, false, true), 0);
    assert.equal(trackSwipeOffset(-200, 70, true, false), 0);
    assert.equal(trackSwipeOffset(200, 70, false, false), 0);
  });

  it('limits visual travel to the action while deciding from the full drag', () => {
    assert.equal(trackSwipeOffset(1000, 70, true, true), 70);
    assert.equal(trackSwipeOffset(-1000, 70, true, true), -70);
    assert.equal(trackSwipeOffset(35, 70, true, true), 35);
    assert.equal(trackSwipeRelease(1000, 0, true, true), 1);
    assert.equal(trackSwipeRelease(trackSwipeOffset(1000, 70, true, true), 0, true, true), 0);
  });

  it('cannot create non-finite transforms or accidental actions from invalid input', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.equal(trackSwipeOffset(value, 70, true, true), 0);
      assert.equal(trackSwipeOffset(60, value, true, true), 0);
      assert.equal(trackSwipeRelease(value, 0, true, true), 0);
      assert.equal(trackSwipeRelease(60, value, true, true), 0);
    }
    assert.equal(trackSwipeOffset(60, 0, true, true), 0);
  });
});
