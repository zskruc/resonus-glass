import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useScreenSize } from '@/hooks/useScreenSize';
import { playerDockClipOffset, playerSurfaceHeight, playerSurfaceOffset } from '@/lib/playerReveal';

let nextMaterialBinding = 0;
const materialBinding = (active: boolean) => ({ active, serial: ++nextMaterialBinding });

/** Globals sit above Stack. Clip them to the part its opaque player uncovered. */
export function PlayerDockUnderlay({ active, children }: { active: boolean; children: ReactNode }) {
  const { height } = useScreenSize();
  const frame = useAnimatedStyle(() => ({
    transform: [{ translateY: active ? playerDockClipOffset(playerSurfaceOffset.get(), playerSurfaceHeight.get(), height) : 0 }],
  }), [active, height]);
  const content = useAnimatedStyle(() => ({
    transform: [{ translateY: active ? -playerDockClipOffset(playerSurfaceOffset.get(), playerSurfaceHeight.get(), height) : 0 }],
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
