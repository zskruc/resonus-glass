/** Use the server's length when a live transcode reports an empty MP3 header. */
export function plausibleDuration(native: number | undefined, fallback: number, known?: number): number {
  if (!native || !Number.isFinite(native) || native <= 0) return fallback;
  if (known && Number.isFinite(known) && known > 0 && native < known * 0.5) return known;
  return native;
}
