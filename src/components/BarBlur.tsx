/**
 * The blur behind the navigation bar and the mini player (a switch each, in
 * Settings › Appearance and Settings › Player).
 *
 * Native liquid glass captures the Stack through an ordinary content host.
 * Other platforms retain the `BlurTargetView` used by the Expo blur fallback.
 * Both bars are drawn next to the target, outside its scrolling content.
 *
 * Android 12 is the floor. Below it expo-blur falls back to a flat tint, which
 * is the see-through bar that was tried and reverted (b8bb8b1): a veil tints
 * what is behind it without hiding it.
 */
import { BlurTargetView, BlurView } from 'expo-blur';
import { createRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useSettings } from '@/store/settings';
import { useTheme, useThemeMode } from '@/theme';
import { isLiquidGlassAvailable } from '../../modules/liquid-glass';

export const canBlurBars =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version >= 31);

const target = createRef<View | null>();

/** Whether a bar is see-through, blurring what scrolls under it. */
export function useBarBlur(bar: 'tabs' | 'miniPlayer'): boolean {
  return useSettings((s) => (bar === 'tabs' ? s.blurBars : s.blurMiniPlayer)) && canBlurBars;
}


/** What the bars blur: everything the Stack draws (the root layout's). */
export function BarBlurTarget({ children }: { children: ReactNode }) {
  if (isLiquidGlassAvailable) {
    // The shared native capture owns blur. Keeping Expo's legacy target here
    // would record the same full Stack again on every draw without a consumer.
    return (
      <View ref={target} nativeID="resonus-glass-content" collapsable={false} style={{ flex: 1 }}>
        {children}
      </View>
    );
  }
  return (
    <BlurTargetView ref={target} style={{ flex: 1 }}>
      {children}
    </BlurTargetView>
  );
}

/**
 * `tint` is laid over the blur so the bar keeps a colour of its own and its
 * labels stay legible over a bright cover: the page colour for the navigation
 * bar, the cover's for the mini player.
 */
export function BarBlur({ tint, alpha }: { tint?: string; alpha?: number }) {
  const colors = useTheme();
  const mode = useThemeMode();
  const a = alpha ?? (mode === 'light' ? 0.7 : 0.6);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BlurView
        style={StyleSheet.absoluteFill}
        blurTarget={target}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={60}
        tint={mode === 'light' ? 'light' : 'dark'}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(tint ?? colors.background, a) }]} />
    </View>
  );
}

/**
 * The background of a screen's top bar, which fades in as the header scrolls
 * away: the header's colour, solid.
 *
 * Not blurred. A bar inside a screen can only blur a target of its own around
 * that screen's list, and a screen wrapped in a `BlurTargetView` stops being
 * drawn the moment it starts to leave: going back showed an empty page for a
 * few frames before the fade.
 */
export function TopBarBackground({
  color,
  opacity,
}: {
  color: string;
  opacity: SharedValue<number>;
}) {
  const opacityStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      pointerEvents="none"
      collapsable={false}
      style={[StyleSheet.absoluteFill, { backgroundColor: color }, opacityStyle]}
    />
  );
}

function withAlpha(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  if (n.length !== 6) return hex;
  return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
