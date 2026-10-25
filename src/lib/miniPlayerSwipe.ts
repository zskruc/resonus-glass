/** Small, bounded visual travel; raw finger distance still decides a skip. */
export const MINI_SWIPE_TRAVEL = 12;

export function miniSwipeOffset(rawX: number): number {
  'worklet';
  if (!Number.isFinite(rawX)) return 0;
  return MINI_SWIPE_TRAVEL * (rawX / (Math.abs(rawX) + 36));
}

/** Physical left advances, physical right uses the existing previous action. */
export function miniSwipeDirection(rawX: number, velocityX: number, width: number): -1 | 0 | 1 {
  'worklet';
  if (!Number.isFinite(rawX) || !Number.isFinite(velocityX) || !Number.isFinite(width) || width <= 0) return 0;
  const distance = Math.abs(rawX);
  const threshold = Math.min(96, Math.max(64, width * 0.25));
  const direction = rawX < 0 ? -1 : 1;
  if (distance >= threshold) return direction;
  // A brief twitch or a reversed fling must not accidentally skip a song.
  return distance >= 12 && Math.abs(velocityX) >= 800 && Math.sign(velocityX) === direction ? direction : 0;
}
