/** Independent native layout constraints for the AMLL-inspired player. */
import { amllPlayerControlLayout } from './amllPlayerControls';
export interface AmllRect { x: number; y: number; size: number }
export interface AmllPlayerLayoutInput {
  width: number;
  viewportWidth?: number;
  height: number;
  fontScale: number;
  showVolume: boolean;
  showQuality: boolean;
}
export const AMLL_TOP_PADDING = 8;
export interface AmllPlayerHeaderArea {
  top: number;
  handleBottom: number;
  bottom: number;
  columnLeft: number;
  columnRight: number;
  columnOnly: boolean;
}

/** The safe-area owner passes the already-inset viewport. */
export function amllPlayerLayout({ width, viewportWidth = width, height, fontScale, showVolume }: AmllPlayerLayoutInput) {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const scale = Math.max(1, Math.min(2.5, Number.isFinite(fontScale) ? fontScale : 1));
  const horizontal = w > h && w >= 600;
  const padding = Math.min(36, Math.max(20, w * .045));
  const headerHeight = 44;
  // Portrait actions belong to the cover controls, before volume. Lyrics use
  // the full remaining height; only the landscape has an independent footer.
  const footerHeight = horizontal ? 48 : 0;
  const viewportHeight = Math.max(1, h - headerHeight - footerHeight);
  const innerWidth = Math.max(1, w - padding * 2);
  const leftWidth = horizontal ? Math.max(1, innerWidth * .45) : innerWidth;
  const metadataHeight = Math.ceil(52 * scale + 4);
  const compactMetadataHeight = Math.max(72, Math.ceil(42 * scale + 4));
  const controlLayout = amllPlayerControlLayout({ width: leftWidth,
    viewportWidth, viewportHeight: h, horizontal, showVolume, fontScale: scale });
  // Quality sits between time labels rather than reserving a separate row.
  const qualityHeight = 0;
  const seekHeight = controlLayout.progressHeight;
  const volumeHeight = controlLayout.volumeHeight;
  const compactControlsHeight = controlLayout.height;
  const fullControlsHeight = controlLayout.height;
  // Leave breathing room beneath portrait controls instead of anchoring the
  // whole information group against the gesture bar. Short screens retain a
  // scrollable column, and lyrics can still occupy the complete viewport.
  const controlsBottomInset = horizontal ? 0 : Math.min(48, Math.max(20, h * .055));
  // A short phone may scroll the bounded left/control column. No content is
  // silently clipped merely to preserve a desktop-style two-column ratio.
  const minimumContent = horizontal
    ? 96 + metadataHeight + compactControlsHeight + 24
    : Math.max(8 + compactMetadataHeight + 20 + 96 + 8,
      96 + metadataHeight + fullControlsHeight + controlsBottomInset + 24);
  const contentHeight = Math.max(viewportHeight, minimumContent);
  const controlsTop = contentHeight - (horizontal ? compactControlsHeight : fullControlsHeight) - controlsBottomInset;
  const metadataTop = controlsTop - metadataHeight - 12;
  const maxCover = Math.max(1, metadataTop - 20);
  const largeSize = Math.max(1, Math.min(
    horizontal ? h * .45 : Math.max(1, innerWidth - 16),
    Math.max(1, leftWidth - (horizontal ? 24 : 0)), maxCover,
  ));
  const largeCover: AmllRect = {
    x: (leftWidth - largeSize) / 2,
    y: Math.max(8, (metadataTop - largeSize) / 2),
    size: largeSize,
  };
  const smallSize = Math.min(72, Math.max(1, innerWidth * .26));
  const smallCover: AmllRect = horizontal ? largeCover : { x: 0, y: 8, size: smallSize };
  const lyricsTop = horizontal ? 0 : smallCover.y + compactMetadataHeight + 20;
  const lyricsHeight = horizontal ? viewportHeight
    : Math.max(1, contentHeight - lyricsTop - 8);
  return {
    horizontal, padding, innerWidth, leftWidth, headerHeight, footerHeight,
    referenceHeight: h, controlLayout,
    viewportHeight, contentHeight, scrollable: contentHeight > viewportHeight + 1,
    metadataHeight, compactMetadataHeight, metadataTop, qualityHeight, seekHeight, volumeHeight, compactControlsHeight, fullControlsHeight,
    compactControlsTop: contentHeight - compactControlsHeight - controlsBottomInset, controlsTop,
    largeCover, smallCover, lyricsTop, lyricsHeight,
    centeredColumnLeft: horizontal ? (innerWidth - leftWidth) / 2 : 0,
  };
}

/** Bounds are local to the full safe-area view, including its padding. */
export function amllPlayerHeaderArea(
  layout: ReturnType<typeof amllPlayerLayout>, showLyrics: boolean, topInset: number, leftInset: number,
): AmllPlayerHeaderArea {
  const handleBottom = topInset + AMLL_TOP_PADDING + layout.headerHeight;
  return {
    top: topInset,
    handleBottom,
    bottom: handleBottom + (showLyrics
      ? layout.horizontal ? layout.metadataTop + layout.metadataHeight : layout.lyricsTop
      : layout.largeCover.y),
    columnLeft: leftInset + layout.padding,
    columnRight: leftInset + layout.padding + layout.leftWidth,
    columnOnly: showLyrics && layout.horizontal,
  };
}

/** Decide at touch-down only; an accepted drag can continue into the lyrics. */
export function isAmllPlayerHeaderTouch(area: AmllPlayerHeaderArea, x: number, y: number, scrollOffset: number): boolean {
  'worklet';
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < area.top) return false;
  if (y < area.handleBottom) return true;
  const offset = Number.isFinite(scrollOffset) ? Math.max(0, scrollOffset) : 0;
  return y < Math.max(area.handleBottom, area.bottom - offset)
    && (!area.columnOnly || (x >= area.columnLeft && x < area.columnRight));
}
