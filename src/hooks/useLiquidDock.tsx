import { useIsFocused, usePathname, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Keyboard } from 'react-native';
import { makeMutable, ReduceMotion, useAnimatedScrollHandler, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { AMPP_DOCK, amppSpringDamping } from '@/lib/amppDock';
import { useGlassTuning } from '@/store/glassTuning';
import { createLiquidDockScrollState, updateLiquidDockScroll, type LiquidDockScrollState } from '@/lib/liquidDock';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useTabBarShown } from './useTabBar';

export const COMPACT_DOCK_SIZE = 50;
export const COMPACT_DOCK_GAP = 8;
const DOCK_SPRING = { mass: 1, stiffness: 350, damping: 30, reduceMotion: ReduceMotion.System };
function dockSpring(compact: boolean, amPlus: boolean) {
  'worklet';
  return amPlus ? { mass: 1, stiffness: AMPP_DOCK.stiffness, damping: amppSpringDamping(compact),
    reduceMotion: ReduceMotion.System } : DOCK_SPRING;
}

interface LiquidDock {
  /** One shared layout animation: zero expanded, one inline. */
  progress: SharedValue<number>;
  compact: boolean;
  expand: () => void;
  enabled: boolean;
  hasSearch: boolean;
  amPlus: boolean;
  uiEnabled: SharedValue<boolean>;
  uiCompact: SharedValue<boolean>;
  generation: SharedValue<number>;
  notifyCompact: (compact: boolean, generation: number) => void;
}

const noop = () => {};
// Browsers are also used outside tabs; an absent provider leaves their scrolling alone.
const defaultDock: LiquidDock = {
  progress: makeMutable(0), compact: false, expand: noop, enabled: false, hasSearch: false, amPlus: false,
  uiEnabled: makeMutable(false), uiCompact: makeMutable(false), generation: makeMutable(0), notifyCompact: noop,
};
const LiquidDockContext = createContext(defaultDock);
type LiquidDockScroll = Pick<LiquidDock, 'progress' | 'expand' | 'enabled' | 'uiEnabled' | 'uiCompact' | 'generation' | 'notifyCompact' | 'amPlus'>;
// A target change redraws dock controls, but does not change a list's handler.
const LiquidDockScrollContext = createContext<LiquidDockScroll>(defaultDock);

export function LiquidDockProvider({ children }: PropsWithChildren) {
  const segments = useSegments() as string[];
  // Segments contain file patterns: two different artists both use [id].
  // Include the resolved path so their shared dock still resets on navigation.
  const pathname = usePathname();
  const route = `${segments.join('/')}:${pathname}`;
  const withBar = useTabBarShown();
  const hasSong = usePlayerStore((state) => currentSong(state) !== null);
  const entries = useSettings((state) => state.bottomTabs);
  const amPlus = useGlassTuning((state) => state.mode === 'amPlus');
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const progress = useSharedValue(0);
  const uiEnabled = useSharedValue(false);
  const uiCompact = useSharedValue(false);
  const generation = useSharedValue(0);
  // The same dock is drawn on detail and settings screens when tabs are
  // visible there. Its interaction follows that visibility, not a tab route.
  const enabled = withBar && hasSong && !keyboardVisible
    && entries.some((entry) => entry.key !== 'search' && entry.enabled);
  // AM++ keeps Search in the expanded capsule and detaches it while minimizing;
  // the previous appearance modes retain their independent Search control.
  const hasSearch = entries.some((entry) => entry.key === 'search' && entry.enabled);
  const scope = `${route}:${enabled}:${hasSearch}:${amPlus}`;
  const [targetState, setTargetState] = useState({ scope, compact: false });
  if (targetState.scope !== scope) setTargetState({ scope, compact: false });
  const compact = targetState.scope === scope && targetState.compact;
  const enabledRef = useRef(enabled);
  const generationRef = useRef(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    const nextGeneration = ++generationRef.current;
    scheduleOnUI(() => {
      generation.set(nextGeneration);
      uiEnabled.set(enabled);
      uiCompact.set(false);
      progress.set(0);
    });
  }, [route, enabled, hasSearch, amPlus, generation, progress, uiCompact, uiEnabled]);

  const notifyCompact = useCallback((target: boolean, eventGeneration: number) => {
    if (!enabledRef.current || eventGeneration !== generationRef.current) return;
    setTargetState((previous) => previous.compact === target ? previous : { ...previous, compact: target });
  }, []);
  const expand = useCallback(() => {
    // A tap cancels a previous list's momentum decision until the next drag.
    const nextGeneration = ++generationRef.current;
    scheduleOnUI(() => {
      generation.set(nextGeneration);
      const wasCompact = uiCompact.get();
      uiCompact.set(false);
      if (wasCompact || progress.get() !== 0) progress.set(withSpring(0, dockSpring(false, amPlus)));
    });
    setTargetState((previous) => previous.compact ? { ...previous, compact: false } : previous);
  }, [generation, progress, uiCompact, amPlus]);
  const value = useMemo(() => ({ progress, compact, expand, enabled, hasSearch, uiEnabled, uiCompact, generation, notifyCompact, amPlus }),
    [progress, compact, expand, enabled, hasSearch, uiEnabled, uiCompact, generation, notifyCompact, amPlus]);
  const scrollValue = useMemo(() => ({ progress, expand, enabled, uiEnabled, uiCompact, generation, notifyCompact, amPlus }),
    [progress, expand, enabled, uiEnabled, uiCompact, generation, notifyCompact, amPlus]);
  return (
    <LiquidDockContext.Provider value={value}>
      <LiquidDockScrollContext.Provider value={scrollValue}>{children}</LiquidDockScrollContext.Provider>
    </LiquidDockContext.Provider>
  );
}

