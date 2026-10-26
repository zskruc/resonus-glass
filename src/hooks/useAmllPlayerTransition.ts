import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import {
  amllPlayerDragOffset, amllPlayerExitDuration, beginPlayerClose, commitPlayerClose, completePlayerClose,
  removePlayerTransition, shouldCloseAmllPlayer, type PlayerCloseSession, type PlayerCloseSource,
} from '@/lib/amllPlayerTransition';
import { revealOffset } from '@/lib/playerReveal';
import { isAmllPlayerHeaderTouch, type AmllPlayerHeaderArea } from '@/lib/amllPlayerLayout';
import { motion } from '@/theme/motion';

const RETURN_SPRING = { damping: 20, stiffness: 200, mass: 1, reduceMotion: motion.reduceMotion.essential };

/**
 * Attach rootStyle to the entire opaque player and handleGesture to its safe
 * content view. Only touches beginning in the visible header can dismiss it.
 * Keep lyrics/backdrop mounted while closing: this hook holds the
 * route until the whole surface has left, then commits the original back action.
 */
export function useAmllPlayerTransition({ height, focused, enabled = true, headerArea, headerScrollOffset }: {
  height: number;
  focused: boolean;
  enabled?: boolean;
  headerArea: AmllPlayerHeaderArea;
  headerScrollOffset: SharedValue<number>;
}) {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ reveal?: string }>();
  const [entry] = useState(() => ({ height, revealing: !!params.reveal }));
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

  useLayoutEffect(() => { focusedRef.current = focused; }, [focused]);
  const finish = useCallback((generation: number) => {
    if (!mounted.current || !completePlayerClose(session.current, generation)) return;
    setAllowRemoval(true);
  }, []);
  const requestClose = useCallback((source: PlayerCloseSource = 'button') => {
    if (!mounted.current) return;
    if (!focusedRef.current) {
      // A queued handle release may arrive after another modal took focus.
      // Give the retained player its open position back, not a stuck drag.
      if (session.current.phase === 'open') {
        scheduleOnUI(() => {
          closingUI.set(false);
          dragging.set(false);
          offset.set(withSpring(0, RETURN_SPRING));
        });
      }
      return;
    }
    const generation = beginPlayerClose(session.current, source);
    if (generation === undefined) return;
    setClosing(true);
    scheduleOnUI(() => {
      closingUI.set(true);
      dragging.set(false);
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
  }, [height, offset, closingUI, dragging, finish]);
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
    if (!entry.revealing) offset.set(withTiming(0, {
      duration: motion.duration.move,
      easing: motion.easing.enter,
      reduceMotion: motion.reduceMotion.essential,
    }));
    return () => {
      mounted.current = false;
      removePlayerTransition(lifetime);
      cancelAnimation(offset);
      // Only release a mini pull once this route is actually gone.
      revealOffset.set(-1);
    };
  }, [entry, offset]);

  const handleGesture = useMemo(() => Gesture.Pan()
    .enabled(focused && enabled && !allowRemoval)
    // Native bounds reject lyric/transport starts before the pan competes
    // with their own scrolling, taps and sliders. Landscape needs an L-shaped
    // refinement, and a short screen may already have scrolled its header.
    .hitSlop({ top: -headerArea.top, height: headerArea.bottom - headerArea.top })
    .maxPointers(1)
    .activeOffsetY([-6, 6])
    .failOffsetX([-24, 24])
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || !isAmllPlayerHeaderTouch(headerArea, touch.x, touch.y, headerScrollOffset.get())) manager.fail();
    })
    .onStart(() => {
      if (closingUI.get()) return;
      cancelAnimation(offset);
      const revealed = revealOffset.get();
      dragStart.set(revealed >= 0 ? revealed : offset.get());
      offset.set(dragStart.get());
      revealOffset.set(-1);
      dragging.set(true);
    })
    .onUpdate((event) => {
      if (!dragging.get() || closingUI.get()) return;
      offset.set(dragStart.get() + amllPlayerDragOffset(event.translationY, height));
    })
    // eslint-disable-next-line react-hooks/refs -- RNGH runs this worklet only after a native gesture ends.
    .onEnd((event, success) => {
      if (!dragging.get() || closingUI.get()) return;
      dragging.set(false);
      if (success && shouldCloseAmllPlayer(event.translationY, event.velocityY)) {
        closingUI.set(true);
        scheduleOnRN(requestClose, 'handle');
      } else offset.set(withSpring(0, RETURN_SPRING));
    })
    .onFinalize(() => {
      if (!dragging.get() || closingUI.get()) return;
      dragging.set(false);
      offset.set(withSpring(0, RETURN_SPRING));
    }), [focused, enabled, allowRemoval, height, headerArea, headerScrollOffset, closingUI, dragging, offset, dragStart, requestClose]);
  const rootStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: revealOffset.get() >= 0 ? revealOffset.get() : offset.get() }],
  }));

  return { rootStyle, handleGesture, close, closing };
}
