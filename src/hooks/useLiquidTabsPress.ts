import { useCallback } from 'react';
import { useAnimatedReaction, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import { liquidTabsPressedScales, shouldReleaseLiquidTabsPress } from '@/lib/liquidTabsMotion';
import { motion } from '@/theme/motion';

const PRESS_SPRING = { damping: 63.25, stiffness: 1000, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const SCALE_X_SPRING = { damping: 18.97, stiffness: 250, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const SCALE_Y_SPRING = { damping: 22.14, stiffness: 250, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const RELEASE_SPRING = { damping: 34.64, stiffness: 300, mass: 1, reduceMotion: motion.reduceMotion.decorative };

/** A finite source press → travel → release, wholly on the animation runtime. */
export function useLiquidTabsPress({ count, amPlus, reduceMotion, pressProgress, scaleX, scaleY, dragVelocity,
  panelOffset, selectionPosition, selectionDestination, dragging }: {
  count: number; amPlus: boolean; reduceMotion: boolean;
  pressProgress: SharedValue<number>; scaleX: SharedValue<number>; scaleY: SharedValue<number>;
  dragVelocity: SharedValue<number>; panelOffset: SharedValue<number>;
  selectionPosition: SharedValue<number>; selectionDestination: SharedValue<number>; dragging: SharedValue<boolean>;
}) {
  const releasePending = useSharedValue(false);
  const releaseFrameReady = useSharedValue(0);
  const press = useCallback((deform = true) => {
    'worklet';
    releasePending.set(false);
    releaseFrameReady.set(0);
    if (reduceMotion) return;
    pressProgress.set(withSpring(1, PRESS_SPRING));
    if (deform) {
      const [horizontal, vertical] = liquidTabsPressedScales(count, amPlus);
      scaleX.set(withSpring(horizontal, SCALE_X_SPRING));
      scaleY.set(withSpring(vertical, SCALE_Y_SPRING));
    }
  }, [releasePending, releaseFrameReady, reduceMotion, pressProgress, count, amPlus, scaleX, scaleY]);
  const release = useCallback(() => {
    'worklet';
    if (reduceMotion) {
      releasePending.set(false);
      releaseFrameReady.set(0);
      pressProgress.set(0);
      scaleX.set(1);
      scaleY.set(1);
    } else {
      releasePending.set(true);
      // A timing animation's first update occurs on the next display frame,
      // matching awaitFrame without a fixed timeout or permanent frame callback.
      releaseFrameReady.set(0);
      releaseFrameReady.set(withTiming(1, { duration: 1 }));
    }
    dragVelocity.set(reduceMotion ? 0 : withSpring(0, RELEASE_SPRING));
    panelOffset.set(reduceMotion ? 0 : withSpring(0, RELEASE_SPRING));
  }, [reduceMotion, releasePending, releaseFrameReady, pressProgress, scaleX, scaleY, dragVelocity, panelOffset]);
  useAnimatedReaction(() => shouldReleaseLiquidTabsPress(releasePending.get(), releaseFrameReady.get(),
    dragging.get(), selectionPosition.get(), selectionDestination.get(), count), (ready) => {
    if (!ready) return;
    releasePending.set(false);
    releaseFrameReady.set(0);
    pressProgress.set(withSpring(0, PRESS_SPRING));
    scaleX.set(withSpring(1, SCALE_X_SPRING));
    scaleY.set(withSpring(1, SCALE_Y_SPRING));
  });
  return { press, release, releasePending, releaseFrameReady };
}
