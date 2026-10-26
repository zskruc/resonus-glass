import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  amllSliderClamp, amllSliderElasticOffset, amllSliderProgress, amllSliderRange, amllSliderReversed, amllSliderValueAt,
  beginAmllSliderInteraction, finishAmllSliderInteraction, invalidateAmllSliderInteraction, isCurrentAmllSliderInteraction,
} from '@/lib/amllSlider';

describe('AMLL player slider gesture math', () => {
  it('keeps an unavailable web RTL flag left-to-right while explicit RTL and inversion compose', () => {
    assert.equal(amllSliderReversed(false, undefined), false);
    assert.equal(amllSliderReversed(false, false), false);
    assert.equal(amllSliderReversed(false, true), true);
    assert.equal(amllSliderReversed(true, undefined), true);
    assert.equal(amllSliderReversed(true, true), false);
  });
  it('keeps a real stepped volume range and both uneven endpoints reachable', () => {
    const range = amllSliderRange(2, 15, 2);
    assert.equal(amllSliderValueAt(0, 260, range), 2);
    assert.equal(amllSliderValueAt(70, 260, range), 6);
    assert.equal(amllSliderValueAt(260, 260, range), 15);
    assert.equal(amllSliderValueAt(500, 260, range), 15);
    assert.equal(amllSliderValueAt(60, 200, amllSliderRange(0, 1, 0.1)), 0.3);
  });

  it('reverses input without changing the numeric range or elastic direction', () => {
    const range = amllSliderRange(30, 330);
    for (const x of [0, 30, 150, 270, 300]) {
      assert.ok(Math.abs(amllSliderValueAt(x, 300, range) - amllSliderValueAt(300 - x, 300, range, true)) < 1e-8);
    }
    assert.equal(amllSliderValueAt(-20, 300, range, true), 330);
    assert.equal(amllSliderValueAt(320, 300, range, true), 30);
  });

  it('bounds terminal stretch to 12dp while dragging keeps the value clamped', () => {
    const range = amllSliderRange(0, 180);
    for (const x of [-10000, -100, -1, 0, 75, 300, 301, 400, 10000]) {
      const offset = amllSliderElasticOffset(x, 300);
      assert.ok(Math.abs(offset) <= 12);
      assert.ok(amllSliderValueAt(x, 300, range) >= 0 && amllSliderValueAt(x, 300, range) <= 180);
      if (x >= 0 && x <= 300) assert.equal(offset, 0);
      else assert.equal(Math.sign(offset), x < 0 ? -1 : 1);
    }
    assert.ok(Math.abs(amllSliderElasticOffset(-100, 300)) > Math.abs(amllSliderElasticOffset(-1, 300)));
  });

  it('honours limits and safely handles unavailable layouts, invalid values and a zero range', () => {
    const range = amllSliderRange(0, 100, 5, 20, 85);
    assert.equal(amllSliderValueAt(-10, 200, range), 20);
    assert.equal(amllSliderValueAt(300, 200, range), 85);
    assert.equal(amllSliderProgress(200, range), 0.85);
    assert.equal(amllSliderClamp(Number.NaN, range), 20);
    assert.equal(amllSliderValueAt(100, 0, range), 20);
    assert.equal(amllSliderProgress(5, amllSliderRange(5, 5)), 0);
    assert.equal(amllSliderValueAt(100, 200, amllSliderRange(10, 5)), 10);
    assert.equal(amllSliderElasticOffset(Number.NaN, 300), 0);
    assert.equal(amllSliderElasticOffset(100, 0), 0);
  });
});

describe('AMLL player slider callback lifetime', () => {
  it('cancels once on a range/song/output change and rejects queued old events', () => {
    const session = { generation: 0, active: false };
    assert.equal(beginAmllSliderInteraction(session, 0), true);
    assert.equal(isCurrentAmllSliderInteraction(session, 0), true);
    assert.equal(invalidateAmllSliderInteraction(session), true);
    assert.equal(isCurrentAmllSliderInteraction(session, 0), false);
    assert.equal(finishAmllSliderInteraction(session, 0), false);
    assert.equal(beginAmllSliderInteraction(session, 0), false);
    assert.equal(invalidateAmllSliderInteraction(session), false);
    assert.equal(beginAmllSliderInteraction(session, 2), true);
    assert.equal(finishAmllSliderInteraction(session, 0), false);
    assert.equal(isCurrentAmllSliderInteraction(session, 2), true);
    assert.equal(finishAmllSliderInteraction(session, 2), true);
  });

  it('pairs each start with at most one completion or cancellation', () => {
    const session = { generation: 0, active: false };
    assert.equal(finishAmllSliderInteraction(session, 0), false);
    assert.equal(beginAmllSliderInteraction(session, 0), true);
    assert.equal(beginAmllSliderInteraction(session, 0), false);
    assert.equal(finishAmllSliderInteraction(session, 0), true);
    assert.equal(isCurrentAmllSliderInteraction(session, 0), false);
    assert.equal(finishAmllSliderInteraction(session, 0), false);
    assert.equal(invalidateAmllSliderInteraction(session), false);
  });
});
