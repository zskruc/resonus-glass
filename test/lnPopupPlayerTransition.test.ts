import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LNPOPUP_PLAYER_MOTION, lnPopupPlayerDrag, lnPopupRubberBand,
  resolveLnPopupPlayerTransition, shouldDismissLnPopupPlayer,
  type AppleMusicPlayerTransitionFrame, type AppleMusicTransitionSnapshot, type LnPopupPlayerTransitionInput,
} from '@/lib/appleMusicPlayerTransition';

const snapshot: AppleMusicTransitionSnapshot = {
  viewportWidth: 400, viewportHeight: 800,
  miniPlayer: { x: 12, y: 700, width: 376, height: 56, cornerRadius: 28 },
  miniArtwork: { x: 20, y: 708, width: 40, height: 40, cornerRadius: 7 },
  playerArtwork: { x: 25, y: 110, width: 350, height: 350, cornerRadius: 10 },
};
const near = (actual: number, expected: number, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon,
  `expected ${expected}, received ${actual}`);

function frame(progress: number, extra: Partial<LnPopupPlayerTransitionInput> = {}) {
  const result = resolveLnPopupPlayerTransition({ snapshot, viewportWidth: 400, viewportHeight: 800,
    progress, deviceCornerRadius: 44, controlsHeight: 250, ...extra });
  assert.ok(result);
  return result;
}

// Independently apply React Native's center-origin transform to the fixed box.
function renderedBounds(artwork: AppleMusicPlayerTransitionFrame['artwork']) {
  return {
    x: artwork.baseWidth / 2 + artwork.translateX - artwork.baseWidth * artwork.scaleX / 2,
    y: artwork.baseHeight / 2 + artwork.translateY - artwork.baseHeight * artwork.scaleY / 2,
    width: artwork.baseWidth * artwork.scaleX,
    height: artwork.baseHeight * artwork.scaleY,
  };
}

