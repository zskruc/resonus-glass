export interface ArtistNameMeasurement { y: number; height: number }

/** The photo moves once with the page and once with its existing parallax. */
export function artistHeaderPhotoOffset(scrollY: number, headerHeight: number) {
  'worklet';
  return -scrollY + artistPhotoParallax(scrollY, headerHeight);
}

export function artistPhotoParallax(scrollY: number, headerHeight: number) {
  'worklet';
  return -Math.max(0, Math.min(headerHeight, scrollY)) / 3;
}

/** Keep the duplicate's masks/blur buffers small, independent of screen density. */
export function artistHeaderCopyGeometry(width: number, photoHeight: number, extensionHeight: number, density: number) {
  const scale = Math.min(1, 240 / Math.max(1, width * Math.max(1, density)));
  return { scale, width: width * scale, photoHeight: photoHeight * scale,
    extensionHeight: extensionHeight * scale };
}

/** Only the already prepared local bytes may be used by the navigation copy. */
export function artistHeaderLocalSource(uri?: string): string | undefined {
  return uri && /^(file|content):\/\//i.test(uri) ? uri : undefined;
}

/** The image grows upward from the same text baseline; both callers share these bounds. */
export function artistNameVisualFrame(name: ArtistNameMeasurement, width: number, bottomPadding: number, artworkAspect: number) {
  'worklet';
  const contentHeight = Math.max(0, name.height - bottomPadding);
  if (!(artworkAspect > 0)) return { x: 0, y: name.y, width, height: contentHeight };
  const imageWidth = width * 0.8;
  const imageHeight = Math.min(imageWidth / artworkAspect, Math.max(contentHeight, width * 0.23));
  return { x: (width - imageWidth) / 2, y: name.y + contentHeight - imageHeight, width: imageWidth, height: imageHeight };
}

function progress(value: number, start: number, end: number) {
  'worklet';
  const t = Math.max(0, Math.min(1, (value - start) / Math.max(1, end - start)));
  return t * t * (3 - 2 * t);
}

/** Large artwork/name leaves first; the compact title follows without two readable names. */
export function artistHeaderTransition(scrollY: number, barHeight: number, name: ArtistNameMeasurement) {
  'worklet';
  const exitStart = Math.max(0, name.y - barHeight - 8);
  const exitEnd = exitStart + Math.max(16, Math.min(28, name.height * .45));
  const compactStart = exitEnd + 4;
  return {
    largeOpacity: 1 - progress(scrollY, exitStart, exitEnd),
    compactOpacity: progress(scrollY, compactStart, compactStart + 18),
    backgroundOpacity: progress(scrollY, exitStart, compactStart + 28),
  };
}

/** No guessed text/logo bounds are allowed to reveal a compact title at mount. */
export function artistHeaderFromLayout(scrollY: number, barHeight: number, name: ArtistNameMeasurement,
  width: number, bottomPadding: number, artworkAspect: number) {
  'worklet';
  if (!(name.height > 0)) return { largeOpacity: 1, compactOpacity: 0, backgroundOpacity: 0 };
  return artistHeaderTransition(scrollY, barHeight, artistNameVisualFrame(name, width, bottomPadding, artworkAspect));
}
