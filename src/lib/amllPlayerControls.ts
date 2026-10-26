/**
 * SPDX-License-Identifier: AGPL-3.0-only
 * Compact native layout for AMLL controls, commit 5fee356362353dbb24ce9bea3a62536478040de7.
 * Source and modifications: THIRD_PARTY_NOTICES.md; full license: licenses/AMLL-AGPL-3.0.txt.
 */
export type AmllTransportAction = 'shuffle' | 'previous' | 'toggle' | 'next' | 'repeat';
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
    modeGlyphSize: 36, modeSelectedGlyphSize: 28,
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
  // User-requested native layout exception: expose the source's shuffle/repeat
  // controls beside transport in portrait too, with five distinct hit targets.
  const actions: AmllTransportAction[] = ['shuffle', 'previous', 'toggle', 'next', 'repeat'];
  const contentWidth = Math.max(availableWidth, actions.length * 44);
  const transportPadding = horizontal ? 0 : Math.min(contentWidth * .02, height * .02,
    Math.max(0, (contentWidth - actions.length * 44) / 2));
  const transportButtonSize = horizontal
    ? Math.max(44, Math.min(96, contentWidth * .18))
    : Math.max(44, Math.min(112, height * .10, (contentWidth - transportPadding * 2) / actions.length));
  const transportPaddingTop = horizontal ? 0 : height * .02;
  const rowWidth = contentWidth - transportPadding * 2;
  const spare = Math.max(0, rowWidth - actions.length * transportButtonSize);
  const gap = spare / (horizontal ? actions.length - 1 : actions.length + 1);
  const slots = actions.map((action, index) => ({
    action,
    left: transportPadding + (horizontal ? 0 : gap) + index * (transportButtonSize + gap),
    size: transportButtonSize,
  }));
  const visuals = amllControlVisuals(viewportWidth, height, horizontal);
  const progressHeight = 44 + Math.ceil(16 * scale);
  const transportHeight = Math.ceil(transportButtonSize + transportPaddingTop);
  const auxiliaryHeight = horizontal ? 0 : visuals.utilitySize;
  const volumeHeight = showVolume ? 44 : 0;
  const volumeBottomPadding = showVolume && !horizontal ? height <= 512 ? 16 : height <= 768 ? 32 : 64 : 0;
  return {
    height: progressHeight + transportHeight + auxiliaryHeight + volumeHeight + volumeBottomPadding,
    contentWidth, scrollable: contentWidth > availableWidth,
    progressHeight, transportHeight, transportButtonSize, transportPaddingTop,
    ...visuals, auxiliaryHeight, volumeHeight, volumeBottomPadding, slots,
    rows: horizontal ? ['progress', 'transport', ...(showVolume ? ['volume'] : [])]
      : ['progress', 'transport', 'auxiliary', ...(showVolume ? ['volume'] : [])],
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
    action: action as AmllBottomAction, left: gap + index * (size + gap), size,
  }));
  return { contentWidth, scrollable: contentWidth > availableWidth, height: size, glyphSize, selectedGlyphSize, slots };
}

export function amllMoreButtonSize(viewportWidth: number, viewportHeight: number) {
  const width = valid(viewportWidth, 360);
  const height = valid(viewportHeight, 640);
  return width <= 1000 ? Math.max(32, Math.min(width * .05, height * .04)) : Math.max(24, height * .035);
}