describe('LNPopup coordinated Android presentation', () => {
  it('lands the cover and the container at their measured endpoints with full layout unchanged', () => {
    for (const direction of ['opening', 'closing'] as const) {
      const mini = frame(0, { direction }); const full = frame(1, { direction });
      for (const [pose, target] of [[mini, snapshot.miniArtwork], [full, snapshot.playerArtwork]] as const) {
        const painted = renderedBounds(pose.artwork);
        near(painted.x, target.x); near(painted.y, target.y);
        near(painted.width, target.width); near(painted.height, target.height);
        assert.equal(pose.artwork.baseWidth, 350); assert.equal(pose.artwork.baseHeight, 350);
        assert.equal(pose.controlsTranslateY, 0, 'transport layout has no second independent slide');
        assert.deepEqual(pose.underlay, { scale: 1, translateY: 0, cornerRadius: 0 });
      }
      assert.deepEqual(mini.background.rect, { x: 12, y: 700, width: 376, height: 56 });
      assert.deepEqual(full.background.rect, { x: 0, y: 0, width: 400, height: 800 });
      assert.equal(mini.fullContentOpacity, 0); assert.equal(mini.miniContentOpacity, 1);
      assert.equal(full.fullContentOpacity, 1); assert.equal(full.miniContentOpacity, 0);
      assert.equal(mini.surfaceOpacity, 0, 'the endpoint reveals the retained real mini glass');
      assert.equal(full.surfaceOpacity, 1); assert.equal(full.background.cornerRadius, 0);
      assert.equal(full.contentTranslateX, 0); assert.equal(full.contentTranslateY, 0);
    }
  });

  it('follows the finger with the container and cover on one bounded presentation progress', () => {
    const drag = lnPopupPlayerDrag(160, snapshot.miniPlayer.y);
    const pose = frame(drag.progress, { direction: 'closing', dragOffsetY: drag.offsetY,
      stackProgress: drag.stackProgress });
    near(pose.background.rect.y, 160);
    near(pose.contentTranslateY, 160);
    near(pose.artworkProgress, 1 - 160 / 700);
    near(pose.artwork.rect.width, 350 - (350 - 40) * 160 / 700);
    near(pose.artwork.rect.y, snapshot.playerArtwork.y + (snapshot.miniArtwork.y - snapshot.playerArtwork.y) * 160 / 700);
    const unoffset = frame(drag.progress, { direction: 'closing' });
    assert.deepEqual(pose, unoffset, 'an old drag offset cannot be applied a second time');
    assert.deepEqual(lnPopupPlayerDrag(-12, 700), { progress: 1, offsetY: 0, stackProgress: 1 });
    assert.deepEqual(lnPopupPlayerDrag(1200, 700), { progress: 0, offsetY: 700, stackProgress: 0 });
    assert.deepEqual(lnPopupPlayerDrag(200, 0), { progress: 1, offsetY: 0, stackProgress: 1 });
    assert.deepEqual(lnPopupPlayerDrag(Infinity, 700), { progress: 1, offsetY: 0, stackProgress: 1 });
  });

  it('uses a direction-aware release and permits an upward reversal before halfway', () => {
    assert.equal(shouldDismissLnPopupPlayer(30, 150, 700), true);
    assert.equal(shouldDismissLnPopupPlayer(280, -150, 700), false);
    assert.equal(shouldDismissLnPopupPlayer(350, 0, 700), false);
    assert.equal(shouldDismissLnPopupPlayer(351, 0, 700), true);
    assert.equal(shouldDismissLnPopupPlayer(400, -100, 700), true);
    assert.equal(shouldDismissLnPopupPlayer(0, 2000, 700), false);
    assert.equal(shouldDismissLnPopupPlayer(NaN, 2000, 700), false);
    assert.equal(shouldDismissLnPopupPlayer(400, Infinity, 700), false);
    assert.equal(shouldDismissLnPopupPlayer(400, 500, 0), false);
  });

  it('preserves the source foreground phases independently of geometric crop and background opacity', () => {
    const first = frame(.05);
    near(first.fullContentOpacity, .05); near(first.miniContentOpacity, .5);
    assert.equal(frame(.1).miniContentOpacity, 0);
    const closingStart = frame(.9, { direction: 'closing' });
    assert.equal(closingStart.fullContentOpacity, 1);
    assert.equal(closingStart.miniContentOpacity, 0);
    const closing = frame(.6, { direction: 'closing' });
    near(closing.fullContentOpacity, .6 / .85);
    near(closing.fullContentOpacity + closing.miniContentOpacity, 1);
    assert.equal(closing.artworkProgress, .6, 'staged opacity does not change artwork crop or image-source blending');
    assert.equal(closing.surfaceOpacity, 1);
    assert.ok(first.surfaceOpacity > first.fullContentOpacity, 'the moving container remains present while foreground blends');
    assert.equal(LNPOPUP_PLAYER_MOTION.durationMs, 500);
    assert.equal(LNPOPUP_PLAYER_MOTION.tapDampingRatio, 1);
    assert.equal(LNPOPUP_PLAYER_MOTION.gestureDampingRatio, .87);
  });

  it('reverses opening to closing at the exact painted alpha and still reaches both endpoints', () => {
    for (const progress of [.02, .06, .2, .6, .95]) {
      const before = frame(progress);
      const opacityAnchor = { progress, fullContentOpacity: before.fullContentOpacity, miniContentOpacity: before.miniContentOpacity };
      const atSwitch = frame(progress, { direction: 'closing', opacityAnchor });
      assert.deepEqual(atSwitch.artwork, before.artwork);
      assert.deepEqual(atSwitch.background, before.background);
      assert.equal(atSwitch.fullContentOpacity, before.fullContentOpacity);
      assert.equal(atSwitch.miniContentOpacity, before.miniContentOpacity);
      let previousFull = before.fullContentOpacity; let previousMini = before.miniContentOpacity;
      for (let step = 1; step <= 100; step++) {
        const next = frame(progress * (1 - step / 100), { direction: 'closing', opacityAnchor });
        assert.ok(next.fullContentOpacity <= previousFull + 1e-10);
        assert.ok(next.miniContentOpacity >= previousMini - 1e-10);
        previousFull = next.fullContentOpacity; previousMini = next.miniContentOpacity;
      }
      assert.equal(previousFull, 0); assert.equal(previousMini, 1);
      const restored = frame(1, { direction: 'closing', opacityAnchor });
      assert.equal(restored.fullContentOpacity, 1); assert.equal(restored.miniContentOpacity, 0);
    }
  });

  it('can reverse a close again through a flat opening phase without a jump or stuck foreground', () => {
    const before = frame(.7, { direction: 'closing' });
    const opacityAnchor = { progress: .7, fullContentOpacity: before.fullContentOpacity, miniContentOpacity: before.miniContentOpacity };
    const switched = frame(.7, { direction: 'opening', opacityAnchor });
    assert.equal(switched.fullContentOpacity, before.fullContentOpacity);
    assert.equal(switched.miniContentOpacity, before.miniContentOpacity);
    const nearSwitch = frame(.7000001, { direction: 'opening', opacityAnchor });
    near(nearSwitch.fullContentOpacity, before.fullContentOpacity, 1e-5);
    near(nearSwitch.miniContentOpacity, before.miniContentOpacity, 1e-5);
    const full = frame(1, { direction: 'opening', opacityAnchor });
    assert.equal(full.fullContentOpacity, 1); assert.equal(full.miniContentOpacity, 0);
    const invalid = frame(.5, { opacityAnchor: { progress: NaN, fullContentOpacity: .2, miniContentOpacity: .8 } });
    assert.deepEqual(invalid, frame(.5));
  });

  it('retains the painted pressed-origin cover on reversal and still cancels to the real full endpoint', () => {
    const pressed: AppleMusicTransitionSnapshot = { ...snapshot,
      miniArtwork: { x: 21.2, y: 709.2, width: 37.6, height: 37.6, cornerRadius: 6.58 } };
    const progress = .36;
    const before = frame(progress, { snapshot: pressed });
    const artworkAnchor = { progress, rect: before.artwork.rect };
    const switched = frame(progress, { direction: 'closing', artworkAnchor });
    for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
      near(renderedBounds(switched.artwork)[coordinate], renderedBounds(before.artwork)[coordinate]);
    }
    near(switched.artwork.rect.cornerRadius!, before.artwork.rect.cornerRadius!);
    assert.equal(switched.artworkProgress, progress);
    assert.equal(switched.artwork.baseWidth, snapshot.playerArtwork.width);
    assert.equal(switched.artwork.baseHeight, snapshot.playerArtwork.height);
    const pulled = frame(.25, { direction: 'closing', artworkAnchor });
    const cancelAnchor = { progress: .25, rect: pulled.artwork.rect };
    const cancelling = frame(.25, { direction: 'closing', artworkAnchor: cancelAnchor });
    for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
      near(renderedBounds(cancelling.artwork)[coordinate], renderedBounds(pulled.artwork)[coordinate]);
    }
    // A virtual full endpoint would retain an extrapolated press correction,
    // causing a visible last-frame jump when the real player cover took over.
    const full = frame(1, { direction: 'closing', artworkAnchor: cancelAnchor });
    assert.deepEqual(full.artwork, frame(1).artwork);
    const mini = frame(0, { direction: 'closing', artworkAnchor });
    assert.deepEqual(mini.artwork, frame(0).artwork);
    assert.notDeepEqual(mini.artwork.rect, pressed.miniArtwork);
    const nearAnchorBefore = frame(progress - 1e-8, { artworkAnchor });
    const nearAnchorAfter = frame(progress + 1e-8, { artworkAnchor });
    for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
      near(nearAnchorBefore.artwork.rect[coordinate], nearAnchorAfter.artwork.rect[coordinate], 1e-4);
    }
  });

  it('anchors a lyric-header cover without changing its image base and ignores malformed anchors', () => {
    const lyrics: AppleMusicTransitionSnapshot = { ...snapshot,
      playerArtwork: { x: 20, y: 70, width: 72, height: 72, cornerRadius: 12 } };
    const artworkAnchor = { progress: .45, rect: { x: 23, y: 390, width: 56, height: 56, cornerRadius: 9 } };
    Object.freeze(artworkAnchor.rect); Object.freeze(artworkAnchor);
    const anchored = frame(.45, { snapshot: lyrics, artworkAnchor });
    assert.deepEqual(anchored.artwork.rect, artworkAnchor.rect);
    assert.equal(anchored.artwork.baseWidth, 72); assert.equal(anchored.artwork.baseHeight, 72);
    assert.deepEqual(frame(1, { snapshot: lyrics, artworkAnchor }).artwork, frame(1, { snapshot: lyrics }).artwork);
    assert.deepEqual(frame(0, { snapshot: lyrics, artworkAnchor }).artwork, frame(0, { snapshot: lyrics }).artwork);
    for (const invalid of [
      { progress: NaN, rect: artworkAnchor.rect },
      { progress: Infinity, rect: artworkAnchor.rect },
      { progress: 0, rect: artworkAnchor.rect },
      { progress: 1, rect: artworkAnchor.rect },
      { progress: .45, rect: { ...artworkAnchor.rect, x: Infinity } },
      { progress: .45, rect: { ...artworkAnchor.rect, width: 0 } },
      { progress: .45, rect: { ...artworkAnchor.rect, width: Number.MIN_VALUE } },
      { progress: .45, rect: { ...artworkAnchor.rect, cornerRadius: -1 } },
    ]) assert.deepEqual(frame(.45, { artworkAnchor: invalid }), frame(.45));
  });

  it('has no background-corner or glass-opacity discontinuity at the full and mini handoffs', () => {
    const epsilon = 1e-7;
    const almostFull = frame(1 - epsilon); const full = frame(1);
    near(almostFull.background.cornerRadius, full.background.cornerRadius, 1e-6);
    near(almostFull.surfaceOpacity, full.surfaceOpacity);
    const almostMini = frame(epsilon); const mini = frame(0);
    near(almostMini.background.rect.x, mini.background.rect.x, 1e-4);
    near(almostMini.background.rect.y, mini.background.rect.y, 1e-4);
    near(almostMini.surfaceOpacity, mini.surfaceOpacity, 1e-6);
    near(almostMini.background.cornerRadius, mini.background.cornerRadius, 1e-4);
  });

  it('keeps every intermediate physical bound finite and ordered in portrait, landscape and lyric header modes', () => {
    const variants = [snapshot,
      { ...snapshot, playerArtwork: { x: 20, y: 70, width: 72, height: 72, cornerRadius: 12 } },
      { viewportWidth: 800, viewportHeight: 400,
        miniPlayer: { x: 20, y: 320, width: 760, height: 56 },
        miniArtwork: { x: 28, y: 328, width: 40, height: 40 },
        playerArtwork: { x: 170, y: 40, width: 280, height: 280 } },
    ];
    for (const next of variants) {
      Object.freeze(next.miniPlayer); Object.freeze(next.miniArtwork); Object.freeze(next.playerArtwork); Object.freeze(next);
      const before = JSON.stringify(next);
      let previousY = next.miniPlayer.y; let previousWidth = next.miniArtwork.width;
      for (let step = 0; step <= 200; step++) {
        const result = resolveLnPopupPlayerTransition({ snapshot: next, viewportWidth: next.viewportWidth,
          viewportHeight: next.viewportHeight, progress: step / 200, direction: 'opening', deviceCornerRadius: 44 });
        assert.ok(result);
        const painted = renderedBounds(result.artwork);
        for (const value of [...Object.values(painted), result.surfaceOpacity, result.background.cornerRadius,
          result.fullContentOpacity, result.miniContentOpacity]) assert.ok(Number.isFinite(value));
        assert.ok(result.background.rect.y <= previousY + 1e-8);
        assert.ok(result.artwork.rect.width >= previousWidth - 1e-8);
        assert.ok(result.background.cornerRadius >= 0);
        assert.ok(result.background.cornerRadius <= result.background.rect.height / 2);
        previousY = result.background.rect.y; previousWidth = result.artwork.rect.width;
      }
      assert.equal(JSON.stringify(next), before);
    }
    assert.equal(resolveLnPopupPlayerTransition({ viewportWidth: 400, viewportHeight: 800, progress: .5 }), null);
    assert.equal(resolveLnPopupPlayerTransition({ snapshot, viewportWidth: 800, viewportHeight: 400, progress: .5 }), null);
  });

  it('uses bounded snap resistance without overflow and preserves source values in ordinary gestures', () => {
    near(lnPopupRubberBand(100, 800), 100 * 800 * .32 / (800 + .32 * 100));
    const values = [0, 5, 50, 500, 5000, Number.MAX_VALUE].map((x) => lnPopupRubberBand(x, 800));
    for (let i = 0; i < values.length; i++) {
      assert.ok(Number.isFinite(values[i]) && values[i] >= 0 && values[i] <= 800);
      if (i > 0) assert.ok(values[i] >= values[i - 1]);
    }
    assert.ok(lnPopupRubberBand(Number.MAX_VALUE, Number.MAX_VALUE) > 0);
    assert.equal(lnPopupRubberBand(-10, 800), 0);
    assert.equal(lnPopupRubberBand(100, 0), 0);
    assert.equal(lnPopupRubberBand(Infinity, 800), 0);
  });
});
