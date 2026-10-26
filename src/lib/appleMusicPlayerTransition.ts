/**
 * Geometry adaptation of f728743/AppleMusicStylePlayer.
 * Copyright (c) 2025 Alexey Vorobyov. SPDX-License-Identifier: MIT.
 * Pinned source: a0b5631417dec05d092c3c61df4679ed361743bf,
 * NowPlaying/{ExpandableNowPlaying,CompactNowPlaying,RegularNowPlaying}.swift.
 * https://github.com/f728743/AppleMusicStylePlayer/blob/a0b5631417dec05d092c3c61df4679ed361743bf/LICENSE
 *
 * The artwork alone matches between two measured rectangles. Normal player
 * content retains its full layout; the background has a separate outline.
 * This ports the geometry contract, not SwiftUI's undocumented smooth solver.
 */

export const APPLE_MUSIC_PLAYER_MOTION = {
  durationMs: 300,
  extraBounce: 0,
  dismissHeightFraction: 0.3,
  velocityDivisor: 5,
  compactHeight: 56,
  compactHorizontalPadding: 12,
  compactArtworkSize: 40,
  compactArtworkCornerRadius: 7,
  expandedArtworkCornerRadius: 10,
  pausedArtworkPadding: 48,
  compactBackgroundCornerRadius: 14,
  windowScaleDrop: 0.1,
  windowOffsetY: 10,
  windowCornerRadius: 22,
} as const;

export interface AppleMusicRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radius in screen coordinates, before converting to the fixed image base. */
  cornerRadius?: number;
}

/** Capture once in one coordinate space before a transition; do not remeasure per frame. */
export interface AppleMusicTransitionSnapshot {
  viewportWidth: number;
  viewportHeight: number;
  miniPlayer: AppleMusicRect;
  miniArtwork: AppleMusicRect;
  /** The painted cover, including any paused inset or lyric-header transform. */
  playerArtwork: AppleMusicRect;
}

export interface AppleMusicPlayerTransitionInput {
  snapshot?: AppleMusicTransitionSnapshot | null;
  viewportWidth: number;
  viewportHeight: number;
  /** Already animated: 0 = mini, 1 = full. Opening and closing use the same geometry. */
  progress: number;
  /** Independent root translation; animate it back to zero on commit/cancel. */
  dragOffsetY?: number;
  /** Upstream reads the device's display corner; callers supply their public/native value. */
  deviceCornerRadius?: number;
  /** The controls' own measured height for SwiftUI's move(edge: .bottom) equivalent. */
  controlsHeight?: number;
  /** Independent underlay clock; during a pull the source uses 1 - dragY / height. */
  stackProgress?: number;
}

export interface AppleMusicPlayerTransitionFrame {
  artwork: {
    rect: AppleMusicRect;
    /** Keep these Yoga dimensions unchanged throughout the flight. */
    baseWidth: number;
    baseHeight: number;
    /** Center-origin transforms for an absolute base box at (0, 0). */
    translateX: number;
    translateY: number;
    scaleX: number;
    scaleY: number;
    /** Local radius, compensated for the artwork scale. */
    cornerRadius: number;
  };
  /** An outline for the separate backdrop, never a scale for the whole player. */
  background: { rect: AppleMusicRect; cornerRadius: number };
  fullContentOpacity: number;
  miniContentOpacity: number;
  /** Move the fixed full-layout content with the shared container; do not resize it. */
  contentTranslateX: number;
  contentTranslateY: number;
  /** Local controls movement, in addition to the containing content translation. */
  controlsTranslateY: number;
  underlay: { scale: number; translateY: number; cornerRadius: number };
}

function unit(value: number): number {
  'worklet';
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function validRect(rect?: AppleMusicRect | null): rect is AppleMusicRect {
  'worklet';
  return !!rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) && rect.width > 0 && Number.isFinite(rect.height) && rect.height > 0 &&
    Number.isFinite(rect.x + rect.width) && Number.isFinite(rect.y + rect.height) &&
    (rect.cornerRadius === undefined || Number.isFinite(rect.cornerRadius) && rect.cornerRadius >= 0);
}

/** Reject stale portrait measurements; the caller retains its ordinary slide fallback. */
export function isAppleMusicTransitionSnapshotValid(
  snapshot: AppleMusicTransitionSnapshot | null | undefined,
  viewportWidth: number,
  viewportHeight: number,
): snapshot is AppleMusicTransitionSnapshot {
  'worklet';
  return !!snapshot && Number.isFinite(viewportWidth) && viewportWidth > 0 &&
    Number.isFinite(viewportHeight) && viewportHeight > 0 &&
    Number.isFinite(snapshot.viewportWidth) && Number.isFinite(snapshot.viewportHeight) &&
    Math.abs(snapshot.viewportWidth - viewportWidth) < 1 &&
    Math.abs(snapshot.viewportHeight - viewportHeight) < 1 &&
    validRect(snapshot.miniPlayer) && validRect(snapshot.miniArtwork) && validRect(snapshot.playerArtwork);
}

function mix(from: number, to: number, progress: number): number {
  'worklet';
  return from * (1 - progress) + to * progress;
}

