import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useScreenSize } from '@/hooks/useScreenSize';
import { playerArtworkFlight, playerDockClipOffset, playerSurfaceHeight, playerSurfaceOffset } from '@/lib/playerReveal';

let nextMaterialBinding = 0;
const materialBinding = (active: boolean) => ({ active, serial: ++nextMaterialBinding });

/** Shared-artwork flights fade the whole dock; ordinary slides reveal it by clipping. */
export function PlayerDockUnderlay({ active, children }: { active: boolean; mini?: boolean; children: ReactNode }) {
  const { height } = useScreenSize();
  const frame = useAnimatedStyle(() => {
    const flight = active ? playerArtworkFlight.get() : null;
    return {
      // Compact Tabs share the mini's vertical band. Clipping at the morphing
      // background's bottom hides their side buttons until after route pop.
      opacity: flight ? flight.frame.miniContentOpacity : 1,
      transform: [{ translateY: flight ? 0
        : active ? playerDockClipOffset(playerSurfaceOffset.get(), playerSurfaceHeight.get(), height) : 0 }],
    };
  }, [active, height]);
  const content = useAnimatedStyle(() => ({
    transform: [{ translateY: active && playerArtworkFlight.get()
      ? 0
      : active ? -playerDockClipOffset(playerSurfaceOffset.get(), playerSurfaceHeight.get(), height) : 0 }],
  }), [active, height]);
  return (
    <Animated.View pointerEvents="box-none" collapsable={false} style={[styles.frame, { height }, frame]}>
      <Animated.View nativeID="resonus-dock-selection-host" pointerEvents="box-none" collapsable={false} style={[styles.content, { height }, content]}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

/** Prepare a retained material as soon as exit starts, before it is uncovered. */
export function usePlayerDockMaterialReady(active: boolean): boolean {
  const binding = useMemo(() => materialBinding(active), [active]);
  const serial = binding.serial;
  const current = useRef<object | null>(null);
  const [state, setState] = useState({ binding, value: false });
  useLayoutEffect(() => { current.current = binding; return () => { current.current = null; }; }, [binding]);
  const commit = useCallback((value: boolean) => {
    if (current.current === binding) setState({ binding, value });
  }, [binding]);
  useAnimatedReaction(() => [serial, active && playerSurfaceOffset.get() > 0] as const, (value, previous) => {
    if (!previous || value[0] !== previous[0] || value[1] !== previous[1]) scheduleOnRN(commit, value[1]);
  }, [active, commit, serial]);
  return active && state.binding === binding && state.value;
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  content: { position: 'absolute', left: 0, right: 0, top: 0 },
});
