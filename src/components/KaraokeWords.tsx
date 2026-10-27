/**
 * Primuse-style word lyrics for React Native.
 *
 * The motion design is adapted from Primuse's MIT-licensed KaraokeLineView
 * (Copyright (c) 2026 Welape): a soft word-internal sweep, a small bottom-
 * anchored bounce, and layout-stable word wrapping. See THIRD_PARTY_NOTICES.md.
 */
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { LyricWord } from '@/api/subsonic';
import { lyricClockPlan } from '@/lib/lyricLifecycle';
import {
  lyricWordDurationMs,
  MIN_WORD_TRANSITION_MS,
  WORD_BOUNCE_SCALE,
  WORD_SWEEP_EDGE_FRACTION,
  WORD_SWEEP_LEAD_MS,
} from '@/lib/lyricMotion';
import { usePlayerStore } from '@/store/player';
import { motion } from '@/theme/motion';

interface KaraokeWordsProps {
  words: LyricWord[];
  /** The current lyric line; independent of whether this retained view is visible. */
  highlighted: boolean;
  /** Prepare only the next row after the current line's motion has settled. */
  warm?: boolean;
  /** Freeze the rendered words in place while the page exits or is hidden. */
  active?: boolean;
  centered: boolean;
  textStyle: StyleProp<TextStyle>;
  activeColor: string;
  inactiveColor: string;
  paddingVertical: number;
}

/**
 * Uses the same word-flow layout in active and inactive rows. Switching the
 * active line therefore never changes wrapping or measured row height.
 */
export const KaraokeWords = memo(function KaraokeWords({
  words,
  highlighted,
  warm = false,
  active = true,
  centered,
  textStyle,
  activeColor,
  inactiveColor,
  paddingVertical,
}: KaraokeWordsProps) {
  const preparation = useMemo(() => ({ words, warm }), [words, warm]);
  const currentPreparation = useRef<object | null>(preparation);
  const [prepared, setPrepared] = useState<object | null>(null);
  useLayoutEffect(() => {
    currentPreparation.current = preparation;
    return () => { currentPreparation.current = null; };
  }, [preparation]);
  useEffect(() => {
    if (!active || !warm || highlighted) return;
    // Native MaskedView allocates its text bitmap at first attachment. Move
    // the next row's allocation away from takeover/scroll/blur, with only one
    // future row retained. A short line safely keeps the existing cold path.
    const timer = setTimeout(() => {
      if (currentPreparation.current === preparation) setPrepared(preparation);
    }, motion.duration.depth);
    return () => clearTimeout(timer);
  }, [active, warm, highlighted, preparation]);
  const label = words.map((word) => word.value).join('');
  const content = highlighted || (warm && prepared === preparation) ? (
    <ActiveWordFlow
      words={words}
      active={active}
      highlighted={highlighted}
      textStyle={textStyle}
      activeColor={activeColor}
      inactiveColor={inactiveColor}
    />
  ) : (
    words.map((word, index) => (
      <Text key={index} accessible={false} style={[textStyle, { color: activeColor }]}>
        {word.value}
      </Text>
    ))
  );

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.flow,
        centered && styles.flowCentered,
        { paddingVertical },
      ]}
    >
      {content}
    </View>
  );
});

