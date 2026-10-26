/**
 * Scroll-direction behavior adapted from liquid_glass_widgets (MIT).
 * Copyright (c) 2024–2026 Sebastian Degenaar.
 * Source: https://github.com/sdegenaar/liquid_glass_widgets/blob/6e7ffdacdabf5895c68569a3fb147fad694c299a/lib/widgets/surfaces/shared/tab_bar_minimize_controller.dart
 * Notice: modules/liquid-glass/LIQUID_GLASS_WIDGETS_LICENSE.
 */
import { amppCompactAlpha, amppProgress, getAmppControls } from './amppDock';

export interface LiquidDockScrollState {
  lastY: number | null;
  distance: number;
  viewport: number;
  content: number;
  compact: boolean;
  /** A real drag can commit one manual target change; a new drag gets fresh state. */
  committed: boolean;
}

// Conservative preview values, not Apple's private thresholds. Only real
// dragging counts; a short flick's following inertia cannot finish the gesture.
export const LIQUID_DOCK_SCROLL_TUNING = {
  collapseDistance: 96,
  expandDistance: 80,
};

export function createLiquidDockScrollState(compact = false): LiquidDockScrollState {
  'worklet';
  return { lastY: null, distance: 0, viewport: 0, content: 0, compact, committed: false };
}

/** Mutates one UI-thread state object; returns only an actual target change. */
export function updateLiquidDockScroll(
  state: LiquidDockScrollState,
  y: number,
  viewport: number,
  content: number,
  userDragging: boolean,
): boolean | undefined {
  'worklet';
  if (!Number.isFinite(y) || viewport <= 0 || !Number.isFinite(content)) return;
  const maxY = Math.max(0, content - viewport);
  const extentChanged = viewport !== state.viewport || content !== state.content;
  state.viewport = viewport;
  state.content = content;
  if (y <= 0 || maxY < 40) {
    state.lastY = Math.max(0, y);
    state.distance = 0;
    // Restoring a usable dock at the top/on short content is independent of
    // manual drag thresholds and remains available after a manual commit.
    if (state.compact) {
      state.compact = false;
      return false;
    }
    return;
  }
  if (y > maxY) {
    state.lastY = maxY;
    state.distance = 0;
    return;
  }
  const previous = state.lastY;
  state.lastY = y;
  if (extentChanged || previous === null || !userDragging || state.committed) {
    state.distance = 0;
    return;
  }
  const delta = y - previous;
  if (Math.abs(delta) > viewport / 2) {
    state.distance = 0;
    return;
  }
  if (delta === 0) return;
  if (state.distance * delta < 0 || state.distance === 0) {
    state.distance = 0;
  }
  state.distance += delta;
  const collapse = state.distance >= LIQUID_DOCK_SCROLL_TUNING.collapseDistance;
  const expand = state.distance <= -LIQUID_DOCK_SCROLL_TUNING.expandDistance;
  const target = collapse ? true : expand ? false : undefined;
  if (target !== undefined && target !== state.compact) {
    state.compact = target;
    state.committed = true;
    state.distance = 0;
    return target;
  }
}

/** Physical navigation stays left and Search stays right in both layouts. */
export function getLiquidDockGeometry(
  fullWidth: number,
  expandedSearchSize: number,
  compactSize: number,
  gap: number,
  hasSearch: boolean,
  rtl: boolean,
) {
  const width = Math.max(0, fullWidth);
  const size = Math.max(0, compactSize);
  const spacing = Math.max(0, gap);
  const searchReservedSpace = hasSearch
    ? Math.min(Math.max(0, width - size), Math.max(0, expandedSearchSize) + spacing)
    : 0;
  const navigationOffsetX = 0;
  const navigationWidth = width - searchReservedSpace;
  const compactNavigationOffsetX = 0;
  const searchOffsetX = Math.max(0, width - Math.max(0, expandedSearchSize));
  // Keep the visible right edge fixed while the 62dp circle shrinks to 50dp.
  const searchTranslationX = Math.max(0, width - size) - searchOffsetX;
  const compactReservedSpace = Math.min(size + spacing, width / (hasSearch ? 2 : 1));
  const miniPhysicalOffsetX = compactReservedSpace;
  const miniRightSpace = hasSearch ? compactReservedSpace : 0;
  return {
    navigationWidth,
    navigationOffsetX,
    compactNavigationOffsetX,
    searchOffsetX,
    searchTranslationX,
    miniWidth: width - miniPhysicalOffsetX - miniRightSpace,
    miniLogicalLeadingSpace: rtl ? miniRightSpace : miniPhysicalOffsetX,
    miniLogicalTrailingSpace: rtl ? miniPhysicalOffsetX : miniRightSpace,
    miniPhysicalOffsetX,
  };
}

/** Complete animated style: changing material must clear the previous AM++ travel. */
export function getCompactNavigationContentStyle(
  amPlus: boolean,
  value: number,
  rowWidth: number,
  searchWidth: number,
  navigationHeight: number,
  compactSize: number,
) {
  'worklet';
  const controls = amPlus ? getAmppControls(rowWidth, searchWidth, value) : null;
  // Reanimated retains properties omitted by a later updater. Always assign
  // the transform so the separated styles cannot inherit AM++'s hidden offset.
  return {
    opacity: amPlus ? amppCompactAlpha(value) : amppProgress(value),
    transform: [
      { translateX: controls ? (controls.capsuleWidth - compactSize) / 2 : 0 },
      { translateY: controls ? controls.top + (controls.height - compactSize) / 2 - (navigationHeight - compactSize) : 0 },
    ],
  };
}
