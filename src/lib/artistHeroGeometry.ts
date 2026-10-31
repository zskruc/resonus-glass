/** Keep layout, photo framing and the backdrop's fade extent independent. */
export function artistHeroGeometry(headerHeight: number, actionsHeight: number) {
  const photoHeight = Math.max(1, headerHeight);
  const totalHeight = Math.max(photoHeight + actionsHeight, photoHeight * 1.35);
  return { photoHeight, extensionHeight: totalHeight - photoHeight,
    totalHeight, fadeStart: photoHeight * 0.52 / totalHeight };
}

/** One linear opacity ramp, shared by the sharp image and its blurred field. */
export function artistHeroOpacity(y: number, headerHeight: number, actionsHeight: number): number {
  const geometry = artistHeroGeometry(headerHeight, actionsHeight);
  const start = geometry.fadeStart * geometry.totalHeight;
  return Math.max(0, Math.min(1, (geometry.totalHeight - y) / (geometry.totalHeight - start)));
}
