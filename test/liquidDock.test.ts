import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLiquidDockScrollState, getCompactNavigationContentStyle, getLiquidDockGeometry, updateLiquidDockScroll } from '@/lib/liquidDock';
import { AMPP_DOCK, getAmppControls } from '@/lib/amppDock';

describe('liquid dock scroll direction', () => {
  it('uses real drag distance independently of display event step size', () => {
    for (const compact of [false, true]) {
      const threshold = compact ? 80 : 96;
      const direction = compact ? -1 : 1;
      for (const step of [1, 2, 4, 8, 16]) {
        const state = createLiquidDockScrollState(compact);
        updateLiquidDockScroll(state, 800, 500, 2000, false);
        const changes = [];
        for (let distance = step; distance <= threshold; distance += step) {
          const target = updateLiquidDockScroll(state, 800 + distance * direction, 500, 2000, true);
          if (target !== undefined) changes.push(target);
        }
        assert.deepEqual(changes, [!compact]);
        assert.equal(state.committed, true);
      }
    }
  });

  it('requires the full drag threshold in both directions without a short flick shortcut', () => {
    for (const compact of [false, true]) {
      const threshold = compact ? 80 : 96;
      const formerFlickDistance = compact ? 40 : 48;
      const direction = compact ? -1 : 1;
      const state = createLiquidDockScrollState(compact);
      updateLiquidDockScroll(state, 800, 500, 2000, false);
      assert.equal(updateLiquidDockScroll(state, 800 + formerFlickDistance * direction, 500, 2000, true), undefined);
      assert.equal(updateLiquidDockScroll(state, 800 + (threshold - 1) * direction, 500, 2000, true), undefined);
      assert.equal(updateLiquidDockScroll(state, 800 + threshold * direction, 500, 2000, true), !compact);
    }
  });

  it('does not let long inertia finish a short real drag in either direction', () => {
    for (const compact of [false, true]) {
      const direction = compact ? -1 : 1;
      const state = createLiquidDockScrollState(compact);
      updateLiquidDockScroll(state, 800, 500, 2000, false);
      assert.equal(updateLiquidDockScroll(state, 800 + 32 * direction, 500, 2000, true), undefined);
      assert.equal(updateLiquidDockScroll(state, 800 + 48 * direction, 500, 2000, true), undefined);
      for (const distance of [96, 192, 384, 576]) {
        assert.equal(updateLiquidDockScroll(state, 800 + distance * direction, 500, 2000, false), undefined);
      }
      assert.equal(state.compact, compact);
      assert.equal(state.committed, false);
      assert.equal(state.distance, 0);
    }
  });

  it('counts a coalesced final real offset sampled on drag end', () => {
    for (const compact of [false, true]) {
      const direction = compact ? -1 : 1;
      const threshold = compact ? 80 : 96;
      const state = createLiquidDockScrollState(compact);
      updateLiquidDockScroll(state, 800, 500, 2000, false);
      assert.equal(updateLiquidDockScroll(state, 800 + 32 * direction, 500, 2000, true), undefined);
      // The scroll handler samples this last real position before disabling
      // dragging, even if no final onScroll event was delivered.
      assert.equal(updateLiquidDockScroll(state, 800 + threshold * direction, 500, 2000, true), !compact);
      assert.equal(updateLiquidDockScroll(state, 800 + (threshold + 100) * direction, 500, 2000, false), undefined);
    }
  });

  it('commits at most one manual target change during the same drag', () => {
    for (const compact of [false, true]) {
      const direction = compact ? -1 : 1;
      const threshold = compact ? 80 : 96;
      const state = createLiquidDockScrollState(compact);
      updateLiquidDockScroll(state, 800, 500, 2000, false);
      const committedY = 800 + threshold * direction;
      assert.equal(updateLiquidDockScroll(state, committedY, 500, 2000, true), !compact);
      // A substantial reversal in the same held gesture cannot flip it back.
      assert.equal(updateLiquidDockScroll(state, committedY - 120 * direction, 500, 2000, true), undefined);
      assert.equal(updateLiquidDockScroll(state, committedY + 100 * direction, 500, 2000, true), undefined);
      assert.equal(updateLiquidDockScroll(state, committedY - 120 * direction, 500, 2000, false), undefined);
      assert.equal(state.compact, !compact);
    }
  });

  it('lets a fresh drag intentionally reverse the previous committed state', () => {
    let state = createLiquidDockScrollState();
    updateLiquidDockScroll(state, 800, 500, 2000, false);
    assert.equal(updateLiquidDockScroll(state, 896, 500, 2000, true), true);
    state = createLiquidDockScrollState(state.compact);
    assert.equal(state.committed, false);
    updateLiquidDockScroll(state, 896, 500, 2000, false);
    assert.equal(updateLiquidDockScroll(state, 817, 500, 2000, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 816, 500, 2000, true), false);
  });

  it('resets direction distance instead of counting a wiggle as a collapse', () => {
    const state = createLiquidDockScrollState();
    updateLiquidDockScroll(state, 400, 500, 2000, false);
    for (const y of [410, 425, 415, 420, 460, 510]) {
      assert.equal(updateLiquidDockScroll(state, y, 500, 2000, true), undefined);
    }
    assert.equal(updateLiquidDockScroll(state, 511, 500, 2000, true), true);
  });

  it('does not spend the gesture commit on travel that keeps the same target', () => {
    const state = createLiquidDockScrollState();
    updateLiquidDockScroll(state, 800, 500, 2000, false);
    assert.equal(updateLiquidDockScroll(state, 700, 500, 2000, true), undefined);
    assert.equal(state.committed, false);
    assert.equal(updateLiquidDockScroll(state, 795, 500, 2000, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 796, 500, 2000, true), true);
  });

  it('expands at the top and for short content without requiring a drag', () => {
    assert.equal(updateLiquidDockScroll(createLiquidDockScrollState(true), -10, 500, 2000, false), false);
    assert.equal(updateLiquidDockScroll(createLiquidDockScrollState(true), 10, 500, 530, false), false);
  });

  it('keeps top restoration independent after a manual change without unlocking the drag', () => {
    const state = createLiquidDockScrollState();
    updateLiquidDockScroll(state, 100, 500, 2000, false);
    assert.equal(updateLiquidDockScroll(state, 196, 500, 2000, true), true);
    assert.equal(updateLiquidDockScroll(state, 0, 500, 2000, false), false);
    assert.equal(state.committed, true);
    assert.equal(updateLiquidDockScroll(state, 120, 500, 2000, true), undefined);
    assert.equal(state.compact, false);
  });

  it('ignores programmatic jumps, rubber bands, and content extent changes', () => {
    const state = createLiquidDockScrollState();
    updateLiquidDockScroll(state, 100, 500, 2000, false);
    assert.equal(updateLiquidDockScroll(state, 1000, 500, 2000, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 1400, 500, 2000, false), undefined);
    assert.equal(updateLiquidDockScroll(state, 1600, 500, 2000, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 1500, 500, 2000, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 1490, 500, 2000, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 1500, 500, 2100, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 1540, 500, 2100, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 1595, 500, 2100, true), undefined);
    assert.equal(updateLiquidDockScroll(state, 1596, 500, 2100, true), true);
  });
});

