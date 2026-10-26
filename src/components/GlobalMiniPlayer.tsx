/**
 * Global MiniPlayer: shown on ALL screens (not only in tabs), just like
 * Spotify. Sits above the tab bar when on tab screens, and at the bottom on
 * other screens. On full-screen modals (player, queue, lyrics) it fades out
 * instead of disappearing instantly, to avoid flickering while the modal slides up.
 */
import { useSegments } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import Animated, { cancelAnimation, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AMPP_DOCK, amppMiniSink, amppProgress } from '@/lib/amppDock';
import { NO_MINI_PLAYER, usePlayerDockUnderlay, useTabBarShown } from '@/hooks/useTabBar';
import { COMPACT_DOCK_SIZE, useLiquidDock } from '@/hooks/useLiquidDock';
import { motion } from '@/theme/motion';
import { MINI_PLAYER_GAP, MINI_PLAYER_HEIGHT, spacing, TAB_BAR_BOTTOM_GAP, TAB_BAR_HEIGHT } from '@/theme';
import { MiniPlayer } from './MiniPlayer';
import { PlayerDockUnderlay } from './PlayerDockUnderlay';
import { playerCanReturnToMini } from '@/lib/playerReveal';

export function GlobalMiniPlayer() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const root = segments[0];
  // Above the navigation bar wherever there is one, which with the setting on
  // is nearly everywhere and not only inside the tabs (see `useTabBarShown`).
  const withBar = useTabBarShown();
  const dock = useLiquidDock();
  const { progress, uiEnabled, amPlus } = dock;
  const navHeight = amPlus ? AMPP_DOCK.navigationHeight : TAB_BAR_HEIGHT;
  const miniHeight = amPlus ? AMPP_DOCK.miniHeight : MINI_PLAYER_HEIGHT;
  const bottomGap = amPlus ? AMPP_DOCK.bottomGap : TAB_BAR_BOTTOM_GAP;
  const miniGap = amPlus ? AMPP_DOCK.gap : MINI_PLAYER_GAP;
  const compactSize = amPlus ? AMPP_DOCK.compactSize : COMPACT_DOCK_SIZE;

  // favorites-add too: its search bar lives at the bottom and the mini would
  // cover it. The list is shared because whatever floats at the bottom (the
  // toast, the multi-select bar) has to know where the mini is not.
  const visible = !NO_MINI_PLAYER.includes(root as string);
  const underlay = usePlayerDockUnderlay(visible);
  useLayoutEffect(() => { playerCanReturnToMini.set(underlay.reveal); }, [underlay.reveal]);
  const bottom = withBar ? bottomGap + navHeight + miniGap + insets.bottom : insets.bottom + spacing.sm;

  // Keep the last visible position so it doesn't jump while fading out
  // when opening a full-screen modal.
  // Freeze both geometry and target while a full-screen player covers the dock.
  // The provider resets on the new route; the outgoing mini must stay in place.
  const [lastDock, setLastDock] = useState({ bottom, compact: dock.compact, hasSearch: dock.hasSearch, enabled: dock.enabled });
  if (visible && (lastDock.bottom !== bottom || lastDock.compact !== dock.compact
    || lastDock.hasSearch !== dock.hasSearch || lastDock.enabled !== dock.enabled)) {
    setLastDock({ bottom, compact: dock.compact, hasSearch: dock.hasSearch, enabled: dock.enabled });
  }
  const uiVisible = useSharedValue(visible);
  // Child layout effects run before the provider resets the new route. Mark the
  // outgoing mini frozen first, even before animated worklet effects refresh.
  useLayoutEffect(() => { uiVisible.set(visible); }, [visible, uiVisible]);
  const frozenProgress = useSharedValue(0);
  useAnimatedReaction(
    () => uiVisible.get() ? (uiEnabled.get() ? progress.get() : 0) : null,
    (value) => { if (value !== null) frozenProgress.set(value); },
  );
  const visualProgress = useDerivedValue(() => uiVisible.get()
    ? (uiEnabled.get() ? progress.get() : 0) : frozenProgress.get());
  const opacity = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(opacity);
    opacity.set(underlay.reveal || underlay.returning ? 1 : withTiming(visible ? 1 : 0, {
      duration: motion.duration.fade,
      reduceMotion: motion.reduceMotion.decorative,
    }));
  }, [visible, underlay.reveal, underlay.returning, opacity]);
  const expandedBottom = visible ? bottom : lastDock.bottom;
  const compactBottom = insets.bottom + bottomGap + (compactSize - miniHeight) / 2;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (expandedBottom - compactBottom) * amppProgress(visualProgress.get())
      + (amPlus ? amppMiniSink(visualProgress.get()) : 0) }],
    opacity: underlay.reveal || underlay.returning ? 1 : opacity.get(),
  }), [expandedBottom, compactBottom, amPlus, underlay.reveal, underlay.returning]);

  return (
    <PlayerDockUnderlay active={underlay.reveal} mini>
    <Animated.View
      style={[{ position: 'absolute', left: 0, right: 0, bottom: expandedBottom }, style]}
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <MiniPlayer active={visible} dockProgress={visualProgress} compact={visible ? dock.compact : lastDock.compact}
        hasSearch={visible ? dock.hasSearch : lastDock.hasSearch} dockEnabled={visible ? dock.enabled : lastDock.enabled} />
    </Animated.View>
    </PlayerDockUnderlay>
  );
}
