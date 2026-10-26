/** Independent native layout constraints for the AMLL-inspired player. */
export interface AmllRect { x: number; y: number; size: number }
export interface AmllPlayerLayoutInput {
  width: number;
  height: number;
  fontScale: number;
  showVolume: boolean;
  showQuality: boolean;
}

/** The safe-area owner passes the already-inset viewport. */
export function amllPlayerLayout({ width, height, fontScale, showVolume, showQuality }: AmllPlayerLayoutInput) {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const scale = Math.max(1, Math.min(2.5, Number.isFinite(fontScale) ? fontScale : 1));
  const horizontal = w > h && w >= 600;
  const padding = Math.min(36, Math.max(20, w * .045));
  const headerHeight = 28;
  const footerHeight = Math.ceil(52 + (scale - 1) * 10);
  const viewportHeight = Math.max(1, h - headerHeight - footerHeight);
  const innerWidth = Math.max(1, w - padding * 2);
  const leftWidth = horizontal ? Math.max(1, innerWidth * .45) : innerWidth;
  const metadataHeight = Math.ceil(52 * scale + 4);
  const compactMetadataHeight = Math.max(72, Math.ceil(42 * scale + 4));
  const qualityHeight = showQuality ? Math.ceil(18 * scale) : 0;
  const seekHeight = Math.ceil(58 + (scale - 1) * 16);
  const volumeHeight = showVolume ? Math.ceil(56 + (scale - 1) * 12) : 0;
  const compactControlsHeight = qualityHeight + seekHeight + 52 + volumeHeight + 8;
  const fullControlsHeight = qualityHeight + seekHeight + 76 + volumeHeight + 8;
  // A short phone may scroll the bounded left/control column. No content is
  // silently clipped merely to preserve a desktop-style two-column ratio.
  const minimumContent = horizontal
    ? 96 + metadataHeight + compactControlsHeight + 24
    : Math.max(8 + compactMetadataHeight + 20 + 96 + compactControlsHeight + 8,
      64 + metadataHeight + fullControlsHeight + 24);
  const contentHeight = Math.max(viewportHeight, minimumContent);
  const controlsTop = contentHeight - (horizontal ? compactControlsHeight : fullControlsHeight);
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
    viewportHeight, contentHeight, scrollable: contentHeight > viewportHeight + 1,
    metadataHeight, compactMetadataHeight, metadataTop, qualityHeight, seekHeight, volumeHeight, compactControlsHeight, fullControlsHeight,
    compactControlsTop: contentHeight - compactControlsHeight, controlsTop,
    largeCover, smallCover, lyricsTop, lyricsHeight,
    centeredColumnLeft: horizontal ? (innerWidth - leftWidth) / 2 : 0,
  };
}