export function useLiquidDock() {
  return useContext(LiquidDockContext);
}

interface ScrollContext extends Record<string, unknown> {
  state?: LiquidDockScrollState;
  generation?: number;
  userDragging?: boolean;
}

/** Attach only to a screen's primary vertical animated list/scroll view. */
export function useLiquidDockScrollHandler() {
  const { progress, uiEnabled, uiCompact, generation, notifyCompact, amPlus } = useContext(LiquidDockScrollContext);
  const focused = useIsFocused();
  // The provider resets the dock for every real route/availability change.
  // Replaying an incoming screen's layout effects must not expand it again.
  return useAnimatedScrollHandler<ScrollContext>({
    onBeginDrag: (event, context) => {
      context.generation = generation.get();
      context.state = createLiquidDockScrollState(uiCompact.get());
      context.userDragging = focused && uiEnabled.get();
      const target = updateLiquidDockScroll(context.state, event.contentOffset.y,
        event.layoutMeasurement.height, event.contentSize.height, false);
      if (!focused || !uiEnabled.get() || target === undefined || target === uiCompact.get()) return;
      uiCompact.set(target);
      progress.set(withSpring(target ? 1 : 0, dockSpring(target, amPlus)));
      scheduleOnRN(notifyCompact, target, generation.get());
    },
    onEndDrag: (event, context) => {
      // A coalesced final offset may arrive only here. Count it as part of the
      // real drag; the subsequent content inertia must not complete its intent.
      if (focused && uiEnabled.get() && context.state && context.userDragging
        && context.generation === generation.get()) {
        context.state.compact = uiCompact.get();
        const target = updateLiquidDockScroll(context.state, event.contentOffset.y,
          event.layoutMeasurement.height, event.contentSize.height, true);
        if (target !== undefined && target !== uiCompact.get()) {
          uiCompact.set(target);
          progress.set(withSpring(target ? 1 : 0, dockSpring(target, amPlus)));
          scheduleOnRN(notifyCompact, target, generation.get());
        }
      }
      context.userDragging = false;
    },
    onMomentumBegin: (_event, context) => {
      // Momentum scrolls content, but never starts or completes a dock gesture.
      context.userDragging = false;
    },
    onMomentumEnd: (_event, context) => {
      context.userDragging = false;
      if (context.state) context.state.distance = 0;
    },
    onScroll: (event, context) => {
      if (!focused || !uiEnabled.get()) return;
      if (!context.state || context.generation !== generation.get()) {
        context.state = createLiquidDockScrollState(uiCompact.get());
        context.generation = generation.get();
        context.userDragging = false;
      }
      context.state.compact = uiCompact.get();
      const target = updateLiquidDockScroll(context.state, event.contentOffset.y,
        event.layoutMeasurement.height, event.contentSize.height, !!context.userDragging);
      if (target === undefined || target === uiCompact.get()) return;
      uiCompact.set(target);
      progress.set(withSpring(target ? 1 : 0, dockSpring(target, amPlus)));
      scheduleOnRN(notifyCompact, target, generation.get());
    },
  }, [focused, progress, uiEnabled, uiCompact, generation, notifyCompact, amPlus]);
}
