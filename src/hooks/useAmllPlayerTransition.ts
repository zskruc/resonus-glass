import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import {
  amllPlayerDragOffset, amllPlayerExitDuration, beginPlayerClose, commitPlayerClose, completePlayerClose,
  removePlayerTransition, shouldCloseAmllPlayer, type PlayerCloseSession, type PlayerCloseSource,
} from '@/lib/amllPlayerTransition';
import { createPlayerSurfaceOwner, playerSurfaceHeight, playerSurfaceOffset, playerSurfaceOwner, revealOffset } from '@/lib/playerReveal';
import { isAmllPlayerHeaderTouch, type AmllPlayerHeaderArea } from '@/lib/amllPlayerLayout';
import { motion } from '@/theme/motion';
import { useAppleMusicPlayerMotion } from './useAppleMusicPlayerMotion';
import type { AppleMusicRect } from '@/lib/appleMusicPlayerTransition';

const RETURN_SPRING = { damping: 20, stiffness: 200, mass: 1, reduceMotion: motion.reduceMotion.essential };

/**
 * Attach rootStyle to the entire opaque player and handleGesture to its safe
 * content view. Cover mode accepts touches above the playback controls;
 * lyric mode keeps its information header separate from lyric scrolling.
 * Keep lyrics/backdrop mounted while closing: this hook holds the
 * route until the whole surface has left, then commits the original back action.
 */