function ActiveWordFlow({
  words,
  active = true,
  highlighted,
  textStyle,
  activeColor,
  inactiveColor,
}: Omit<KaraokeWordsProps, 'centered' | 'paddingVertical' | 'warm'>) {
  const positionSec = usePlayerStore((s) => active && highlighted ? s.positionSec : 0);
  const isPlaying = usePlayerStore((s) => active && highlighted && s.isPlaying);
  const speed = usePlayerStore((s) => active && highlighted ? s.speed : 1);
  const reduceMotion = useReducedMotion();
  const clockMs = useSharedValue(positionSec * 1000);
  const bounceEnabled = useSharedValue(isPlaying && !reduceMotion);

  useLayoutEffect(() => {
    cancelAnimation(clockMs);
    const plan = lyricClockPlan(positionSec, isPlaying, speed, active && highlighted);
    // Cancel before the first exiting frame without changing the sweep or bounce pose.
    if (!plan) return;
    bounceEnabled.value = isPlaying && !reduceMotion;
    clockMs.value = plan.startMs;
    if (plan.durationMs > 0) {
      clockMs.value = withTiming(plan.targetMs, {
        duration: plan.durationMs,
        easing: Easing.linear,
        // Highlight progress carries timing information and must not jump even
        // when decorative motion is disabled at the system level.
        reduceMotion: ReduceMotion.Never,
      });
    }
    return () => cancelAnimation(clockMs);
  }, [clockMs, bounceEnabled, isPlaying, positionSec, speed, active, highlighted, reduceMotion]);

  return words.map((word, index) => (
    <TimedWord
      key={index}
      word={word}
      durationMs={lyricWordDurationMs(words, index)}
      clockMs={clockMs}
      animateBounce={bounceEnabled}
      highlighted={highlighted}
      textStyle={textStyle}
      activeColor={activeColor}
      inactiveColor={inactiveColor}
    />
  ));
}

const TimedWord = memo(function TimedWord({
  word,
  durationMs,
  clockMs,
  animateBounce,
  highlighted,
  textStyle,
  activeColor,
  inactiveColor,
}: {
  word: LyricWord;
  durationMs: number;
  clockMs: SharedValue<number>;
  animateBounce: SharedValue<boolean>;
  highlighted: boolean;
  textStyle: StyleProp<TextStyle>;
  activeColor: string;
  inactiveColor: string;
}) {
  const width = useSharedValue(0);
  const height = useSharedValue(0);

  const motionStyle = useAnimatedStyle(() => {
    if (!highlighted || !animateBounce.value) return { transform: [{ scale: 1 }] };
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const raw = Math.max(0, Math.min(1, (clockMs.value - word.start) / duration));
    const scale = 1 + WORD_BOUNCE_SCALE * Math.sin(raw * Math.PI);
    return {
      transform: [
        { translateY: -height.value * (scale - 1) * 0.5 },
        { scale },
      ],
    };
  });

  const solidStyle = useAnimatedStyle(() => {
    if (!highlighted) return { width: width.value };
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const start = word.start - WORD_SWEEP_LEAD_MS;
    const end = word.start + duration;
    const raw = Math.max(0, Math.min(1, (clockMs.value - start) / (end - start)));
    const eased = 1 - (1 - raw) * (1 - raw);
    const edge = width.value * WORD_SWEEP_EDGE_FRACTION;
    return { width: Math.max(0, width.value * eased - edge * 0.5) };
  });

  const edgeStyle = useAnimatedStyle(() => {
    if (!highlighted) return { left: width.value, width: 0 };
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const start = word.start - WORD_SWEEP_LEAD_MS;
    const end = word.start + duration;
    const raw = Math.max(0, Math.min(1, (clockMs.value - start) / (end - start)));
    const eased = 1 - (1 - raw) * (1 - raw);
    const filled = width.value * eased;
    const edge = width.value * WORD_SWEEP_EDGE_FRACTION;
    const left = Math.max(0, filled - edge * 0.5);
    return {
      left,
      width: Math.min(edge, Math.max(0, filled * 2), Math.max(0, width.value - left)),
    };
  });

  return (
    <Animated.View
      style={motionStyle}
      onLayout={(event) => {
        width.set(event.nativeEvent.layout.width);
        height.set(event.nativeEvent.layout.height);
      }}
    >
      <Text accessible={false} style={[textStyle, { color: inactiveColor }]}>
        {word.value}
      </Text>
      <MaskedView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        maskElement={(
          <Text accessible={false} style={textStyle}>
            {word.value}
          </Text>
        )}
      >
        <View style={styles.sweepCanvas}>
          <Animated.View style={[styles.sweepSolid, { backgroundColor: activeColor }, solidStyle]} />
          <Animated.View style={[styles.sweepEdge, edgeStyle]}>
            <LinearGradient
              colors={[activeColor, `${activeColor}00`]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      </MaskedView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  flow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  flowCentered: { justifyContent: 'center' },
  sweepCanvas: { flex: 1 },
  sweepSolid: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  sweepEdge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