describe('liquid dock horizontal geometry', () => {
  const searchSize = 62;
  const compactSize = 50;
  const gap = 8;

  it('keeps navigation left and standalone Search right and separated throughout the morph', () => {
    // Samsung's 384 dp screen leaves 344 dp after the two outer margins.
    for (const width of [384 - 20 * 2, 560, 780]) {
      const geometry = getLiquidDockGeometry(width, searchSize, compactSize, gap, true, false);
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const searchLeft = geometry.searchOffsetX + geometry.searchTranslationX * progress;
        const searchRight = searchLeft + searchSize + (compactSize - searchSize) * progress;
        const navigationLeft = geometry.navigationOffsetX;
        const navigationWidth = geometry.navigationWidth + (compactSize - geometry.navigationWidth) * progress;
        assert.ok(navigationLeft >= 0);
        assert.ok(navigationLeft + navigationWidth <= width);
        assert.ok(searchLeft >= 0);
        assert.equal(searchRight, width);
        assert.ok(searchLeft - (navigationLeft + navigationWidth) >= gap);
        if (progress === 1) {
          assert.equal(navigationLeft, 0);
          assert.equal(navigationWidth, compactSize);
          assert.equal(searchRight, width);
          assert.ok(searchLeft - (navigationLeft + navigationWidth) >= gap);
        }
      }
      // The compact mini-player fits between the two independent circles.
      assert.equal(geometry.miniPhysicalOffsetX - compactSize, gap);
      assert.equal(width - compactSize - (geometry.miniPhysicalOffsetX + geometry.miniWidth), gap);
      assert.ok(geometry.miniWidth > 0);
    }
  });

  it('gives the mini-player the free right space when Search is disabled', () => {
    const width = 344;
    const geometry = getLiquidDockGeometry(width, searchSize, compactSize, gap, false, false);
    assert.equal(geometry.navigationOffsetX, 0);
    assert.equal(geometry.navigationWidth, width);
    assert.equal(geometry.miniPhysicalOffsetX - compactSize, gap);
    assert.equal(geometry.miniLogicalTrailingSpace, 0);
    assert.equal(geometry.miniPhysicalOffsetX + geometry.miniWidth, width);
    assert.equal(geometry.compactNavigationOffsetX, 0);
  });

  it('mirrors mini-player content without moving physical Search or navigation anchors', () => {
    for (const hasSearch of [true, false]) {
      const ltr = getLiquidDockGeometry(344, searchSize, compactSize, gap, hasSearch, false);
      const rtl = getLiquidDockGeometry(344, searchSize, compactSize, gap, hasSearch, true);
      assert.equal(rtl.navigationOffsetX, ltr.navigationOffsetX);
      assert.equal(rtl.compactNavigationOffsetX, ltr.compactNavigationOffsetX);
      assert.equal(rtl.searchOffsetX, ltr.searchOffsetX);
      assert.equal(rtl.searchTranslationX, ltr.searchTranslationX);
      assert.equal(rtl.miniPhysicalOffsetX, ltr.miniPhysicalOffsetX);
      assert.equal(rtl.miniWidth, ltr.miniWidth);
      assert.equal(rtl.miniLogicalLeadingSpace, ltr.miniLogicalTrailingSpace);
      assert.equal(rtl.miniLogicalTrailingSpace, ltr.miniLogicalLeadingSpace);
    }
  });

  it('keeps fixed hosts and mini-player bounds valid on exceptionally narrow screens', () => {
    for (const width of [0, 30, 80, 110]) {
      for (const hasSearch of [true, false]) {
        const geometry = getLiquidDockGeometry(width, searchSize, compactSize, gap, hasSearch, false);
        assert.ok(geometry.navigationWidth >= 0);
        assert.ok(geometry.compactNavigationOffsetX >= 0);
        assert.ok(geometry.navigationOffsetX + geometry.navigationWidth <= width);
        assert.ok(geometry.compactNavigationOffsetX <= geometry.navigationWidth);
        assert.ok(geometry.miniWidth >= 0);
        assert.equal(geometry.miniLogicalLeadingSpace + geometry.miniWidth + geometry.miniLogicalTrailingSpace, width);
      }
    }
  });
});

