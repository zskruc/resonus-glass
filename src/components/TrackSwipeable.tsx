/**
 * Song rows always return after their action; they never need Swipeable's
 * persistent open state, tap-to-close gesture, or two measured action trees.
 * One pan moves the existing row. Only its current action exists while moving.
 */
import { cloneElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { cancelAnimation, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, type AnimatedProps } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { TRACK_SWIPE_INTENT, trackSwipeOffset, trackSwipeRelease, type TrackSwipeDirection } from '@/lib/trackSwipe';

type Direction = Exclude<TrackSwipeDirection, 0>;
interface Props {
  rowIdentity: string;
  children: ReactElement<Pick<AnimatedProps<ViewProps>, 'style'>>;
  allowRight: boolean;
  allowLeft: boolean;
  actionWidth: number;
  renderAction(direction: Direction): ReactNode;
  onSwipe(direction: Direction): void;
}

export function TrackSwipeable({ rowIdentity, children, allowRight, allowLeft, actionWidth, renderAction, onSwipe }: Props) {
  const sequence = useRef(0);
  // A new object and serial for every binding, including A -> B -> A. This
  // local counter never drives rendering; it identifies queued UI callbacks.
  // eslint-disable-next-line react-hooks/refs -- Recycling requires a unique serial per memoized binding, before native handlers are committed.
  const binding = useMemo(() => ({ rowIdentity, generation: ++sequence.current }), [rowIdentity]);
  const generation = binding.generation;
  const translation = useSharedValue(0);
  const direction = useSharedValue<TrackSwipeDirection>(0);
  const epoch = useSharedValue(0);
  const owner = useSharedValue(generation);
  const gestureOwner = useSharedValue(0);
  const active = useSharedValue(false);
  const [panel, setPanel] = useState<{ binding: object; side: TrackSwipeDirection } | null>(null);
  const mounted = useRef(true);
  const currentBinding = useRef<object | null>(null);
  const latest = useRef({ epoch: 0, closed: false });
  const committed = useRef(0);
  const onSwipeRef = useRef(onSwipe);
  useLayoutEffect(() => { onSwipeRef.current = onSwipe; }, [onSwipe]);
  useLayoutEffect(() => {
    currentBinding.current = binding;
    latest.current = { epoch: 0, closed: false };
    committed.current = 0;
    scheduleOnUI(() => {
      'worklet';
      owner.set(generation);
      gestureOwner.set(0);
      active.set(false);
      epoch.set(epoch.get() + 1);
      cancelAnimation(translation);
      translation.set(0);
      direction.set(0);
    });
    return () => { currentBinding.current = null; };
  }, [active, binding, direction, epoch, generation, gestureOwner, owner, translation]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // These are gesture-boundary notifications, never per-frame updates. A late
  // spring completion from a previous gesture cannot remove a new action.
  const showPanel = useCallback((side: TrackSwipeDirection, token: number) => {
    if (!mounted.current || currentBinding.current !== binding || token < latest.current.epoch
      || (token === latest.current.epoch && latest.current.closed)) return;
    latest.current = { epoch: token, closed: false };
    setPanel({ binding, side });
  }, [binding]);
  const clearPanel = useCallback((token: number) => {
    if (!mounted.current || currentBinding.current !== binding || token < latest.current.epoch) return;
    latest.current = { epoch: token, closed: true };
    setPanel(null);
  }, [binding]);
  const commit = useCallback((side: Direction, token: number) => {
    if (!mounted.current || currentBinding.current !== binding || token <= committed.current) return;
    committed.current = token;
    onSwipeRef.current(side);
  }, [binding]);

  const returnToRest = useCallback((velocity: number) => {
    'worklet';
    const token = epoch.get();
    direction.set(0);
    translation.set(withSpring(0, {
      mass: 1,
      damping: 42,
      stiffness: 650,
      velocity,
      overshootClamping: true,
      energyThreshold: 0.001,
      reduceMotion: ReduceMotion.System,
    }, (finished) => {
      if (finished && owner.get() === generation && epoch.get() === token) scheduleOnRN(clearPanel, token);
    }));
  }, [clearPanel, direction, epoch, generation, owner, translation]);

  const pan = useMemo(() => Gesture.Pan()
    .enabled(allowRight || allowLeft)
    .activeOffsetX(allowRight && allowLeft ? [-TRACK_SWIPE_INTENT, TRACK_SWIPE_INTENT]
      : allowRight ? TRACK_SWIPE_INTENT : -TRACK_SWIPE_INTENT)
    // Yield promptly to the parent vertical list before horizontal intent.
    .failOffsetY([-20, 20])
    // Native events for an unchanged view tag can be delivered to its newest
    // React callbacks. Capture ownership at touch-down, before activation,
    // rather than trusting whichever callback receives the eventual onEnd.
    .onBegin(() => {
      if (owner.get() !== generation) return;
      gestureOwner.set(generation);
      active.set(false);
    })
    // eslint-disable-next-line react-hooks/refs -- RNGH stores this callback and invokes it after native gesture activation.
    .onStart((event) => {
      if (owner.get() !== generation || gestureOwner.get() !== generation) return;
      active.set(true);
      cancelAnimation(translation);
      epoch.set(epoch.get() + 1);
      const offset = trackSwipeOffset(event.translationX, actionWidth, allowRight, allowLeft);
      const side = Math.sign(offset) as TrackSwipeDirection;
      translation.set(offset);
      direction.set(side);
      scheduleOnRN(showPanel, side, epoch.get());
    })
    // eslint-disable-next-line react-hooks/refs -- The side-change notification runs only during an active native pan.
    .onUpdate((event) => {
      if (!active.get() || owner.get() !== generation || gestureOwner.get() !== generation) return;
      const offset = trackSwipeOffset(event.translationX, actionWidth, allowRight, allowLeft);
      translation.set(offset);
      const side = Math.sign(offset) as TrackSwipeDirection;
      if (side !== direction.get()) {
        direction.set(side);
        scheduleOnRN(showPanel, side, epoch.get());
      }
    })
    // eslint-disable-next-line react-hooks/refs -- The RN dispatcher reads callback refs only after a gesture has ended.
    .onEnd((event, success) => {
      if (!active.get() || owner.get() !== generation || gestureOwner.get() !== generation) return;
      active.set(false);
      const side = success ? trackSwipeRelease(event.translationX, event.velocityX, allowRight, allowLeft) : 0;
      returnToRest(event.velocityX);
      if (side !== 0) scheduleOnRN(commit, side, epoch.get());
    })
    // eslint-disable-next-line react-hooks/refs -- The delayed panel cleanup cannot execute during render.
    .onFinalize((_event, success) => {
      if (owner.get() !== generation || gestureOwner.get() !== generation) return;
      if (!success && active.get()) returnToRest(0);
      active.set(false);
      gestureOwner.set(0);
    }), [actionWidth, active, allowLeft, allowRight, commit, direction, epoch, generation, gestureOwner, owner, returnToRest, showPanel, translation]);
  const offsetStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: owner.get() === generation ? translation.get() : 0 }],
  }));
  const panelSide = panel?.binding === binding ? panel.side : 0;

  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <View style={styles.clip}>
        {panelSide !== 0 ? (
          <View pointerEvents="none" style={[styles.action, { width: actionWidth }, panelSide > 0 ? styles.left : styles.right]}>
            {renderAction(panelSide)}
          </View>
        ) : null}
        {/* Reuse the existing animated Pressable instead of adding another
            animated native view and style owner for every row. */}
        {cloneElement(children, { style: [children.props.style, offsetStyle] })}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  action: { position: 'absolute', top: 0, bottom: 0 },
  left: { left: 0 },
  right: { right: 0 },
});
