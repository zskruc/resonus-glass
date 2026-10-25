import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AMPP_DOCK, amppCompactAlpha, amppExpandedAlpha, amppMiniSink, amppProgress,
  amppSearchAlpha, amppSpringDamping, amppSprungProgress, getAmppControls,
  getAmppDockGeometry, getAmppSlotTranslation,
} from '../src/lib/amppDock';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

describe('AM++ dock adaptation', () => {
  it('shares one expanded capsule and fits the mini between two same-height compact controls', () => {
    const geometry = getAmppDockGeometry(352, 4, true, false);
    assert.equal(geometry.navigationWidth, 352);
    assert.equal(geometry.searchExpandedWidth, 86);
    assert.equal(geometry.searchOffsetX + geometry.searchExpandedWidth, 352);
    assert.equal(geometry.miniPhysicalOffsetX, 43 + 8);
    assert.equal(geometry.miniPhysicalOffsetX + geometry.miniWidth + 8 + 43, 352);
    assert.equal(AMPP_DOCK.miniHeight, AMPP_DOCK.compactSize);
    const expanded = getAmppControls(352, 86, 0);
    const compact = getAmppControls(352, 86, 1);
    assert.deepEqual(expanded, { capsuleWidth: 352, searchWidth: 86, height: 56, top: 0 });
    assert.deepEqual(compact, { capsuleWidth: 43, searchWidth: 43, height: 43, top: 13 });
    assert.equal(compact.top + compact.height, 56);
  });

  it('reserves no detached search space when disabled and mirrors only logical mini content', () => {
    for (const search of [true, false]) {
      const ltr = getAmppDockGeometry(352, search ? 4 : 3, search, false);
      const rtl = getAmppDockGeometry(352, search ? 4 : 3, search, true);
      assert.equal(ltr.navigationWidth, rtl.navigationWidth);
      assert.equal(ltr.searchOffsetX, rtl.searchOffsetX);
      assert.equal(ltr.miniPhysicalOffsetX, rtl.miniPhysicalOffsetX);
      assert.equal(ltr.miniLogicalLeadingSpace, rtl.miniLogicalTrailingSpace);
      assert.equal(ltr.miniLogicalTrailingSpace, rtl.miniLogicalLeadingSpace);
      if (!search) assert.equal(ltr.miniPhysicalOffsetX + ltr.miniWidth, 352);
    }
  });

  it('keeps alpha and input gates semantic while retaining bounded spring overshoot', () => {
    assert.equal(amppSprungProgress(1.5), 1.09);
    assert.equal(amppSprungProgress(-0.5), -0.09);
    assert.equal(amppProgress(1.05), 1);
    for (const p of [-0.09, 0, 0.25, 0.43, 0.52, 0.60, 0.72, 0.82, 0.85, 1, 1.09]) {
      for (const alpha of [amppExpandedAlpha(p), amppCompactAlpha(p), amppSearchAlpha(p)])
        assert.ok(alpha >= 0 && alpha <= 1);
    }
    assert.equal(amppExpandedAlpha(0.43), 1);
    assert.equal(amppExpandedAlpha(0.72), 0);
    assert.equal(amppCompactAlpha(0.52), 0);
    assert.equal(amppCompactAlpha(0.82), 1);
    assert.equal(amppSearchAlpha(0.60), 0);
    assert.equal(amppSearchAlpha(0.85), 1);
    assert.ok(amppCompactAlpha(0.65) > 0 && amppExpandedAlpha(0.65) > 0);
  });

  it('reuses the row travel for both side controls rebound and caps the returning growth at the gap', () => {
    const rest = getAmppControls(352, 86, 1);
    const bounce = getAmppControls(352, 86, 1.046);
    close(rest.capsuleWidth - bounce.capsuleWidth, rest.searchWidth - bounce.searchWidth);
    close(bounce.capsuleWidth, 43 + (43 - 352) * 0.046 * 0.35);
    const expand = getAmppControls(560, 138, -0.09);
    assert.equal(expand.capsuleWidth, 560 + 8);
    assert.equal(expand.searchWidth, 138 + 8);
    assert.ok(bounce.top > 13 && bounce.height < 43);
  });

  it('sinks the mini only on collapse overshoot, never during travel or an expand rebound', () => {
    for (const p of [-0.09, 0, 0.25, 0.75, 1]) assert.equal(amppMiniSink(p), 0);
    assert.ok(amppMiniSink(1.02) > 0);
    close(amppMiniSink(1.09), 4);
    assert.equal(amppMiniSink(Number.NaN), 0);
  });

  it('preserves glyph centres without scaling text for either reading direction', () => {
    const width = 352;
    const count = 4;
    for (const rtl of [false, true]) for (const p of [0, 0.25, 0.5, 1]) {
      const liveWidth = width + (43 - width) * p;
      for (let i = 0; i < count; i++) {
        const physicalIndex = rtl ? count - 1 - i : i;
        const fraction = (physicalIndex + 0.5) / count;
        const originalCentre = 4 + (width - 8) * fraction;
        const actualCentre = originalCentre + getAmppSlotTranslation(width, i, count, rtl, p);
        close(actualCentre, 4 + (liveWidth - 8) * fraction);
      }
    }
  });

  it('uses distinct critically specified source damping for collapse and expand', () => {
    close(amppSpringDamping(true), 2 * 0.7 * Math.sqrt(250));
    close(amppSpringDamping(false), 2 * 0.755 * Math.sqrt(250));
    assert.ok(amppSpringDamping(false) > amppSpringDamping(true));
  });

  it('does not create negative mini footprints for single-tab, narrow, or nonfinite layouts', () => {
    for (const width of [0, 30, 80, 110, 352, Number.NaN]) for (const search of [false, true]) {
      const geometry = getAmppDockGeometry(width, 1, search, false);
      assert.ok(Number.isFinite(geometry.miniWidth) && geometry.miniWidth >= 0);
      close(geometry.miniPhysicalOffsetX + geometry.miniWidth + geometry.miniLogicalTrailingSpace,
        Number.isFinite(width) ? width : 0);
    }
    assert.equal(amppProgress(Number.NaN), 0);
    assert.equal(amppSprungProgress(Number.POSITIVE_INFINITY), 0);
  });
});
