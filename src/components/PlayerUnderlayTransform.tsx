import { useIsFocused } from 'expo-router';
import { useLayoutEffect, type ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { playerUnderlayFrame, playerUnderlayRouteKey } from '@/lib/playerReveal';

const COVERED_ROUTES = new Set(['player', 'lyrics', 'queue', 'login']);

/** Transform one retained origin screen; the player and navigator stay full size. */
export function PlayerUnderlayTransform({ routeKey, routeName, children }: {
  routeKey: string;
  routeName: string;
  children: ReactNode;
}) {
  const focused = useIsFocused();
  const eligible = !COVERED_ROUTES.has(routeName.split('/')[0]);
  useLayoutEffect(() => {
    // Keep the last base route through modal focus changes so the player can
    // snapshot it. A covered route must never replace that captured origin.
    if (eligible && focused) playerUnderlayRouteKey.set(routeKey);
  }, [eligible, focused, routeKey]);
  const style = useAnimatedStyle<ViewStyle>(() => {
    const frame = playerUnderlayFrame.get();
    const matched = eligible && frame?.routeKey === routeKey;
    return {
      // Frame translation already includes the source affine scale factor.
      transform: [{ translateY: matched ? frame.translateY : 0 }, { scale: matched ? frame.scale : 1 }],
      borderRadius: matched ? frame.cornerRadius : 0,
      overflow: matched ? 'hidden' : 'visible',
    };
  }, [eligible, routeKey]);
  return <Animated.View collapsable={false} pointerEvents="box-none" style={[styles.frame, style]}>
    {children}
  </Animated.View>;
}

const styles = StyleSheet.create({ frame: { flex: 1 } });
