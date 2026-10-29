import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Easing, cancelAnimation, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { LNPOPUP_PLAYER_MOTION, isAppleMusicTransitionSnapshotValid, lnPopupPlayerDrag, resolveLnPopupPlayerTransition, shouldDismissLnPopupPlayer,
  type AppleMusicRect, type AppleMusicTransitionSnapshot } from '@/lib/appleMusicPlayerTransition';
import { miniArtworkMetrics, playerArtworkFlight, playerCanReturnToMini, playerSurfaceOwner, playerUnderlayFrame, playerUnderlayRouteKey, revealOffset } from '@/lib/playerReveal';
import { motion } from '@/theme/motion';
import { isNativePlayerSurfaceClipAvailable, updateNativePlayerSurfaceClip } from '../../modules/liquid-glass';

// LNPopupController uses a .5s UIKit spring (tap 1.0, gesture .87). Reanimated
// duration is perceptual and settles over 1.5x that value; its solver remains
// Android's, while all visible layers use one progress value on the UI thread.
const popupSpring = (gesture = false) => {
  'worklet';
  return { duration: LNPOPUP_PLAYER_MOTION.durationMs / 1.5,
    dampingRatio: gesture ? LNPOPUP_PLAYER_MOTION.gestureDampingRatio : LNPOPUP_PLAYER_MOTION.tapDampingRatio,
    reduceMotion: motion.reduceMotion.essential };
};
type Phase = 'idle' | 'preparing' | 'opening' | 'dragging' | 'cancelling' | 'closing' | 'handoff';
type OpacityAnchor = { progress: number; fullContentOpacity: number; miniContentOpacity: number };

