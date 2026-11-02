/** AlbumDetailView geometry adapted from chenqi92/primuse (MIT), iOS layout. */
export function primuseAlbumLayout(width: number, height: number, topInset: number, sidePadding: number, fontScale = 1) {
  const compact = height < 500 || width > height;
  const stacked = !compact || fontScale >= 1.6;
  const coverSide = Math.max(64, Math.min(compact ? 88 : 190, width - sidePadding * 2 - 8));
  // Android retains a horizontal navigation bar in landscape. Keep its
  // controls above the cover instead of copying iOS's adaptive side toolbar.
  const topPadding = topInset + (compact ? 60 : 52);
  const coverCenterY = topPadding + coverSide / 2;
  const backdropSide = Math.max(width, topPadding + coverSide + 60) * 1.3;
  return {
    compact, stacked, coverSide, topPadding, coverCenterY, backdropSide,
    coverCenterX: stacked ? width / 2 : sidePadding + 4 + coverSide / 2,
    bottomPadding: compact ? 16 : 26,
    blockSpacing: compact ? 14 : 18,
    blurRatio: Math.round(20 / backdropSide * 10000) / 10000,
  };
}

/** One static opacity envelope; the complete album scene scrolls together. */
export function primuseAlbumFade(height: number, coverBottom: number) {
  const safeHeight = Math.max(1, height);
  const end = Math.min(coverBottom + 280, safeHeight);
  const start = Math.min(coverBottom + 10, end * .6);
  return [0, start / safeHeight, (start + end) / 2 / safeHeight, end / safeHeight] as const;
}

/** Expand the existing blur above a revealed search row without moving its cover or lower fade. */
export function primuseAlbumWindow(height: number, coverBottom: number, topExtension = 0) {
  const bodyHeight = Math.max(1, height);
  const extension = Number.isFinite(topExtension) ? Math.max(0, topExtension) : 0;
  const heightWithExtension = bodyHeight + extension;
  const fade = primuseAlbumFade(bodyHeight, coverBottom);
  return { top: -extension, height: heightWithExtension, contentTop: extension,
    fade: [0, (fade[1] * bodyHeight + extension) / heightWithExtension,
      (fade[2] * bodyHeight + extension) / heightWithExtension,
      (fade[3] * bodyHeight + extension) / heightWithExtension] as const };
}
