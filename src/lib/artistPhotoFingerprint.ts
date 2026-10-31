/** Native 16×16 RGB region means, before crop/blur. This is content verification, not a name match. */
export function isArtistPhotoFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{1536}$/i.test(value);
}

export function artistPhotoFingerprintMetrics(first: string, second: string) {
  if (!isArtistPhotoFingerprint(first) || !isArtistPhotoFingerprint(second)) return null;
  let absolute = 0; let squared = 0; let maximum = 0;
  let sumA = 0; let sumB = 0; let squareA = 0; let squareB = 0; let product = 0;
  const cells: number[] = [];
  for (let cell = 0; cell < 256; cell++) {
    let lumaA = 0; let lumaB = 0; let worst = 0;
    for (let channel = 0; channel < 3; channel++) {
      const offset = cell * 6 + channel * 2;
      const a = parseInt(first.slice(offset, offset + 2), 16);
      const b = parseInt(second.slice(offset, offset + 2), 16);
      const delta = Math.abs(a - b);
      absolute += delta; squared += delta * delta; worst = Math.max(worst, delta);
      const weight = [0.2126, 0.7152, 0.0722][channel];
      lumaA += a * weight; lumaB += b * weight;
    }
    maximum = Math.max(maximum, worst); cells.push(worst);
    sumA += lumaA; sumB += lumaB; squareA += lumaA * lumaA; squareB += lumaB * lumaB; product += lumaA * lumaB;
  }
  const varianceA = Math.max(0, squareA / 256 - (sumA / 256) ** 2);
  const varianceB = Math.max(0, squareB / 256 - (sumB / 256) ** 2);
  cells.sort((a, b) => a - b);
  return { meanAbsolute: absolute / 768, rms: Math.sqrt(squared / 768), maximum,
    percentile95: cells[Math.floor(255 * .95)], deviationA: Math.sqrt(varianceA), deviationB: Math.sqrt(varianceB),
    correlation: varianceA > 0 && varianceB > 0 ? (product / 256 - sumA * sumB / (256 * 256)) / Math.sqrt(varianceA * varianceB) : 0 };
}

/** Permit small resize/JPEG noise, never flat placeholders or a different portrait/composition. */
export function artistPhotoFingerprintsMatch(first: string, second: string): boolean {
  const metrics = artistPhotoFingerprintMetrics(first, second);
  return !!metrics && metrics.deviationA >= 8 && metrics.deviationB >= 8
    && metrics.meanAbsolute <= 3 && metrics.rms <= 5 && metrics.percentile95 <= 8
    && metrics.maximum <= 20 && metrics.correlation >= .995;
}
