/**
 * Phone dock geometry adapted from AM++ (GPL-3.0), commit 97fa2e4.
 * Source: https://github.com/Kifranei/AM-plus-plus/tree/97fa2e4efc9ec7476daca383221f55b5d10f847c/glass
 * Material remains native; these worklets place the original React Native controls.
 */
export const AMPP_DOCK = {
  navigationHeight: 56,
  miniHeight: 43,
  compactSize: 43,
  margin: 16,
  gap: 8,
  bottomGap: 16,
  tabInset: 4,
  iconSize: 24,
  labelSize: 11,
  collapseBounce: 0.30,
  expandBounce: 0.245,
  stiffness: 250,
  collapseReboundScale: 0.35,
  expandReboundScale: 1,
  overshootLimit: 0.09,
  miniSink: 4,
} as const;

export function amppProgress(value: number): number {
  'worklet';
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function amppSprungProgress(value: number): number {
  'worklet';
  return Number.isFinite(value) ? Math.max(-AMPP_DOCK.overshootLimit, Math.min(1 + AMPP_DOCK.overshootLimit, value)) : 0;
}

function smoothStep(value: number, start: number, end: number): number {
  'worklet';
  const t = Math.max(0, Math.min(1, (amppProgress(value) - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function amppExpandedAlpha(value: number): number {
  'worklet';
  return 1 - smoothStep(value, 0.43, 0.72);
}

export function amppCompactAlpha(value: number): number {
  'worklet';
  return smoothStep(value, 0.52, 0.82);
}

export function amppSearchAlpha(value: number): number {
  'worklet';
  return smoothStep(value, 0.60, 0.85);
}

export function amppSpringDamping(compact: boolean): number {
  'worklet';
  return 2 * (1 - (compact ? AMPP_DOCK.collapseBounce : AMPP_DOCK.expandBounce)) * Math.sqrt(AMPP_DOCK.stiffness);
}

export function amppMiniSink(value: number): number {
  'worklet';
  const z = 1 - AMPP_DOCK.collapseBounce;
  const peak = Math.exp(-Math.PI * z / Math.sqrt(1 - z * z));
  const excess = Math.max(0, Math.min(peak, amppSprungProgress(value) - amppProgress(value)));
  return AMPP_DOCK.miniSink * excess / peak;
}

/** Native dockRole navigation/search uses this same row-travel rebound. */
export function getAmppControls(rowWidth: number, cellWidth: number, value: number) {
  'worklet';
  const p = amppProgress(value);
  const raw = amppSprungProgress(value);
  const excess = raw - p;
  const scale = excess > 0 ? AMPP_DOCK.collapseReboundScale : AMPP_DOCK.expandReboundScale;
  const row = Number.isFinite(rowWidth) ? Math.max(0, rowWidth) : 0;
  const cell = Number.isFinite(cellWidth) ? Math.max(0, cellWidth) : 0;
  const control = Math.min(AMPP_DOCK.compactSize, row);
  const rebound = Math.min(AMPP_DOCK.gap, (control - row) * excess * scale);
  const capsuleWidth = Math.max(0, row + (control - row) * p + rebound);
  const searchWidth = Math.max(0, cell + (control - cell) * p + rebound);
  const height = Math.max(0, AMPP_DOCK.navigationHeight + (AMPP_DOCK.compactSize - AMPP_DOCK.navigationHeight) * raw);
  return { capsuleWidth, searchWidth, height, top: (AMPP_DOCK.navigationHeight - height) / 2
    + (AMPP_DOCK.navigationHeight - AMPP_DOCK.compactSize) / 2 * p };
}

export function getAmppDockGeometry(fullWidth: number, tabsCount: number, hasSearch: boolean, rtl: boolean) {
  const width = Number.isFinite(fullWidth) ? Math.max(0, fullWidth) : 0;
  const compactSize = Math.min(AMPP_DOCK.compactSize, width);
  const reserve = Math.min(compactSize + AMPP_DOCK.gap, width / (hasSearch ? 2 : 1));
  const miniRight = hasSearch ? reserve : 0;
  const searchExpandedWidth = Math.min(width, Math.max(compactSize, (width - AMPP_DOCK.tabInset * 2) / Math.max(1, Number.isFinite(tabsCount) ? tabsCount : 1)));
  return {
    navigationWidth: width,
    navigationOffsetX: 0,
    compactNavigationOffsetX: 0,
    searchOffsetX: Math.max(0, width - searchExpandedWidth),
    searchTranslationX: 0,
    searchExpandedWidth,
    miniWidth: width - reserve - miniRight,
    miniLogicalLeadingSpace: rtl ? miniRight : reserve,
    miniLogicalTrailingSpace: rtl ? reserve : miniRight,
    miniPhysicalOffsetX: reserve,
  };
}

/** Physical offsets: text is not scaled while tab centres follow clamped travel. */
export function getAmppSlotTranslation(rowWidth: number, index: number, count: number, rtl: boolean, value: number) {
  'worklet';
  const physicalIndex = rtl ? count - 1 - index : index;
  const fraction = (physicalIndex + 0.5) / Math.max(1, count);
  return (AMPP_DOCK.compactSize - rowWidth) * amppProgress(value) * fraction;
}
