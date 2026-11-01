export interface ArtistNameMeasurement { y: number; height: number }

/** Compensate content motion; do not accelerate the image in the scroll direction. */
export function artistPhotoParallax(scrollY: number, headerHeight: number) {
  'worklet';
  const scroll = Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;
  const height = Number.isFinite(headerHeight) && headerHeight > 0 ? headerHeight : 1;
  // By this point even the extended photo field is well above the viewport.
  // Bound a long list's compensation without changing slope at the photo edge.
  return Math.min(scroll, height * 8 + 512) * .6;
}

// Keep worklet dependencies before their callers: Babel captures closures
// while initializing each worklet, unlike ordinary function declaration hoisting.
/** World-space photo movement: measured reference motion is 0.4 of content scroll. */
export function artistHeaderPhotoOffset(scrollY: number, headerHeight: number) {
  'worklet';
  const scroll = Number.isFinite(scrollY) ? scrollY : 0;
  return -scroll + artistPhotoParallax(scroll, headerHeight);
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

/** Handoff follows the visible name's bottom edge, including official artwork. */
export function artistHeaderTransition(scrollY: number, barHeight: number, name: ArtistNameMeasurement) {
  'worklet';
  const scroll = Number.isFinite(scrollY) ? scrollY : 0;
  const distance = Math.max(28, Math.min(64, name.height * .8));
  const bottomCrossing = name.y + name.height - barHeight;
  const exitEnd = Math.max(distance, bottomCrossing + distance * .25);
  const exitStart = exitEnd - distance;
  const phase = progress(scroll, exitStart, exitEnd);
  return {
    largeOpacity: 1 - phase,
    // The compact name can arrive dimly before the outgoing name vanishes,
    // but never while both are readable (>0.35). There is no empty-title gap.
    compactOpacity: Math.pow(phase, 2.5),
    backgroundOpacity: progress(scroll, Math.max(0, exitStart - 20), exitEnd),
  };
}

/** No guessed text/logo bounds are allowed to reveal a compact title at mount. */
export function artistHeaderFromLayout(scrollY: number, barHeight: number, name: ArtistNameMeasurement,
  width: number, bottomPadding: number, artworkAspect: number) {
  'worklet';
  if (!(name.height > 0) || !Number.isFinite(name.height) || !Number.isFinite(name.y)) return { largeOpacity: 1, compactOpacity: 0, backgroundOpacity: 0 };
  return artistHeaderTransition(scrollY, barHeight, artistNameVisualFrame(name, width, bottomPadding, artworkAspect));
}
