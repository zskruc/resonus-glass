/**
 * The player being pulled up out of the mini player.
 *
 * While the finger is on the mini player and going up, the player screen is
 * already open (pushed with no animation of its own) and sits this far down
 * from the top, following the finger. -1 when no pull is driving it, which is
 * every other way of opening and closing it.
 */
import { makeMutable } from 'react-native-reanimated';
import type { AppleMusicPlayerTransitionFrame, AppleMusicRect } from './appleMusicPlayerTransition';

export const revealOffset = makeMutable(-1);

/** The opaque AMLL surface and its dock underlay share this exact UI position. */
export const playerSurfaceOffset = makeMutable(-1);
export const playerSurfaceHeight = makeMutable(1);
export const playerSurfaceOwner = makeMutable(0);
export type MiniArtworkMetrics = {
  viewportWidth: number; viewportHeight: number;
  miniPlayer: AppleMusicRect; miniArtwork: AppleMusicRect;
  /** Idle image endpoint, independent of press elasticity or horizontal swiping. */
  restingArtwork?: AppleMusicRect;
};
export type PlayerArtworkFlight = {
  owner: number;
  phase: 'opening' | 'closing' | 'handoff';
  frame: AppleMusicPlayerTransitionFrame;
};
/** Measured native coordinates; hidden retained mini layouts stay measurable. */
export const miniArtworkMetrics = makeMutable<MiniArtworkMetrics | null>(null);
export const playerCanReturnToMini = makeMutable(false);
/** One image layer owns both endpoints until the route's actual handoff. */
export const playerArtworkFlight = makeMutable<PlayerArtworkFlight | null>(null);
export const playerUnderlayRouteKey = makeMutable<string | null>(null);
export const playerUnderlayFrame = makeMutable<{
  owner: number; routeKey: string; scale: number; translateY: number; cornerRadius: number;
} | null>(null);
let nextSurfaceOwner = 0;
export function createPlayerSurfaceOwner(): number { return ++nextSurfaceOwner; }

/** Fixed clipping bounds move; the counter-translated content stays anchored. */
export function playerDockClipOffset(offset: number, sourceHeight: number, viewportHeight: number): number {
  'worklet';
  const height = Math.max(1, viewportHeight);
  const progress = Number.isFinite(offset) && sourceHeight > 0 ? Math.max(0, Math.min(1, offset / sourceHeight)) : 0;
  return (progress - 1) * height;
}