export function useAmllPlayerTransition({ width = 0, height, focused, enabled = true, headerArea, headerScrollOffset, readArtwork, controlsHeight = 0, artworkIdentity }: {
  width?: number;
  height: number;
  focused: boolean;
  enabled?: boolean;
  headerArea: AmllPlayerHeaderArea;
  headerScrollOffset: SharedValue<number>;
  readArtwork?: () => AppleMusicRect | null;
  controlsHeight?: number;
  artworkIdentity?: string;
}) {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ reveal?: string; artwork?: string }>();
  const [entry] = useState(() => ({ height, revealing: !!params.reveal, fromMini: params.artwork === '1' }));
  const [surfaceOwner] = useState(createPlayerSurfaceOwner);
  const [allowRemoval, setAllowRemoval] = useState(false);
  const [closing, setClosing] = useState(false);
  const session = useRef<PlayerCloseSession>({ generation: 0, phase: 'open' });
  const pendingAction = useRef<NavigationAction | null>(null);
  const focusedRef = useRef(focused);
  const mounted = useRef(true);
  const offset = useSharedValue(entry.revealing ? 0 : entry.height);
  const dragStart = useSharedValue(0);
  const dragging = useSharedValue(false);
  const closingUI = useSharedValue(false);
  const finish = useCallback((generation: number) => {
    if (!mounted.current || !completePlayerClose(session.current, generation)) return;
    setAllowRemoval(true);
  }, []);
  const apple = useAppleMusicPlayerMotion({ width, height, owner: surfaceOwner,
    fromMini: entry.fromMini, revealing: entry.revealing, readArtwork, offset, finish, controlsHeight, focused, artworkIdentity });
  const { running: artworkRunning, surfaceOffset: artworkSurfaceOffset,
    beginClose: beginArtworkClose, cancelDrag: cancelArtworkDrag, available: artworkAvailable,
    phase: artworkPhase, beginDrag: beginArtworkDrag, updateDrag: updateArtworkDrag,
    shouldDismissDrag: shouldDismissArtworkDrag, abandon: abandonArtwork } = apple;

  useLayoutEffect(() => {
    scheduleOnUI(() => {
      playerSurfaceOwner.set(surfaceOwner);
      playerSurfaceHeight.set(entry.height);
      playerSurfaceOffset.set(artworkSurfaceOffset.get());
    });
    return () => {
      scheduleOnUI(() => {
        if (playerSurfaceOwner.get() !== surfaceOwner) return;
        playerSurfaceOwner.set(0);
        // Keep a completed exit at its endpoint through route-pop handoff.
        // The next player owns its own value; an old cleanup cannot hide it.
        if (playerSurfaceOffset.get() < playerSurfaceHeight.get() - 1) playerSurfaceOffset.set(-1);
        revealOffset.set(-1);
      });
    };
  }, [surfaceOwner, entry, offset, artworkSurfaceOffset]);
  useLayoutEffect(() => {
    scheduleOnUI(() => {
      if (playerSurfaceOwner.get() === surfaceOwner) playerSurfaceHeight.set(height);
    });
  }, [surfaceOwner, height]);
  useAnimatedReaction(
    () => artworkSurfaceOffset.get(),
    (position) => {
      if (playerSurfaceOwner.get() !== surfaceOwner) return;
      playerSurfaceHeight.set(height);
      playerSurfaceOffset.set(position);
    },
    [surfaceOwner, height, artworkSurfaceOffset],
  );

  useLayoutEffect(() => { focusedRef.current = focused; }, [focused]);
  const requestClose = useCallback((source: PlayerCloseSource = 'button') => {
    if (!mounted.current) return;
    if (!focusedRef.current) {
      // A queued handle release may arrive after another modal took focus.
      // Give the retained player its open position back, not a stuck drag.
      if (session.current.phase === 'open') {
        scheduleOnUI(() => {
          closingUI.set(false);
          dragging.set(false);
          cancelArtworkDrag();
          offset.set(withSpring(0, RETURN_SPRING));
        });
      }
      return;
    }
    const generation = beginPlayerClose(session.current, source);
    if (generation === undefined) return;
    setClosing(true);
    scheduleOnUI(() => {
      if (playerSurfaceOwner.get() !== surfaceOwner) return;
      closingUI.set(true);
      dragging.set(false);
      if (beginArtworkClose(generation, source === 'handle')) return;
      abandonArtwork();
      // A mini-player pull may still own the root's position. Transfer it
      // without briefly falling back to the fully-open local offset.
      const revealed = revealOffset.get();
      const start = revealed >= 0 ? revealed : offset.get();
      cancelAnimation(revealOffset);
      cancelAnimation(offset);
      offset.set(start);
      revealOffset.set(-1);
      offset.set(withTiming(height, {
        duration: amllPlayerExitDuration(start, height),
        easing: motion.easing.move,
        reduceMotion: motion.reduceMotion.essential,
      }, (finished) => {
        if (finished) scheduleOnRN(finish, generation);
      }));
    });
  }, [height, offset, closingUI, dragging, finish, surfaceOwner, beginArtworkClose, abandonArtwork, cancelArtworkDrag]);
  const close = useCallback(() => requestClose('button'), [requestClose]);

  // Native-stack removal must be prevented through its supported hook; a raw
  // beforeRemove listener alone can let Android detach the modal too early.
  usePreventRemove(focused && !allowRemoval, ({ data }) => {
    pendingAction.current ??= data.action;
    requestClose('navigation');
  });
  useEffect(() => {
    if (!allowRemoval || !commitPlayerClose(session.current)) return;
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) navigation.dispatch(action);
    // Route-scoped back preserves the player that initiated this animation,
    // even if another screen was pushed above it while the surface was leaving.
    else if (navigation.canGoBack()) navigation.goBack();
    else router.replace('/(tabs)');
  }, [allowRemoval, navigation, router]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!focusedRef.current) return false;
      requestClose('back');
      return true;
    });
    return () => subscription.remove();
  }, [requestClose]));

  useLayoutEffect(() => {
    mounted.current = true;
    // Development StrictMode replays this layout effect's cleanup/setup. Give
    // the new lifetime a distinct generation rather than reviving old callbacks.
    if (session.current.phase === 'removed') session.current = { generation: session.current.generation + 1, phase: 'open' };
    const lifetime = session.current;
    if (!entry.revealing && !apple.handlesEntry) offset.set(withTiming(0, {
      duration: motion.duration.move,
      easing: motion.easing.enter,
      reduceMotion: motion.reduceMotion.essential,
    }));
    return () => {
      mounted.current = false;
      removePlayerTransition(lifetime);
      cancelAnimation(offset);
    };
  }, [entry, offset, apple.handlesEntry]);

  const handleGesture = useMemo(() => Gesture.Pan()
    .enabled(focused && enabled && !allowRemoval)
    // Cover/metadata dragging stops at the top of the playback block, keeping
    // seeking, volume and transport input independent. Lyrics retain their own
    // header bounds; a short screen may have scrolled the column already.
    .hitSlop({ top: -headerArea.top, height: headerArea.bottom - headerArea.top })
    .maxPointers(1)
    // Only a downward movement can take ownership. An upward cover swipe must
    // still scroll a short/accessibility layout to its playback controls.
    .activeOffsetY(6)
    .failOffsetX([-24, 24])
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      const phase = artworkPhase.get();
      if ((phase !== 'idle' && phase !== 'opening' && phase !== 'cancelling') || !touch || !isAmllPlayerHeaderTouch(headerArea, touch.x, touch.y, headerScrollOffset.get())) manager.fail();
    })
    .onStart(() => {
      if (closingUI.get() || playerSurfaceOwner.get() !== surfaceOwner) return;
      if (beginArtworkDrag()) { dragging.set(true); return; }
      cancelAnimation(offset);
      const revealed = revealOffset.get();
      dragStart.set(revealed >= 0 ? revealed : offset.get());
      offset.set(dragStart.get());
      revealOffset.set(-1);
      dragging.set(true);
    })
    .onUpdate((event) => {
      if (!dragging.get() || closingUI.get()) return;
      if (!updateArtworkDrag(event.translationY)) offset.set(dragStart.get() + amllPlayerDragOffset(event.translationY, height));
    })
    // eslint-disable-next-line react-hooks/refs -- RNGH runs this worklet only after a native gesture ends.
    .onEnd((event, success) => {
      if (!dragging.get() || closingUI.get()) return;
      dragging.set(false);
      if (success && (artworkPhase.get() === 'dragging' ? shouldDismissArtworkDrag(event.translationY, event.velocityY)
        : shouldCloseAmllPlayer(event.translationY, event.velocityY))) {
        closingUI.set(true);
        scheduleOnRN(requestClose, 'handle');
      } else if (artworkAvailable) cancelArtworkDrag();
      else offset.set(withSpring(0, RETURN_SPRING));
    })
    .onFinalize(() => {
      if (!dragging.get() || closingUI.get()) return;
      dragging.set(false);
      if (artworkAvailable) cancelArtworkDrag();
      else offset.set(withSpring(0, RETURN_SPRING));
    }), [focused, enabled, allowRemoval, height, headerArea, headerScrollOffset, closingUI, dragging, offset, dragStart, requestClose, surfaceOwner, artworkPhase, artworkAvailable, cancelArtworkDrag, beginArtworkDrag, updateArtworkDrag, shouldDismissArtworkDrag]);
  const rootStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: artworkRunning.get() ? 0 : revealOffset.get() >= 0 ? revealOffset.get() : offset.get() }],
  }));

  return { rootStyle, handleGesture, close, closing, entryReady: apple.entryReady,
    contentStyle: apple.contentStyle, artworkStyle: apple.artworkStyle,
    controlsMotionStyle: apple.controlsStyle,
    onArtworkLayout: apple.onArtworkLayout, onClipHostReady: apple.onClipHostReady,
    onContentClipHostReady: apple.onContentClipHostReady };
}
