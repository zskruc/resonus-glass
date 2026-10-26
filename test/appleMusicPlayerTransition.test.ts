import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  APPLE_MUSIC_PLAYER_MOTION, appleMusicPlayerDrag, isAppleMusicTransitionSnapshotValid,
  resolveAppleMusicPlayerTransition, shouldDismissAppleMusicPlayer,
  type AppleMusicPlayerTransitionFrame, type AppleMusicTransitionSnapshot,
} from '@/lib/appleMusicPlayerTransition';

const snapshot: AppleMusicTransitionSnapshot = {
  viewportWidth: 400, viewportHeight: 800,
  miniPlayer: { x: 12, y: 700, width: 376, height: 56 },
  miniArtwork: { x: 20, y: 708, width: 40, height: 40 },
  playerArtwork: { x: 25, y: 110, width: 350, height: 350 },
};

function frame(progress: number, extra: Partial<Parameters<typeof resolveAppleMusicPlayerTransition>[0]> = {}) {
  const result = resolveAppleMusicPlayerTransition({ snapshot, viewportWidth: 400, viewportHeight: 800,
    progress, deviceCornerRadius: 44, controlsHeight: 250, ...extra });
  assert.ok(result);
  return result;
}

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `expected ${expected}, received ${actual}`);

// Apply the default-center scale to the fixed image base independently of the
// helper's rect interpolation. This catches the common half-width/height jump.
function renderedBounds(artwork: AppleMusicPlayerTransitionFrame['artwork']) {
  return {
    x: artwork.baseWidth / 2 + artwork.translateX - artwork.baseWidth * artwork.scaleX / 2,
    y: artwork.baseHeight / 2 + artwork.translateY - artwork.baseHeight * artwork.scaleY / 2,
    width: artwork.baseWidth * artwork.scaleX,
    height: artwork.baseHeight * artwork.scaleY,
  };
}

