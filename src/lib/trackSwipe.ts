/** Physical directions match the existing song-row actions: right is +1. */
export type TrackSwipeDirection = -1 | 0 | 1;

export const TRACK_SWIPE_INTENT = 30;
export const TRACK_SWIPE_CONFIRM = 90;
// Same release projection as gesture-handler's existing Swipeable.
export const TRACK_SWIPE_TOSS = 0.05;

export function trackSwipeOffset(
  translation: number,
  actionWidth: number,
  allowRight: boolean,
  allowLeft: boolean,
): number {
  'worklet';
  if (!Number.isFinite(translation) || !Number.isFinite(actionWidth) || actionWidth <= 0) return 0;
  return Math.max(allowLeft ? -actionWidth : 0, Math.min(allowRight ? actionWidth : 0, translation));
}

export function trackSwipeRelease(
  translation: number,
  velocity: number,
  allowRight: boolean,
  allowLeft: boolean,
): TrackSwipeDirection {
  'worklet';
  if (!Number.isFinite(translation) || !Number.isFinite(velocity)) return 0;
  const projected = translation + velocity * TRACK_SWIPE_TOSS;
  if (allowRight && projected > TRACK_SWIPE_CONFIRM) return 1;
  if (allowLeft && projected < -TRACK_SWIPE_CONFIRM) return -1;
  return 0;
}
