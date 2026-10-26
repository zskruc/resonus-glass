/**
 * Original React Native adaptation of AMLL's slim, elastic player bar.
 * The track itself carries progress; no separate thumb covers the artwork tint.
 */
import type { SliderProps } from '@react-native-community/slider';
import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentType } from 'react';
import { I18nManager, StyleSheet, type ColorValue } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import {
  amllSliderClamp, amllSliderElasticOffset, amllSliderProgress, amllSliderRange, amllSliderReversed, amllSliderValueAt,
  beginAmllSliderInteraction, finishAmllSliderInteraction, invalidateAmllSliderInteraction, isCurrentAmllSliderInteraction,
} from '@/lib/amllSlider';
import { motion } from '@/theme/motion';

export type PlayerSliderProps = SliderProps & {
  onSlidingCancel?: () => void;
  activeTrackTintColor?: ColorValue | null;
  /** Changing song/output invalidates a gesture even if its range is unchanged. */
  interactionKey?: string | number;
};
export type PlayerSliderComponent = ComponentType<PlayerSliderProps>;

const TRACK_INSET = 15;
const CHANGE_INTERVAL_MS = 40;
const RELEASE_SPRING = { damping: 12, stiffness: 200, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const BOUNCE_SPRING = { damping: 12, stiffness: 300, mass: 1, reduceMotion: motion.reduceMotion.decorative };

export function AmllSlider({
  style, value = 0, minimumValue = 0, maximumValue = 1, step = 0,
  lowerLimit, upperLimit, inverted = false, disabled = false, interactionKey,
  activeTrackTintColor, minimumTrackTintColor, maximumTrackTintColor,
  onSlidingStart, onValueChange, onSlidingComplete, onSlidingCancel,
  onLayout, onAccessibilityAction, accessibilityActions, accessibilityValue, accessibilityState,
  accessibilityLabel, accessibilityHint, accessible = true, accessibilityElementsHidden,
  importantForAccessibility, testID, nativeID,
}: PlayerSliderProps) {
  const range = useMemo(() => amllSliderRange(minimumValue, maximumValue, step, lowerLimit, upperLimit),
    [minimumValue, maximumValue, step, lowerLimit, upperLimit]);
  const reversed = amllSliderReversed(inverted, I18nManager.isRTL);
  const enabled = !disabled && range.upper > range.lower;
  const callbacks = useRef({ onSlidingStart, onValueChange, onSlidingComplete, onSlidingCancel });
  const session = useRef({ generation: 0, active: false });
  const widthRef = useRef(0);
  const generation = useSharedValue(0);
  const gestureGeneration = useSharedValue(-1);
  const dragging = useSharedValue(false);
  const trackWidth = useSharedValue(0);
  const externalValue = useSharedValue(amllSliderClamp(value, range));
  const localValue = useSharedValue(amllSliderClamp(value, range));
  const progress = useSharedValue(amllSliderProgress(value, range));
  const pressed = useSharedValue(0);
  const bounce = useSharedValue(0);
  const lastEmission = useSharedValue(0);
  const lastEmittedValue = useSharedValue(Number.NaN);

  // Gesture worklets only call these stable dispatchers. Parent time/volume
  // renders replace callbacks without replacing a held gesture or its value.
  useLayoutEffect(() => {
    callbacks.current = { onSlidingStart, onValueChange, onSlidingComplete, onSlidingCancel };
  }, [onSlidingStart, onValueChange, onSlidingComplete, onSlidingCancel]);
  const notifyStart = useCallback((eventGeneration: number, initial: number) => {
    if (!beginAmllSliderInteraction(session.current, eventGeneration)) return;
    callbacks.current.onSlidingStart?.(initial);
  }, []);
  const notifyChange = useCallback((eventGeneration: number, next: number) => {
    if (!isCurrentAmllSliderInteraction(session.current, eventGeneration)) return;
    callbacks.current.onValueChange?.(next);
  }, []);
  const notifyComplete = useCallback((eventGeneration: number, next: number) => {
    if (!finishAmllSliderInteraction(session.current, eventGeneration)) return;
    callbacks.current.onSlidingComplete?.(next);
  }, []);
  const notifyCancel = useCallback((eventGeneration: number) => {
    if (!finishAmllSliderInteraction(session.current, eventGeneration)) return;
    callbacks.current.onSlidingCancel?.();
  }, []);

  // Incoming playback ticks never pull a bar out from under the finger.
  useLayoutEffect(() => {
    const next = amllSliderClamp(value, range);
    scheduleOnUI(() => {
      externalValue.set(next);
      if (!dragging.get()) {
        localValue.set(next);
        progress.set(amllSliderProgress(next, range));
      }
    });
  }, [value, range, externalValue, dragging, localValue, progress]);

  const resetInteraction = useCallback(() => {
    const cancelled = invalidateAmllSliderInteraction(session.current);
    const nextGeneration = session.current.generation;
    if (cancelled) callbacks.current.onSlidingCancel?.();
    scheduleOnUI(() => {
      generation.set(nextGeneration);
      dragging.set(false);
      localValue.set(amllSliderClamp(externalValue.get(), range));
      progress.set(amllSliderProgress(externalValue.get(), range));
      pressed.set(withSpring(0, RELEASE_SPRING));
      bounce.set(withSpring(0, BOUNCE_SPRING));
    });
  }, [generation, dragging, externalValue, localValue, progress, pressed, bounce, range]);
  useLayoutEffect(() => {
    resetInteraction();
  }, [resetInteraction, enabled, reversed, interactionKey]);
  useLayoutEffect(() => () => {
    // Ignore already-queued callbacks after removal or a song/output handoff.
    if (invalidateAmllSliderInteraction(session.current)) callbacks.current.onSlidingCancel?.();
  }, []);

  const hasValueChange = typeof onValueChange === 'function';
  const gesture = useMemo(() => {
    const update = (xInView: number, force: boolean) => {
      'worklet';
      const eventGeneration = gestureGeneration.get();
      if (!dragging.get() || eventGeneration !== generation.get()) return;
      const x = xInView - TRACK_INSET;
      const next = amllSliderValueAt(x, trackWidth.get(), range, reversed);
      localValue.set(next);
      progress.set(amllSliderProgress(next, range));
      bounce.set(amllSliderElasticOffset(x, trackWidth.get()));
      // eslint-disable-next-line react-hooks/purity -- UI gesture event time, never evaluated while rendering.
      const now = Date.now();
      if (hasValueChange && next !== lastEmittedValue.get() && (force || now - lastEmission.get() >= CHANGE_INTERVAL_MS)) {
        lastEmission.set(now);
        lastEmittedValue.set(next);
        scheduleOnRN(notifyChange, eventGeneration, next);
      }
    };
    const pan = Gesture.Pan()
      .enabled(enabled)
      .maxPointers(1)
      .activeOffsetX([-3, 3])
      .failOffsetY([-8, 8])
      // eslint-disable-next-line react-hooks/refs -- RNGH stores this UI-thread event callback; it does not run during render.
      .onStart((event) => {
        if (trackWidth.get() <= 0) return;
        const eventGeneration = generation.get();
        gestureGeneration.set(eventGeneration);
        dragging.set(true);
        lastEmittedValue.set(Number.NaN);
        lastEmission.set(0);
        pressed.set(withTiming(1, { duration: 280, easing: motion.easing.enter, reduceMotion: motion.reduceMotion.decorative }));
        scheduleOnRN(notifyStart, eventGeneration, externalValue.get());
        update(event.x, true);
      })
      // eslint-disable-next-line react-hooks/refs -- The dispatcher reads callback refs only after a native gesture event.
      .onUpdate((event) => update(event.x, false))
      // eslint-disable-next-line react-hooks/refs -- The dispatcher reads callback refs only after a native gesture event.
      .onEnd((event, success) => {
        if (!success || !dragging.get() || gestureGeneration.get() !== generation.get()) return;
        update(event.x, true);
        dragging.set(false);
        pressed.set(withSpring(0, RELEASE_SPRING));
        bounce.set(withSpring(0, BOUNCE_SPRING));
        scheduleOnRN(notifyComplete, gestureGeneration.get(), localValue.get());
      })
      // eslint-disable-next-line react-hooks/refs -- The dispatcher reads callback refs only after a native gesture event.
      .onFinalize(() => {
        if (!dragging.get() || gestureGeneration.get() !== generation.get()) return;
        dragging.set(false);
        progress.set(amllSliderProgress(externalValue.get(), range));
        pressed.set(withSpring(0, RELEASE_SPRING));
        bounce.set(withSpring(0, BOUNCE_SPRING));
        scheduleOnRN(notifyCancel, gestureGeneration.get());
      });
    // Small horizontal travel claims the bar; a vertical pull gives the outer
    // compact-screen ScrollView priority. Stationary taps still seek once.
    const tap = Gesture.Tap().enabled(enabled).maxDuration(10000).maxDeltaX(3).maxDeltaY(8)
      // eslint-disable-next-line react-hooks/refs -- The dispatcher reads callback refs only after a native gesture event.
      .onEnd((event, success) => {
        if (!success || trackWidth.get() <= 0) return;
        const eventGeneration = generation.get();
        gestureGeneration.set(eventGeneration);
        dragging.set(true);
        lastEmittedValue.set(Number.NaN);
        scheduleOnRN(notifyStart, eventGeneration, externalValue.get());
        update(event.x, true);
        dragging.set(false);
        bounce.set(withSpring(0, BOUNCE_SPRING));
        scheduleOnRN(notifyComplete, eventGeneration, localValue.get());
      });
    return Gesture.Exclusive(pan, tap);
  }, [enabled, range, reversed, hasValueChange, generation, gestureGeneration, dragging, trackWidth, externalValue,
    localValue, progress, pressed, bounce, lastEmission, lastEmittedValue, notifyStart, notifyChange, notifyComplete, notifyCancel]);

  const trackStyle = useAnimatedStyle(() => {
    const focus = Math.max(0, Math.min(1, pressed.get()));
    const height = 8 + 12 * focus;
    return { height, borderRadius: height / 2, transform: [{ translateX: bounce.get() }] };
  });
  const fillStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * Math.max(0, Math.min(1, pressed.get())),
    transform: [{ scaleX: progress.get() }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.touchArea, style, !enabled && styles.disabled]}
        testID={testID} nativeID={nativeID}
        accessible={accessible} accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}
        accessibilityElementsHidden={accessibilityElementsHidden} importantForAccessibility={importantForAccessibility}
        accessibilityState={{ ...accessibilityState, disabled: !enabled }}
        accessibilityValue={accessibilityValue ?? { min: range.minimum, max: range.maximum, now: amllSliderClamp(value, range) }}
        accessibilityActions={accessibilityActions ?? [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const direction = event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0;
          if (enabled && direction !== 0) {
            const current = amllSliderClamp(value, range);
            const increment = range.step || (range.maximum - range.minimum) / 20;
            const target = amllSliderClamp(current + increment * direction, range);
            const next = amllSliderValueAt(amllSliderProgress(target, range), 1, range);
            onSlidingStart?.(current);
            scheduleOnUI(() => progress.set(amllSliderProgress(next, range)));
            onValueChange?.(next);
            onSlidingComplete?.(next);
          }
          onAccessibilityAction?.(event);
        }}
        onLayout={(event) => {
          const nextWidth = Math.max(0, event.nativeEvent.layout.width - TRACK_INSET * 2);
          if (nextWidth !== widthRef.current) {
            widthRef.current = nextWidth;
            trackWidth.set(nextWidth);
            resetInteraction();
          }
          onLayout?.(event);
        }}
      >
        <Animated.View pointerEvents="none" style={[styles.track,
          { backgroundColor: maximumTrackTintColor ?? '#FFFFFF26' }, trackStyle]}>
          <Animated.View style={[StyleSheet.absoluteFill,
            { backgroundColor: activeTrackTintColor ?? minimumTrackTintColor ?? '#FFFFFF',
              transformOrigin: reversed ? 'right center' : 'left center' }, fillStyle]} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  touchArea: { height: 44, minHeight: 44, justifyContent: 'center', alignSelf: 'stretch' },
  track: { marginHorizontal: TRACK_INSET, overflow: 'hidden' },
  disabled: { opacity: 0.45 },
});
