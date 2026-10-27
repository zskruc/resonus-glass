import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Easing, cancelAnimation, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { APPLE_MUSIC_PLAYER_MOTION, appleMusicUnderlayFrame, isAppleMusicTransitionSnapshotValid, resolveAppleMusicPlayerTransition,
  type AppleMusicRect, type AppleMusicTransitionSnapshot } from '@/lib/appleMusicPlayerTransition';
import { miniArtworkMetrics, playerArtworkFlight, playerCanReturnToMini, playerSurfaceOwner, playerUnderlayFrame, playerUnderlayRouteKey, revealOffset } from '@/lib/playerReveal';
import { motion } from '@/theme/motion';
import { isNativePlayerSurfaceClipAvailable, updateNativePlayerSurfaceClip } from '../../modules/liquid-glass';

// SwiftUI smooth(.3, extraBounce: 0) is a separate solver. Reanimated's
// perceptual duration is converted to its 300ms settling duration, critically damped.
const SMOOTH = { duration: APPLE_MUSIC_PLAYER_MOTION.durationMs / 1.5,
  dampingRatio: 1, reduceMotion: motion.reduceMotion.essential };
type Phase = 'idle' | 'preparing' | 'opening' | 'closing' | 'handoff';

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
  const stackProgress = useSharedValue(1);
  const entryAttemptQueued = useSharedValue(false);
  const originRoute = useSharedValue<{ owner: number; key: string | null }>({ owner, key: null });
  const notifyReady = useCallback(() => { if (live.current) setEntryReady(true); }, []);
  useLayoutEffect(() => { focusedUI.set(focused); }, [focused, focusedUI]);

  const effectiveProgress = useDerivedValue(() => entryIsPull.get() && revealOffset.get() >= 0
    ? Math.max(0, Math.min(1, 1 - revealOffset.get() / height)) : progress.get());
  const running = useDerivedValue(() => phase.get() !== 'idle');
  const frame = useDerivedValue(() => {
    const p = phase.get();
    if (p === 'idle' || p === 'preparing') return null;
    return resolveAppleMusicPlayerTransition({ snapshot: snapshot.get(), viewportWidth: width, viewportHeight: height,
      progress: effectiveProgress.get(), dragOffsetY: entryIsPull.get() && revealOffset.get() >= 0 ? 0 : offset.get(),
      deviceCornerRadius: corner.get(), controlsHeight,
      stackProgress: p === 'closing' || p === 'handoff' ? stackProgress.get() : effectiveProgress.get() });
  });
  const surfaceOffset = useDerivedValue(() => {
    if (phase.get() === 'preparing') return height;
    if (frame.get()) return (1 - effectiveProgress.get()) * height + offset.get();
    return revealOffset.get() >= 0 ? revealOffset.get() : offset.get();
  });

  const tryStartEntry = useCallback(function startArtworkEntry() {
    'worklet';
    if (phase.get() !== 'preparing') return;
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
    offset.set(0);
    progress.set(revealing ? 1 : 0);
    phase.set('opening');
    if (!revealing) progress.set(withSpring(1, SMOOTH, (finished) => {
      if (!finished || playerSurfaceOwner.get() !== owner || phase.get() !== 'opening') return;
      phase.set('idle');
      scheduleOnRN(notifyReady);
    }));
  }, [phase, readArtwork, width, height, owner, retries, revealing, offset, progress, snapshot, notifyReady, clipHost, entryAttemptQueued]);

  useLayoutEffect(() => {
    live.current = true;
    if (handlesEntry) scheduleOnUI(() => {
      phase.set('preparing'); retries.set(0);
      entryAttemptQueued.set(true);
      requestAnimationFrame(() => { entryAttemptQueued.set(false); tryStartEntry(); });
    });
    return () => {
      live.current = false;
      scheduleOnUI(() => {
        cancelAnimation(progress);
        cancelAnimation(stackProgress);
        entryAttemptQueued.set(false);
        phase.set('idle');
        if (playerArtworkFlight.get()?.owner === owner) playerArtworkFlight.set(null);
        if (playerUnderlayFrame.get()?.owner === owner) playerUnderlayFrame.set(null);
      });
    };
  // The route's lifetime, not a viewport resize, owns its entry transaction.
  }, [handlesEntry, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  useAnimatedReaction(() => [phase.get(), effectiveProgress.get(), revealOffset.get()] as const, ([p, value, revealed]) => {
    if (p !== 'opening' || !entryIsPull.get() || revealed >= 0 || value < 1 || playerSurfaceOwner.get() !== owner) return;
    phase.set('idle'); entryIsPull.set(false);
    scheduleOnRN(notifyReady);
  });
  useAnimatedReaction(() => [phase.get(), frame.get(), focusedUI.get(), offset.get(), playerUnderlayRouteKey.get(), playerSurfaceOwner.get()] as const,
    ([p, value, isFocused, drag, routeKey, activeOwner]) => {
    if (activeOwner !== owner) return;
    // A child page may publish its own key while covering this retained player.
    // Capture the first nonempty origin for this owner, including one published
    // after our layout effect, rather than following later focused pages.
    const previousOrigin = originRoute.get();
    let origin = previousOrigin;
    if (origin.owner !== owner) origin = { owner, key: null };
    if (!origin.key && isFocused && routeKey) origin = { owner, key: routeKey };
    if (origin !== previousOrigin) originRoute.set(origin);
    playerArtworkFlight.set(isFocused && value && (p === 'opening' || p === 'closing' || p === 'handoff')
      ? { owner, phase: p, frame: value } : null);
    const depth = value?.underlay ?? (p === 'idle' && drag > 0 ? appleMusicUnderlayFrame(1 - drag / height) : null);
    playerUnderlayFrame.set(isFocused && origin.key && depth ? { owner, routeKey: origin.key, ...depth } : null);
  });
  useAnimatedReaction(() => {
    const value = frame.get();
    const rect = value?.background.rect;
    return [clipHost.get(), rect?.x ?? 0, rect?.y ?? 0, rect?.width ?? width, rect?.height ?? height,
      value?.background.cornerRadius ?? 0, phase.get() === 'preparing' ? 0 : value ? effectiveProgress.get() : 1];
  }, (values) => {
    if (values[0] <= 0 || !updateNativePlayerSurfaceClip) return;
    const previous = lastClip.get();
    if (previous.length === values.length && previous.every((value, index) => value === values[index])) return;
    updateNativePlayerSurfaceClip(values[0], values[1], values[2], values[3], values[4], values[5], values[6]);
    lastClip.set(values);
  });

  const beginClose = useCallback((generation: number): boolean => {
    'worklet';
    if (!available || clipHost.get() <= 0 || !playerCanReturnToMini.get() || playerSurfaceOwner.get() !== owner) return false;
    const currentPhase = phase.get();
    if (currentPhase === 'preparing') return false;
    let next = snapshot.get();
    if (currentPhase === 'idle') {
      const mini = miniArtworkMetrics.get();
      const actual = readArtwork?.();
      next = mini && actual ? { ...mini, miniArtwork: mini.restingArtwork ?? mini.miniArtwork,
        playerArtwork: { ...actual, y: actual.y - offset.get() } } : null;
    }
    if (!isAppleMusicTransitionSnapshotValid(next, width, height)) return false;
    const carriedProgress = currentPhase === 'idle' ? 1 : effectiveProgress.get();
    if (currentPhase === 'opening' && carriedProgress > 0) {
      const rest = miniArtworkMetrics.get()?.restingArtwork;
      const painted = frame.get()?.artwork.rect;
      if (rest && painted) {
        // Opening starts at the actual pressed image. Closing must land at
        // idle geometry, even if that press spring has not settled yet.
        // Rebase only the unused full endpoint so a fast reversal is continuous.
        const p = carriedProgress;
        const drag = entryIsPull.get() && revealOffset.get() >= 0 ? 0 : offset.get();
        const end = (value: number, start: number) => (value - start * (1 - p)) / p;
        const rebased = { ...next, miniArtwork: rest, playerArtwork: {
          x: end(painted.x, rest.x), y: end(painted.y - drag, rest.y),
          width: end(painted.width, rest.width), height: end(painted.height, rest.height),
          cornerRadius: Math.max(0, end(painted.cornerRadius ?? 0, rest.cornerRadius ?? 0)),
        } };
        if (isAppleMusicTransitionSnapshotValid(rebased, width, height)) next = rebased;
      }
    }
    const carriedStack = currentPhase === 'idle' ? 1 - Math.min(1, Math.max(0, offset.get() / height))
      : frame.get()?.underlay ? (1 - frame.get()!.underlay.scale) / APPLE_MUSIC_PLAYER_MOTION.windowScaleDrop : carriedProgress;
    cancelAnimation(progress); cancelAnimation(offset); cancelAnimation(revealOffset);
    snapshot.set(next);
    if (entryIsPull.get() && revealOffset.get() >= 0) offset.set(0);
    entryIsPull.set(false); revealOffset.set(-1);
    progress.set(carriedProgress);
    closeGeneration.set(generation);
    stackProgress.set(carriedStack);
    stackProgress.set(withSpring(0, SMOOTH));
    phase.set('closing');
    offset.set(withSpring(0, SMOOTH));
    progress.set(withSpring(0, SMOOTH, (finished) => {
      if (!finished || playerSurfaceOwner.get() !== owner || phase.get() !== 'closing') return;
      phase.set('handoff');
      scheduleOnRN(finish, generation);
    }));
    return true;
  }, [available, width, height, owner, readArtwork, offset, progress, snapshot, phase, entryIsPull, effectiveProgress, finish, closeGeneration, stackProgress, frame, clipHost]);
  const cancelDrag = useCallback(() => {
    'worklet';
    offset.set(withSpring(0, SMOOTH));
  }, [offset]);
  const abandon = useCallback(() => {
    'worklet';
    cancelAnimation(progress);
    cancelAnimation(stackProgress);
    phase.set('idle'); snapshot.set(null); entryIsPull.set(false);
    if (playerArtworkFlight.get()?.owner === owner) playerArtworkFlight.set(null);
    if (playerUnderlayFrame.get()?.owner === owner) playerUnderlayFrame.set(null);
  }, [progress, phase, snapshot, entryIsPull, owner, stackProgress]);
  const viewport = useRef({ width, height });
  const completeInvalidatedFlight = useCallback(() => {
    'worklet';
    if (playerSurfaceOwner.get() !== owner) return;
    const closing = phase.get() === 'closing' || phase.get() === 'handoff';
    const generation = closeGeneration.get();
    abandon();
    offset.set(closing ? height : 0);
    revealOffset.set(-1);
    if (closing) scheduleOnRN(finish, generation);
    else scheduleOnRN(notifyReady);
  }, [owner, phase, closeGeneration, abandon, offset, height, finish, notifyReady]);
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
    if (phase.get() === 'preparing') return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    const value = frame.get();
    return { opacity: value?.fullContentOpacity ?? 1,
      // A missing native ready event must not leave the slide fallback
      // transparent forever. The real backdrop takes over when its host arrives.
      backgroundColor: available && clipHost.get() <= 0 ? '#25252D' : 'transparent',
      transform: [{ translateX: value?.contentTranslateX ?? 0 }, { translateY: value?.contentTranslateY ?? 0 }] };
  });
  const artworkStyle = useAnimatedStyle(() => ({ opacity: frame.get() ? 0 : 1 }));
  const controlsStyle = useAnimatedStyle(() => ({ transform: [{ translateY: frame.get()?.controlsTranslateY ?? 0 }] }));
  const onArtworkLayout = useCallback(() => { if (handlesEntry) scheduleOnUI(tryStartEntry); }, [handlesEntry, tryStartEntry]);
  const onClipHostReady = useCallback((event: { nativeEvent: { hostId: number; cornerRadius?: number } }) => {
    clipHost.set(event.nativeEvent.hostId);
    corner.set(event.nativeEvent.cornerRadius ?? 0);
    if (handlesEntry) scheduleOnUI(() => {
      if (phase.get() !== 'preparing' || entryAttemptQueued.get()) return;
      entryAttemptQueued.set(true);
      requestAnimationFrame(() => { entryAttemptQueued.set(false); tryStartEntry(); });
    });
  }, [clipHost, corner, handlesEntry, tryStartEntry, phase, entryAttemptQueued]);
  return { available, handlesEntry, entryReady, running, surfaceOffset, phase, beginClose, cancelDrag,
    abandon, contentStyle, artworkStyle, controlsStyle, onArtworkLayout, onClipHostReady };
}