/** Shared artwork flight; routing, header admission and close ownership stay in the parent hook. */
export function useAppleMusicPlayerMotion({ width, height, owner, fromMini, revealing, readArtwork, offset, finish, controlsHeight = 0, focused = true, artworkIdentity }: {
  width: number; height: number; owner: number; fromMini: boolean; revealing: boolean;
  readArtwork?: () => AppleMusicRect | null;
  offset: SharedValue<number>; finish: (generation: number) => void;
  controlsHeight?: number;
  focused?: boolean;
  artworkIdentity?: string;
}) {
  const available = isNativePlayerSurfaceClipAvailable && !!readArtwork && width > 0 && height > 0;
  const handlesEntry = available && fromMini;
  const [entryReady, setEntryReady] = useState(!handlesEntry);
  const live = useRef(true);
  const phase = useSharedValue<Phase>(handlesEntry ? 'preparing' : 'idle');
  const progress = useSharedValue(1);
  const snapshot = useSharedValue<AppleMusicTransitionSnapshot | null>(null);
  const clipHost = useSharedValue(0);
  const corner = useSharedValue(0);
  const retries = useSharedValue(0);
  const lastClip = useSharedValue<number[]>([]);
  const entryIsPull = useSharedValue(revealing);
  const focusedUI = useSharedValue(focused);
  const closeGeneration = useSharedValue(0);
  const entryAttemptQueued = useSharedValue(false);
  const originRoute = useSharedValue<{ owner: number; key: string | null }>({ owner, key: null });
  const retired = useSharedValue(false);
  const direction = useSharedValue<'opening' | 'closing'>('opening');
  const opacityAnchor = useSharedValue<OpacityAnchor | null>(null);
  const dragStartProgress = useSharedValue(1);
  const contentClipHost = useSharedValue(0);
  const lastContentClip = useSharedValue<number[]>([]);
  const animationRevision = useSharedValue(0);
  const artworkAnchor = useSharedValue<{ progress: number; rect: AppleMusicRect } | null>(null);
  const notifyReady = useCallback(() => { if (live.current) setEntryReady(true); }, []);
  useLayoutEffect(() => { focusedUI.set(focused); }, [focused, focusedUI]);

  const effectiveProgress = useDerivedValue(() => entryIsPull.get() && revealOffset.get() >= 0
    ? Math.max(0, Math.min(1, 1 - revealOffset.get() / height)) : progress.get());
  const running = useDerivedValue(() => !retired.get() && phase.get() !== 'idle');
  const frame = useDerivedValue(() => {
    const p = phase.get();
    if (p === 'idle' || p === 'preparing') return null;
    return resolveLnPopupPlayerTransition({ snapshot: snapshot.get(), viewportWidth: width, viewportHeight: height,
      progress: effectiveProgress.get(), dragOffsetY: entryIsPull.get() && revealOffset.get() >= 0 ? 0 : offset.get(),
      deviceCornerRadius: corner.get(), controlsHeight,
      direction: direction.get(), opacityAnchor: opacityAnchor.get(), artworkAnchor: artworkAnchor.get() });
  });
  const surfaceOffset = useDerivedValue(() => {
    if (retired.get()) return height;
    if (phase.get() === 'preparing') return height;
    if (frame.get()) return (1 - effectiveProgress.get()) * height + offset.get();
    return revealOffset.get() >= 0 ? revealOffset.get() : offset.get();
  });

  const tryStartEntry = useCallback(function startArtworkEntry() {
    'worklet';
    if (retired.get() || phase.get() !== 'preparing') return;
    const mini = miniArtworkMetrics.get();
    const artwork = clipHost.get() > 0 ? readArtwork?.() : null;
    const next = mini && artwork ? { ...mini, playerArtwork: artwork } : null;
    if (clipHost.get() <= 0 || playerSurfaceOwner.get() !== owner || !isAppleMusicTransitionSnapshotValid(next, width, height)) {
      if (retries.get() < 3) {
        retries.set(retries.get() + 1);
        if (!entryAttemptQueued.get()) {
          entryAttemptQueued.set(true);
          requestAnimationFrame(() => { entryAttemptQueued.set(false); startArtworkEntry(); });
        }
      } else {
        phase.set('idle');
        if (!revealing) offset.set(withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic),
          reduceMotion: motion.reduceMotion.essential }, (finished) => { if (finished) scheduleOnRN(notifyReady); }));
        else scheduleOnRN(notifyReady);
      }
      return;
    }
    snapshot.set(next);
    direction.set('opening'); opacityAnchor.set(null); artworkAnchor.set(null);
    offset.set(0);
    progress.set(revealing ? 1 : 0);
    phase.set('opening');
    const revision = animationRevision.get() + 1; animationRevision.set(revision);
    if (!revealing) progress.set(withSpring(1, popupSpring(), (finished) => {
      if (!finished || retired.get() || animationRevision.get() !== revision || playerSurfaceOwner.get() !== owner || phase.get() !== 'opening') return;
      phase.set('idle');
      scheduleOnRN(notifyReady);
    }));
  }, [phase, readArtwork, width, height, owner, retries, revealing, offset, progress, snapshot, notifyReady, clipHost, entryAttemptQueued, retired, direction, opacityAnchor, artworkAnchor, animationRevision]);

  useLayoutEffect(() => {
    live.current = true;
    scheduleOnUI(() => {
      retired.set(false);
      if (handlesEntry) {
        phase.set('preparing'); retries.set(0);
        entryAttemptQueued.set(true);
        requestAnimationFrame(() => { entryAttemptQueued.set(false); tryStartEntry(); });
      }
    });
    return () => {
      live.current = false;
      scheduleOnUI(() => {
        // Layout cleanup can reach the UI before passive mapper cleanup or
        // native detach. Keep the old surface hidden through that interval.
        retired.set(true);
        animationRevision.set(animationRevision.get() + 1);
        cancelAnimation(progress);
        entryAttemptQueued.set(false);
        if (playerArtworkFlight.get()?.owner === owner) playerArtworkFlight.set(null);
        if (playerUnderlayFrame.get()?.owner === owner) playerUnderlayFrame.set(null);
      });
    };
  // The route's lifetime, not a viewport resize, owns its entry transaction.
  }, [handlesEntry, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  useAnimatedReaction(() => [phase.get(), effectiveProgress.get(), revealOffset.get()] as const, ([p, value, revealed]) => {
    if (retired.get() || p !== 'opening' || !entryIsPull.get() || revealed >= 0 || value < 1 || playerSurfaceOwner.get() !== owner) return;
    phase.set('idle'); entryIsPull.set(false);
    scheduleOnRN(notifyReady);
  });
  useAnimatedReaction(() => [phase.get(), frame.get(), focusedUI.get(), offset.get(), playerUnderlayRouteKey.get(), playerSurfaceOwner.get(), retired.get()] as const,
    ([p, value, isFocused, drag, routeKey, activeOwner, isRetired]) => {
    if (isRetired || activeOwner !== owner) return;
    // A child page may publish its own key while covering this retained player.
    // Capture the first nonempty origin for this owner, including one published
    // after our layout effect, rather than following later focused pages.
    const previousOrigin = originRoute.get();
    let origin = previousOrigin;
    if (origin.owner !== owner) origin = { owner, key: null };
    if (!origin.key && isFocused && routeKey) origin = { owner, key: routeKey };
    if (origin !== previousOrigin) originRoute.set(origin);
    playerArtworkFlight.set(isFocused && value && (p === 'opening' || p === 'dragging' || p === 'cancelling' || p === 'closing' || p === 'handoff')
      ? { owner, phase: p, frame: value } : null);
    const depth = value?.underlay ?? null;
    playerUnderlayFrame.set(isFocused && origin.key && depth ? { owner, routeKey: origin.key, ...depth } : null);
  });
  useAnimatedReaction(() => {
    const value = frame.get();
    const rect = value?.background.rect;
    return [clipHost.get(), rect?.x ?? 0, rect?.y ?? 0, rect?.width ?? width, rect?.height ?? height,
      value?.background.cornerRadius ?? 0, retired.get() || phase.get() === 'preparing' ? 0 : value?.surfaceOpacity ?? 1];
  }, (values) => {
    if (values[0] <= 0 || !updateNativePlayerSurfaceClip) return;
    const previous = lastClip.get();
    if (previous.length === values.length && previous.every((value, index) => value === values[index])) return;
    updateNativePlayerSurfaceClip(values[0], values[1], values[2], values[3], values[4], values[5], values[6]);
    lastClip.set(values);
  });

  useAnimatedReaction(() => {
    const value = frame.get();
    const rect = value?.background.rect;
    return [contentClipHost.get(), rect?.x ?? 0, rect?.y ?? 0, rect?.width ?? width, rect?.height ?? height,
      value?.background.cornerRadius ?? 0, retired.get() || phase.get() === 'preparing' ? 0 : 1];
  }, (values) => {
    if (values[0] <= 0 || !updateNativePlayerSurfaceClip) return;
    const previous = lastContentClip.get();
    if (previous.length === values.length && previous.every((value, index) => value === values[index])) return;
    updateNativePlayerSurfaceClip(values[0], values[1], values[2], values[3], values[4], values[5], values[6]);
    lastContentClip.set(values);
  });

  const returnSnapshot = useCallback((): AppleMusicTransitionSnapshot | null => {
    'worklet';
    const mini = miniArtworkMetrics.get();
    const actual = readArtwork?.();
    return mini && actual ? { ...mini, miniArtwork: mini.restingArtwork ?? mini.miniArtwork,
      playerArtwork: { ...actual } } : null;
  }, [readArtwork]);
  const retainPaintedAppearance = useCallback(() => {
    'worklet';
    const painted = frame.get();
    opacityAnchor.set(painted ? { progress: effectiveProgress.get(),
      fullContentOpacity: painted.fullContentOpacity, miniContentOpacity: painted.miniContentOpacity } : null);
  }, [frame, opacityAnchor, effectiveProgress]);
  const returnEndpoint = useCallback((next: AppleMusicTransitionSnapshot, p: number) => {
    'worklet';
    const rest = miniArtworkMetrics.get()?.restingArtwork;
    const painted = frame.get()?.artwork.rect;
    if (!rest || !painted) return next;
    // Anchor the currently painted pose while keeping both REAL endpoints.
    // A cancelled reversal must return to the actual full cover, not a virtual
    // endpoint extrapolated from the mini's transient elastic press.
    artworkAnchor.set(p > 0 && p < 1 ? { progress: p, rect: painted } : null);
    return { ...next, miniArtwork: rest };
  }, [frame, artworkAnchor]);

  const beginDrag = useCallback((): boolean => {
    'worklet';
    if (retired.get() || !available || clipHost.get() <= 0 || !playerCanReturnToMini.get() || playerSurfaceOwner.get() !== owner) return false;
    const current = phase.get();
    if (current === 'idle' && offset.get() !== 0) return false;
    if (current !== 'idle' && current !== 'opening' && current !== 'cancelling') return false;
    let next = current === 'idle' ? returnSnapshot() : snapshot.get();
    if (!isAppleMusicTransitionSnapshotValid(next, width, height)) return false;
    const carried = current === 'idle' ? 1 : effectiveProgress.get();
    if (current === 'idle') artworkAnchor.set(null);
    retainPaintedAppearance();
    if (current === 'opening') next = returnEndpoint(next, carried);
    animationRevision.set(animationRevision.get() + 1);
    cancelAnimation(progress); cancelAnimation(offset); cancelAnimation(revealOffset);
    snapshot.set(next); progress.set(carried); dragStartProgress.set(carried);
    offset.set(0); revealOffset.set(-1); entryIsPull.set(false);
    direction.set('closing'); phase.set('dragging');
    return true;
  }, [available, clipHost, owner, phase, returnSnapshot, snapshot, width, height, effectiveProgress,
    retainPaintedAppearance, returnEndpoint, progress, offset, dragStartProgress, entryIsPull, direction, retired, animationRevision, artworkAnchor]);
  const updateDrag = useCallback((translationY: number): boolean => {
    'worklet';
    if (retired.get() || phase.get() !== 'dragging' || playerSurfaceOwner.get() !== owner) return false;
    const travel = Math.max(1, snapshot.get()?.miniPlayer.y ?? height);
    const down = (1 - dragStartProgress.get()) * travel + translationY;
    progress.set(lnPopupPlayerDrag(down, travel).progress);
    return true;
  }, [phase, owner, snapshot, height, dragStartProgress, progress, retired]);
  const shouldDismissDrag = useCallback((translationY: number, velocityY: number): boolean => {
    'worklet';
    const travel = Math.max(1, snapshot.get()?.miniPlayer.y ?? height);
    const down = phase.get() === 'dragging' ? (1 - effectiveProgress.get()) * travel : translationY;
    return shouldDismissLnPopupPlayer(down, velocityY, travel);
  }, [snapshot, height, phase, effectiveProgress]);
  const beginClose = useCallback((generation: number, gesture = false): boolean => {
    'worklet';
    if (retired.get() || !available || clipHost.get() <= 0 || !playerCanReturnToMini.get() || playerSurfaceOwner.get() !== owner) return false;
    const current = phase.get();
    // A slide fallback still entering is owned by the parent offset clock.
    // Let that same slide close it; changing to a full-screen morph would jump.
    if (current === 'idle' && offset.get() !== 0) return false;
    if (current === 'preparing' || current === 'closing' || current === 'handoff') return false;
    let next = current === 'idle' ? returnSnapshot() : snapshot.get();
    if (!isAppleMusicTransitionSnapshotValid(next, width, height)) return false;
    const carried = current === 'idle' ? 1 : effectiveProgress.get();
    if (current === 'idle') artworkAnchor.set(null);
    retainPaintedAppearance();
    if (current === 'opening') next = returnEndpoint(next, carried);
    cancelAnimation(progress); cancelAnimation(offset); cancelAnimation(revealOffset);
    snapshot.set(next);
    if (entryIsPull.get() && revealOffset.get() >= 0) offset.set(0);
    entryIsPull.set(false); revealOffset.set(-1);
    progress.set(carried); closeGeneration.set(generation);
    direction.set('closing'); phase.set('closing');
    const revision = animationRevision.get() + 1; animationRevision.set(revision);
    if (carried <= 0) {
      phase.set('handoff'); scheduleOnRN(finish, generation);
    } else progress.set(withSpring(0, popupSpring(gesture), (finished) => {
      if (!finished || retired.get() || animationRevision.get() !== revision || playerSurfaceOwner.get() !== owner || phase.get() !== 'closing') return;
      phase.set('handoff'); scheduleOnRN(finish, generation);
    }));
    return true;
  }, [available, width, height, owner, returnSnapshot, snapshot, phase, effectiveProgress, retainPaintedAppearance,
    returnEndpoint, progress, offset, entryIsPull, closeGeneration, direction, finish, clipHost, retired, animationRevision, artworkAnchor]);
  const cancelDrag = useCallback(() => {
    'worklet';
    if (retired.get() || playerSurfaceOwner.get() !== owner || phase.get() === 'closing' || phase.get() === 'handoff') return;
    if (phase.get() !== 'dragging' && phase.get() !== 'cancelling') {
      offset.set(withSpring(0, popupSpring(true))); return;
    }
    cancelAnimation(progress); phase.set('cancelling');
    const revision = animationRevision.get() + 1; animationRevision.set(revision);
    progress.set(withSpring(1, popupSpring(true), (finished) => {
      if (!finished || retired.get() || animationRevision.get() !== revision || playerSurfaceOwner.get() !== owner || phase.get() !== 'cancelling') return;
      phase.set('idle');
      // An interrupted entry no longer owns its original completion callback.
      // Returning fully open must also unlock the unchanged player controls.
      scheduleOnRN(notifyReady);
    }));
  }, [offset, retired, owner, phase, progress, animationRevision, notifyReady]);
  useLayoutEffect(() => {
    if (!focused) scheduleOnUI(() => {
      // A child route taking focus must not retain a half-dragged player.
      if (phase.get() === 'dragging' || phase.get() === 'cancelling') cancelDrag();
    });
  }, [focused, phase, cancelDrag]);
  const abandon = useCallback(() => {
    'worklet';
    animationRevision.set(animationRevision.get() + 1);
    cancelAnimation(progress);
    phase.set('idle'); snapshot.set(null); artworkAnchor.set(null); opacityAnchor.set(null); entryIsPull.set(false);
    if (playerArtworkFlight.get()?.owner === owner) playerArtworkFlight.set(null);
    if (playerUnderlayFrame.get()?.owner === owner) playerUnderlayFrame.set(null);
  }, [progress, phase, snapshot, entryIsPull, owner, animationRevision, artworkAnchor, opacityAnchor]);
  const viewport = useRef({ width, height });
  const completeInvalidatedFlight = useCallback(() => {
    'worklet';
    if (retired.get() || playerSurfaceOwner.get() !== owner) return;
    const closing = phase.get() === 'closing' || phase.get() === 'handoff';
    const generation = closeGeneration.get();
    abandon();
    offset.set(closing ? height : 0);
    revealOffset.set(-1);
    if (closing) scheduleOnRN(finish, generation);
    else scheduleOnRN(notifyReady);
  }, [owner, phase, closeGeneration, abandon, offset, height, finish, notifyReady, retired]);
  useLayoutEffect(() => {
    if (viewport.current.width === width && viewport.current.height === height) return;
    viewport.current = { width, height };
    // A rotation invalidates measured endpoints. Complete a close while hidden,
    // or restore an opening to its live full view; no stale portrait flight.
    scheduleOnUI(completeInvalidatedFlight);
  }, [width, height, completeInvalidatedFlight]);
  const previousArtwork = useRef(artworkIdentity);
  useLayoutEffect(() => {
    if (previousArtwork.current === artworkIdentity) return;
    previousArtwork.current = artworkIdentity;
    // External skip during a flight hands over to the new live artwork. It
    // never carries an old image under the new song title for the remaining flight.
    scheduleOnUI(() => { if (phase.get() !== 'idle') completeInvalidatedFlight(); });
  }, [artworkIdentity, phase, completeInvalidatedFlight]);

  const contentStyle = useAnimatedStyle(() => {
    if (retired.get() || phase.get() === 'preparing') return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    const value = frame.get();
    return { opacity: value?.fullContentOpacity ?? 1,
      // A missing native ready event must not leave the slide fallback
      // transparent forever. The real backdrop takes over when its host arrives.
      backgroundColor: available && clipHost.get() <= 0 ? '#25252D' : 'transparent',
      transform: [{ translateX: value?.contentTranslateX ?? 0 }, { translateY: value?.contentTranslateY ?? 0 }] };
  });
  const artworkStyle = useAnimatedStyle(() => ({ opacity: retired.get() || frame.get() ? 0 : 1 }));
  const controlsStyle = useAnimatedStyle(() => ({ transform: [{ translateY: frame.get()?.controlsTranslateY ?? 0 }] }));
  const onArtworkLayout = useCallback(() => { if (handlesEntry) scheduleOnUI(tryStartEntry); }, [handlesEntry, tryStartEntry]);
  const onClipHostReady = useCallback((event: { nativeEvent: { hostId: number; cornerRadius?: number } }) => {
    clipHost.set(event.nativeEvent.hostId);
    corner.set(event.nativeEvent.cornerRadius ?? 0);
    if (handlesEntry) scheduleOnUI(() => {
      if (retired.get() || phase.get() !== 'preparing' || entryAttemptQueued.get()) return;
      entryAttemptQueued.set(true);
      requestAnimationFrame(() => { entryAttemptQueued.set(false); tryStartEntry(); });
    });
  }, [clipHost, corner, handlesEntry, tryStartEntry, phase, entryAttemptQueued, retired]);
  return { available, handlesEntry, entryReady, running, surfaceOffset, phase, beginClose, beginDrag, updateDrag, shouldDismissDrag, cancelDrag,
    abandon, contentStyle, artworkStyle, controlsStyle, onArtworkLayout, onClipHostReady,
    onContentClipHostReady: (event: { nativeEvent: { hostId: number } }) => { contentClipHost.set(event.nativeEvent.hostId); } };
}
