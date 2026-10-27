/** Internal image crop follows the shared outer artwork, without any Yoga resize. */
export function playerArtworkCropScale(fit: boolean, width: number, height: number, progress: number): number {
  'worklet';
  if (!fit || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return 1;
  const coverScale = Math.max(width / height, height / width);
  if (!Number.isFinite(coverScale)) return 1;
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return coverScale * (1 - p) + p;
}

/** Finish on the mini's actual thumb before ownership changes at progress=0. */
export function playerArtworkCardOpacity(ready: boolean, progress: number): number {
  'worklet';
  if (!ready || !Number.isFinite(progress)) return 0;
  const p = Math.max(0, Math.min(1, (progress - .08) / .24));
  return p * p * (3 - 2 * p);
}
