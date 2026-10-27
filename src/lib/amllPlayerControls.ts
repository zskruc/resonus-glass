/**
 * SPDX-License-Identifier: AGPL-3.0-only
 * Compact native layout for AMLL controls, commit 5fee356362353dbb24ce9bea3a62536478040de7.
 * Source and modifications: THIRD_PARTY_NOTICES.md; full license: licenses/AMLL-AGPL-3.0.txt.
 */
export type AmllTransportAction = 'previous' | 'toggle' | 'next';
export type AmllBottomAction = 'lyrics' | 'output' | 'queue';

const valid = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

export function amllControlVisuals(viewportWidth: number, viewportHeight: number, horizontal: boolean) {
  const width = valid(viewportWidth, 360), height = valid(viewportHeight, 640);
  const skipInkSize = !horizontal ? width <= 480 ? 36 : 44
    : height <= 512 ? 24 : height <= 768 ? 34 : 44;
  const playInkSize = !horizontal ? width <= 480 ? 46 : 60
    : height <= 512 ? 22 : height <= 768 ? 32 : 44;
  // These SVG viewBoxes include whitespace: keep the original path geometry,
  // compensating only image bounds to recover the former native visual sizes.
  return { skipGlyphSize: skipInkSize * 134 / 84, playGlyphSize: playInkSize * 38 / 34.1406,
    utilityGlyphSize: 36, utilitySelectedGlyphSize: 24, utilitySize: 48, utilityGap: 32 };
}

export function amllPlayerControlLayout({ width, viewportWidth = width, viewportHeight, horizontal, showVolume, fontScale = 1 }: {
  width: number;
  viewportWidth?: number;
  viewportHeight: number;
  horizontal: boolean;
  showVolume: boolean;
  fontScale?: number;
}) {
  const availableWidth = valid(width, 1);
  const height = valid(viewportHeight, 640);
  const scale = Math.max(1, Math.min(2.5, valid(fontScale, 1)));
  // The mode buttons now live only in More. Keep the previous reference grid
  // so removing them never shifts the three transport anchors or row height.
  const actions: AmllTransportAction[] = ['previous', 'toggle', 'next'];
  const referenceColumns = 5;
  const contentWidth = Math.max(availableWidth, referenceColumns * 44);
  const referenceScale = Math.max(.7, Math.min(1.35, height / 832));
  const transportButtonSize = horizontal ? Math.max(44, Math.min(96, contentWidth * .18))
    : contentWidth >= 344 ? Math.min(68, 2 * (contentWidth * .2211805556 - Math.max(22, contentWidth * .0625)) - 44)
      : Math.max(44, Math.min(60, contentWidth / 5));
  // Keep the reference's main three centers (85 / 192 / 299 on a 384dp
  // phone), leaving the removed outer mode-button regions empty.
  const centers = !horizontal && contentWidth >= 344
    ? [contentWidth * .2211805556, contentWidth / 2, contentWidth * .7788194444]
    : actions.map((_, index) => horizontal
      ? transportButtonSize / 2 + (index + 1) * (contentWidth - transportButtonSize) / 4
      : (index + 1.5) * contentWidth / referenceColumns);
  const slots = actions.map((action, index) => {
    return { action, left: centers[index] - transportButtonSize / 2, top: 0, size: transportButtonSize };
  });
  const visuals = amllControlVisuals(viewportWidth, height, horizontal);
  const progressHeight = 44 + Math.ceil(16 * scale);
  const auxiliaryHeight = horizontal ? 0 : visuals.utilitySize;
  const volumeHeight = showVolume ? 44 : 0;
  const volumeTop = progressHeight;
  const transportTop = horizontal ? progressHeight : Math.max(
    129.8 * referenceScale - transportButtonSize / 2,
    progressHeight + volumeHeight + (showVolume ? 8 : 0));
  const auxiliaryTop = horizontal ? 0 : Math.max(228.6 * referenceScale - auxiliaryHeight / 2,
    transportTop + transportButtonSize + 16);
  const transportHeight = transportButtonSize;
  const volumeBottomPadding = 0;
  const fullHeight = horizontal ? progressHeight + transportHeight + volumeHeight : auxiliaryTop + auxiliaryHeight;
  return {
    height: fullHeight,
    contentWidth, scrollable: contentWidth > availableWidth,
    progressHeight, transportHeight, transportButtonSize, transportPaddingTop: 0,
    transportTop, auxiliaryTop, volumeTop: horizontal ? progressHeight + transportHeight : volumeTop,
    ...visuals, auxiliaryHeight, volumeHeight, volumeBottomPadding, slots,
    rows: horizontal ? ['progress', 'transport', ...(showVolume ? ['volume'] : [])]
      : ['progress', ...(showVolume ? ['volume'] : []), 'transport', 'auxiliary'],
  };
}

/** Source order is physical: landscape output at left, lyrics/queue at right. */
export function amllBottomActionLayout(width: number, horizontal: boolean, viewportWidth = width, viewportHeight = 840) {
  const availableWidth = valid(width, 1);
  const { utilitySize: size, utilityGlyphSize: glyphSize, utilitySelectedGlyphSize: selectedGlyphSize,
    utilityGap } = amllControlVisuals(viewportWidth, viewportHeight, horizontal);
  const contentWidth = Math.max(availableWidth, size * 3 + (horizontal ? utilityGap : 0));
  const gap = horizontal ? utilityGap : (contentWidth - size * 3) / 4;
  const slots: { action: AmllBottomAction; left: number; size: number }[] = horizontal ? [
    { action: 'output', left: 0, size },
    { action: 'lyrics', left: contentWidth - size * 2 - gap, size },
    { action: 'queue', left: contentWidth - size, size },
  ] : ['lyrics', 'output', 'queue'].map((action, index) => ({
    action: action as AmllBottomAction,
    left: (contentWidth >= 240 ? [88.933 / 384, .5, 295.067 / 384][index] * contentWidth
      : gap + index * (size + gap) + size / 2) - size / 2, size,
  }));
  return { contentWidth, scrollable: contentWidth > availableWidth, height: size, glyphSize, selectedGlyphSize, slots };
}

export function amllMoreButtonSize(viewportWidth: number, viewportHeight: number) {
  const width = valid(viewportWidth, 360);
  const height = valid(viewportHeight, 640);
  if (height >= width) return 28;
  return width <= 1000 ? Math.max(32, Math.min(width * .05, height * .04)) : Math.max(24, height * .035);
}