function radius(rect: AppleMusicRect, fallback: number): number {
  'worklet';
  return Math.min(rect.cornerRadius ?? fallback, rect.width / 2, rect.height / 2);
}

/** The source does not shrink the cover during a downward drag. */
export function appleMusicPlayerDrag(translationY: number, viewportHeight: number): { offsetY: number; stackProgress: number } {
  'worklet';
  const offsetY = Number.isFinite(translationY) ? Math.max(translationY, 0) : 0;
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1;
  return { offsetY, stackProgress: 1 - unit(offsetY / height) };
}

/** Keep the signed release velocity: an upward reversal can cancel a long pull. */
export function shouldDismissAppleMusicPlayer(translationY: number, velocityY: number, viewportHeight: number): boolean {
  'worklet';
  if (!Number.isFinite(translationY) || !Number.isFinite(velocityY) ||
      !Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;
  return Math.max(translationY, 0) + velocityY / APPLE_MUSIC_PLAYER_MOTION.velocityDivisor >
    viewportHeight * APPLE_MUSIC_PLAYER_MOTION.dismissHeightFraction;
}

/** Public counterpart of the source window-depth transform, applied to one base screen. */
export function appleMusicUnderlayFrame(stackProgress: number) {
  'worklet';
  const p = unit(stackProgress);
  const scale = 1 - APPLE_MUSIC_PLAYER_MOTION.windowScaleDrop * p;
  return { scale, translateY: APPLE_MUSIC_PLAYER_MOTION.windowOffsetY * p * scale,
    cornerRadius: p > 0 ? APPLE_MUSIC_PLAYER_MOTION.windowCornerRadius : 0 };
}

/**
 * One shared image flight, with endpoint opacity controlled by the owner.
 * Hide the two original artworks while this overlay owns them; on completion
 * reveal the destination and remove the overlay atomically. The hook retains
 * generation/route ownership, cancellation and the navigation commit.
 *
 * `progress` and `dragOffsetY` are separate clocks just as in the Swift source.
 * On dismissal animate the current progress to 0 AND current drag to 0; do not
 * reset the drag before taking the first closing frame. No layout/style writes,
 * image creation, JS dispatch or measurement happen in this worklet helper.
 */
export function resolveAppleMusicPlayerTransition({
  snapshot, viewportWidth, viewportHeight, progress, dragOffsetY = 0,
  deviceCornerRadius = 0, controlsHeight = 0, stackProgress = progress,
}: AppleMusicPlayerTransitionInput): AppleMusicPlayerTransitionFrame | null {
  'worklet';
  if (!isAppleMusicTransitionSnapshotValid(snapshot, viewportWidth, viewportHeight)) return null;
  const p = unit(progress);
  const drag = Number.isFinite(dragOffsetY) ? Math.max(0, dragOffsetY) : 0;
  const from = snapshot.miniArtwork;
  const to = snapshot.playerArtwork;
  const artworkRadius = mix(radius(from, APPLE_MUSIC_PLAYER_MOTION.compactArtworkCornerRadius),
    radius(to, APPLE_MUSIC_PLAYER_MOTION.expandedArtworkCornerRadius), p);
  const artwork = {
    x: mix(from.x, to.x, p), y: mix(from.y, to.y, p) + drag,
    width: mix(from.width, to.width, p), height: mix(from.height, to.height, p),
    cornerRadius: artworkRadius,
  };
  const scaleX = artwork.width / to.width;
  const scaleY = artwork.height / to.height;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;
  const mini = snapshot.miniPlayer;
  const background = {
    x: mix(mini.x, 0, p), y: mix(mini.y, 0, p) + drag,
    width: mix(mini.width, viewportWidth, p), height: mix(mini.height, viewportHeight, p),
  };
  const displayRadius = Number.isFinite(deviceCornerRadius) ? Math.max(0, deviceCornerRadius) : 0;
  // The source rounds to the display corner while moving, then removes the
  // background corner when its ProgressTracker reports a fully open player.
  const backgroundRadius = p >= 1 ? 0 : Math.min(
    mix(radius(mini, APPLE_MUSIC_PLAYER_MOTION.compactBackgroundCornerRadius), displayRadius, p),
    background.width / 2, background.height / 2,
  );
  return {
    artwork: {
      rect: artwork, baseWidth: to.width, baseHeight: to.height,
      translateX: artwork.x + (artwork.width - to.width) / 2,
      translateY: artwork.y + (artwork.height - to.height) / 2,
      scaleX, scaleY,
      cornerRadius: Math.min(artworkRadius / Math.min(scaleX, scaleY), to.width / 2, to.height / 2),
    },
    background: { rect: background, cornerRadius: backgroundRadius },
    fullContentOpacity: p, miniContentOpacity: 1 - p,
    contentTranslateX: background.x, contentTranslateY: background.y,
    controlsTranslateY: (Number.isFinite(controlsHeight) ? Math.max(0, controlsHeight) : 0) * (1 - p),
    underlay: appleMusicUnderlayFrame(stackProgress),
  };
}