describe('AppleMusicStylePlayer shared artwork adaptation', () => {
  it('retains the pinned source timing, geometry and signed-velocity release policy', () => {
    assert.equal(APPLE_MUSIC_PLAYER_MOTION.durationMs, 300);
    assert.equal(APPLE_MUSIC_PLAYER_MOTION.extraBounce, 0);
    assert.equal(APPLE_MUSIC_PLAYER_MOTION.compactHeight, 56);
    assert.equal(APPLE_MUSIC_PLAYER_MOTION.compactArtworkSize, 40);
    assert.equal(APPLE_MUSIC_PLAYER_MOTION.pausedArtworkPadding, 48);
    assert.equal(shouldDismissAppleMusicPlayer(240, 0, 800), false, 'the source comparison is strictly greater');
    assert.equal(shouldDismissAppleMusicPlayer(241, 0, 800), true);
    assert.equal(shouldDismissAppleMusicPlayer(100, 701, 800), true);
    assert.equal(shouldDismissAppleMusicPlayer(300, -400, 800), false, 'an upward reversal retains its negative velocity');
    assert.equal(shouldDismissAppleMusicPlayer(-40, 0, 800), false);
    assert.equal(shouldDismissAppleMusicPlayer(300, 0, 0), false);
    assert.equal(shouldDismissAppleMusicPlayer(NaN, 1000, 800), false);
  });

  it('lands the one fixed-base image exactly on both measured artworks without moving its layout bounds', () => {
    const mini = frame(0); const full = frame(1);
    for (const [pose, target] of [[mini, snapshot.miniArtwork], [full, snapshot.playerArtwork]] as const) {
      const painted = renderedBounds(pose.artwork);
      near(painted.x, target.x); near(painted.y, target.y);
      near(painted.width, target.width); near(painted.height, target.height);
      assert.equal(pose.artwork.baseWidth, 350); assert.equal(pose.artwork.baseHeight, 350);
    }
    near(mini.artwork.cornerRadius * mini.artwork.scaleX, 7);
    assert.equal(full.artwork.cornerRadius, 10);
    assert.equal(mini.fullContentOpacity, 0); assert.equal(mini.miniContentOpacity, 1);
    assert.equal(full.fullContentOpacity, 1); assert.equal(full.miniContentOpacity, 0);
    assert.deepEqual(full.background.rect, { x: 0, y: 0, width: 400, height: 800 });
  });

  it('matches artwork independently of the background outline and full-layout controls', () => {
    const pose = frame(0.5);
    assert.deepEqual(pose.artwork.rect, { x: 22.5, y: 409, width: 195, height: 195, cornerRadius: 8.5 });
    assert.deepEqual(pose.background.rect, { x: 6, y: 350, width: 388, height: 428 });
    assert.equal(pose.contentTranslateX, 6); assert.equal(pose.contentTranslateY, 350);
    assert.equal(pose.controlsTranslateY, 125, 'the controls move by their own height, not the entire viewport');
    assert.equal(pose.background.cornerRadius, 29);
    assert.equal(pose.fullContentOpacity + pose.miniContentOpacity, 1);
    const painted = renderedBounds(pose.artwork);
    near(painted.x, 22.5); near(painted.y, 409); near(painted.width, 195);
  });

  it('preserves subpixel shared geometry rather than rounding each frame to layout pixels', () => {
    const pose = frame(1 / 3);
    const painted = renderedBounds(pose.artwork);
    near(painted.x, 21 + 2 / 3);
    near(painted.y, 508 + 2 / 3);
    near(painted.width, 143 + 1 / 3);
    near(painted.height, 143 + 1 / 3);
    assert.equal(pose.artwork.baseWidth, 350);
    near(pose.artwork.cornerRadius * pose.artwork.scaleX, 8);
  });

  it('keeps a finger-driven full cover large and uses the separate source window progress', () => {
    const drag = appleMusicPlayerDrag(160, 800);
    assert.deepEqual(drag, { offsetY: 160, stackProgress: 0.8 });
    const pose = frame(1, { dragOffsetY: drag.offsetY, stackProgress: drag.stackProgress });
    assert.equal(pose.artwork.rect.width, 350);
    assert.equal(pose.artwork.rect.y, 270);
    assert.equal(pose.contentTranslateY, 160);
    assert.equal(pose.background.rect.height, 800);
    near(pose.underlay.scale, 0.92);
    near(pose.underlay.translateY, 7.36);
    assert.equal(pose.underlay.cornerRadius, 22);
    assert.deepEqual(appleMusicPlayerDrag(-100, 800), { offsetY: 0, stackProgress: 1 });
    assert.deepEqual(appleMusicPlayerDrag(1200, 800), { offsetY: 1200, stackProgress: 0 });
  });

  it('adds the separately animated release offset exactly once during closing', () => {
    const release = frame(1, { dragOffsetY: 160 });
    assert.equal(release.artwork.rect.y, 270);
    const halfway = frame(0.5, { dragOffsetY: 80 });
    assert.equal(halfway.artwork.rect.y, 489, 'do not multiply the already animated drag by progress a second time');
    assert.equal(halfway.contentTranslateY, 430);
    const destination = frame(0, { dragOffsetY: 0 });
    assert.equal(destination.artwork.rect.y, snapshot.miniArtwork.y);
  });

  it('uses the real painted paused cover or lyric-header cover rather than inventing another endpoint', () => {
    const paused: AppleMusicTransitionSnapshot = { ...snapshot, playerArtwork: {
      x: 25 + 48, y: 110 + 48, width: 350 - 96, height: 350 - 96, cornerRadius: 10,
    } };
    const pausedFull = frame(1, { snapshot: paused });
    assert.equal(pausedFull.artwork.baseWidth, 254);
    assert.equal(pausedFull.artwork.rect.x, 73); assert.equal(pausedFull.artwork.rect.width, 254);
    const lyricHeader: AppleMusicTransitionSnapshot = { ...snapshot,
      playerArtwork: { x: 20, y: 70, width: 72, height: 72, cornerRadius: 12 } };
    const lyricFull = frame(1, { snapshot: lyricHeader });
    assert.equal(lyricFull.artwork.rect.y, 70); assert.equal(lyricFull.artwork.rect.width, 72);
    assert.equal(lyricFull.artwork.cornerRadius, 12);
    near(renderedBounds(frame(0, { snapshot: lyricHeader }).artwork).width, 40);
  });

  it('matches the upstream main-window matrix and clears its normal endpoint', () => {
    const full = frame(1); const partial = frame(0.5); const mini = frame(0);
    assert.equal(full.underlay.scale, 0.9);
    assert.equal(full.underlay.translateY, 9, 'Swift scale followed by translation scales the translation vector');
    assert.equal(partial.underlay.scale, 0.95); assert.equal(partial.underlay.translateY, 4.75);
    assert.deepEqual(mini.underlay, { scale: 1, translateY: 0, cornerRadius: 0 });
    assert.equal(full.background.cornerRadius, 0, 'the fully expanded source drops its display-corner clip');
  });

  it('rejects missing, malformed and old-viewport snapshots so the owner can keep its slide fallback', () => {
    assert.equal(resolveAppleMusicPlayerTransition({ viewportWidth: 400, viewportHeight: 800, progress: 0.5 }), null);
    assert.equal(isAppleMusicTransitionSnapshotValid(snapshot, 800, 400), false);
    assert.equal(isAppleMusicTransitionSnapshotValid(snapshot, 401, 800), false);
    assert.equal(isAppleMusicTransitionSnapshotValid(snapshot, 400.5, 800), true);
    assert.equal(isAppleMusicTransitionSnapshotValid(snapshot, NaN, 800), false);
    for (const miniArtwork of [
      { x: NaN, y: 1, width: 40, height: 40 },
      { x: 1, y: 1, width: 0, height: 40 },
      { x: 1, y: 1, width: 40, height: Infinity },
      { x: 1, y: 1, width: 40, height: 40, cornerRadius: -1 },
      { x: Number.MAX_VALUE, y: 1, width: Number.MAX_VALUE, height: 40 },
    ]) {
      assert.equal(resolveAppleMusicPlayerTransition({ snapshot: { ...snapshot, miniArtwork },
        viewportWidth: 400, viewportHeight: 800, progress: 0.5 }), null);
    }
    assert.equal(resolveAppleMusicPlayerTransition({ snapshot: { ...snapshot,
      playerArtwork: { x: 0, y: 0, width: Number.MIN_VALUE, height: Number.MIN_VALUE } },
    viewportWidth: 400, viewportHeight: 800, progress: 0 }), null);
  });

  it('accepts fresh landscape measurements without reusing portrait coordinates', () => {
    const landscape: AppleMusicTransitionSnapshot = { viewportWidth: 800, viewportHeight: 400,
      miniPlayer: { x: 20, y: 320, width: 760, height: 56 },
      miniArtwork: { x: 28, y: 328, width: 40, height: 40 },
      playerArtwork: { x: 170, y: 40, width: 280, height: 280 } };
    const pose = resolveAppleMusicPlayerTransition({ snapshot: landscape, viewportWidth: 800, viewportHeight: 400, progress: 1 });
    assert.ok(pose);
    assert.equal(pose.artwork.rect.x, 170); assert.equal(pose.artwork.rect.y, 40);
    assert.equal(pose.background.rect.width, 800); assert.equal(pose.background.rect.height, 400);
  });

  it('does not mutate frozen measurements and bounds nonfinite animation inputs', () => {
    const copy = structuredClone(snapshot);
    for (const rect of [copy.miniPlayer, copy.miniArtwork, copy.playerArtwork]) Object.freeze(rect);
    Object.freeze(copy);
    const before = JSON.stringify(copy);
    const pose = frame(NaN, { snapshot: copy, dragOffsetY: Infinity, deviceCornerRadius: NaN,
      controlsHeight: Infinity, stackProgress: Infinity });
    assert.equal(pose.artwork.rect.x, 20); assert.equal(pose.contentTranslateY, 700);
    assert.equal(pose.controlsTranslateY, 0);
    assert.equal(pose.underlay.scale, 1);
    assert.equal(JSON.stringify(copy), before);
    assert.deepEqual(frame(-10).artwork, frame(0).artwork);
    assert.deepEqual(frame(10).artwork, frame(1).artwork);
  });
});