describe('dock material changes', () => {
  const modes = ['amPlus', 'kyantDefault', 'iphoneReference', 'custom'] as const;
  const styleFor = (mode: typeof modes[number], progress: number) => mode === 'amPlus'
    ? getCompactNavigationContentStyle(true, progress, 352, 86, AMPP_DOCK.navigationHeight, AMPP_DOCK.compactSize)
    : getCompactNavigationContentStyle(false, progress, 344, 62, 62, 50);

  it('clears inherited AM++ icon offsets when any other style folds after a live change', () => {
    for (const source of modes) for (const target of modes) {
      for (const previousProgress of [0, 0.65, 1, 1.09]) {
        // Reanimated keeps an animated property until a later updater writes it.
        // AM++ at rest leaves a hidden compact glyph translated into the row.
        let appliedStyle = styleFor(source, previousProgress);
        for (const progress of [0, 0.25, 0.65, 1, 0.5, 0, 1]) {
          appliedStyle = { ...appliedStyle, ...styleFor(target, progress) };
          if (target !== 'amPlus') {
            assert.deepEqual(appliedStyle.transform, [{ translateX: 0 }, { translateY: 0 }], `${source} -> ${target} at ${progress}`);
            assert.equal(appliedStyle.opacity, progress);
          }
        }
      }
    }
  });

  it('centres the compact glyph on the native left control after repeated style changes in either text direction', () => {
    for (const rtl of [false, true]) {
      let appliedStyle = styleFor('amPlus', 0);
      for (const mode of [...modes, ...modes.toReversed()]) {
        appliedStyle = { ...appliedStyle, ...styleFor(mode, 1) };
        const amPlus = mode === 'amPlus';
        const compactSize = amPlus ? 43 : 50;
        const navigationHeight = amPlus ? 56 : 62;
        const barWidth = amPlus ? 352 : getLiquidDockGeometry(344, 62, 50, 8, true, rtl).navigationWidth;
        // This is the bottom/start anchor used by GlobalTabBar's compact view.
        const logicalStart = rtl ? barWidth - compactSize : 0;
        const physicalLeft = rtl ? barWidth - logicalStart - compactSize : logicalStart;
        const x = physicalLeft + appliedStyle.transform[0].translateX! + compactSize / 2;
        const y = navigationHeight - compactSize + appliedStyle.transform[1].translateY! + compactSize / 2;
        assert.equal(x, compactSize / 2, `${mode} physical left control`);
        assert.equal(y, navigationHeight - compactSize / 2, `${mode} compact control vertical centre`);
        assert.equal(appliedStyle.opacity, 1);
      }
    }
  });

  it('preserves AM++ glyph tracking through collapse and its spring rebound', () => {
    for (const progress of [-0.09, 0, 0.4, 0.65, 1, 1.09]) {
      const style = styleFor('amPlus', progress);
      const controls = getAmppControls(352, 86, progress);
      // Foreground remains centred in the native capsule, including overshoot.
      assert.equal(style.transform[0].translateX! + 43 / 2, controls.capsuleWidth / 2);
      assert.equal(56 - 43 + style.transform[1].translateY! + 43 / 2, controls.top + controls.height / 2);
    }
  });
});
