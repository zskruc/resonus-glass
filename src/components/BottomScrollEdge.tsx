import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useLayoutEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useBarBlur } from '@/components/BarBlur';
import { COMPACT_DOCK_SIZE, useLiquidDock } from '@/hooks/useLiquidDock';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useMiniPlayerShown, useTabBarShown } from '@/hooks/useTabBar';
import { MINI_PLAYER_HEIGHT, TAB_BAR_BOTTOM_GAP, TAB_BAR_HEIGHT, useTheme, useThemeMode } from '@/theme';
import { motion } from '@/theme/motion';
import { isLiquidGlassAvailable, LiquidGlassView, updateNativeDockProgress } from '../../modules/liquid-glass';

const EDGE_TRANSITION_HEIGHT = 40;

function alpha(hex: string, opacity: number): string {
  const rgb = hex.replace('#', '');
  return `rgba(${parseInt(rgb.slice(0, 2), 16)},${parseInt(rgb.slice(2, 4), 16)},${parseInt(rgb.slice(4, 6), 16)},${opacity})`;
}

/** Soften scrolling content outside the floating controls, below their layer. */
export function BottomScrollEdge() {
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const insets = useSafeAreaInsets();
  const { width } = useScreenSize();
  const bar = useTabBarShown();
  const mini = useMiniPlayerShown();
  const blurTabs = useBarBlur('tabs');
  const blurMini = useBarBlur('miniPlayer');
  const { progress, uiEnabled, enabled } = useLiquidDock();
  const shown = bar || mini;
  // With tabs, the expanded edge starts at their top, leaving the mini and
  // its surrounding page on the same raw background. Keep mini-only screens.
  const expandedHeight = bar
    ? insets.bottom + TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP
    : insets.bottom + EDGE_TRANSITION_HEIGHT + 8 + (mini ? MINI_PLAYER_HEIGHT : 0);
  const compactHeight = enabled
    ? insets.bottom + TAB_BAR_BOTTOM_GAP + COMPACT_DOCK_SIZE + EDGE_TRANSITION_HEIGHT
    : expandedHeight;
  const blurred = (bar && blurTabs) || (mini && blurMini);

  // The provider resets its animation when a full-screen player opens. Keep
  // this outgoing edge in its last position, just like the controls above it.
  const [lastGeometry, setLastGeometry] = useState({ expandedHeight, compactHeight, width, blurred });
  if (shown && (lastGeometry.expandedHeight !== expandedHeight || lastGeometry.compactHeight !== compactHeight
    || lastGeometry.width !== width || lastGeometry.blurred !== blurred)) {
    setLastGeometry({ expandedHeight, compactHeight, width, blurred });
  }
  const geometry = shown ? { expandedHeight, compactHeight, width, blurred } : lastGeometry;
  // The compact edge is now taller than the expanded one. Reserve both
  // endpoints without resizing the RN host during the existing dock spring.
  const hostHeight = Math.max(geometry.expandedHeight, geometry.compactHeight);
  const uiShown = useSharedValue(shown);
  useLayoutEffect(() => { uiShown.set(shown); }, [shown, uiShown]);
  const frozenProgress = useSharedValue(0);
  useAnimatedReaction(
    () => uiShown.get() ? (uiEnabled.get() ? progress.get() : 0) : null,
    (value) => { if (value !== null) frozenProgress.set(value); },
  );
  const visualProgress = useDerivedValue(() => uiShown.get()
    ? (uiEnabled.get() ? progress.get() : 0) : frozenProgress.get());

  // A hidden edge must release its shared backdrop consumer after fading out.
  const [materialOn, setMaterialOn] = useState(shown);
  if (shown && !materialOn) setMaterialOn(true);
  const opacity = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    opacity.set(shown ? 1 : withTiming(0, {
      duration: motion.duration.exit,
      reduceMotion: motion.reduceMotion.decorative,
    }, (finished) => { if (finished) scheduleOnRN(setMaterialOn, false); }));
  }, [shown, opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const useNativeMaterial = isLiquidGlassAvailable && geometry.blurred && materialOn;
  const nativeHost = useSharedValue(0);
  const motionActive = useSharedValue(useNativeMaterial);
  const lastNativeMotion = useSharedValue<number[]>([]);
  useLayoutEffect(() => {
    motionActive.set(useNativeMaterial);
    if (!useNativeMaterial) nativeHost.set(0);
    return () => { motionActive.set(false); };
  }, [useNativeMaterial, motionActive, nativeHost]);
  useAnimatedReaction(
    () => motionActive.get() ? [nativeHost.get(), Math.max(0, Math.min(1, visualProgress.get()))] : null,
    (state) => {
      if (!state || !updateNativeDockProgress || state[0] <= 0) return;
      const previous = lastNativeMotion.get();
      if (previous[0] === state[0] && previous[1] === state[1]) return;
      updateNativeDockProgress(state[0], state[1]);
      lastNativeMotion.set(state);
    },
  );
  // The fallback only scales a gradient, retaining fixed native bounds too.
  const fallbackMorph = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, visualProgress.get()));
    const height = geometry.expandedHeight + (geometry.compactHeight - geometry.expandedHeight) * p;
    return { transform: [{ scaleY: height / hostHeight }] };
  }, [geometry.expandedHeight, geometry.compactHeight, hostHeight]);

  return (
    <Animated.View pointerEvents="none" accessible={false} collapsable={false}
      style={[styles.frame, { height: hostHeight }, fade]}>
      {useNativeMaterial ? (
        <LiquidGlassView style={StyleSheet.absoluteFill} progressiveBlur radius={0}
          blur={18} refraction={0} refractionHeight={0}
          highlightWidth={0} highlightOpacity={0} depthEffect={false} chromaticAberration={false}
          tintColor={colors.background} tintOpacity={0.46} dark={dark}
          dockExpandedHeight={geometry.expandedHeight}
          dockCompactWidth={geometry.width} dockCompactHeight={geometry.compactHeight} dockCompactOffsetX={0}
          onMotionHostReady={(event) => nativeHost.set(event.nativeEvent.hostId)} enabled />
      ) : (
        <Animated.View pointerEvents="none" style={[styles.fallback, fallbackMorph]}>
          <LinearGradient pointerEvents="none"
            colors={[alpha(colors.background, 0), alpha(colors.background, 0.12), alpha(colors.background, 0.36), alpha(colors.background, 0.58)]}
            locations={[0, 0.25, 0.65, 1]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  fallback: { ...StyleSheet.absoluteFill, transformOrigin: 'center bottom' },
});
