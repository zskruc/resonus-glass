import { useIsFocused, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Keyboard } from 'react-native';
import { makeMutable, ReduceMotion, useAnimatedScrollHandler, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { createLiquidDockScrollState, updateLiquidDockScroll, type LiquidDockScrollState } from '@/lib/liquidDock';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useTabBarShown } from './useTabBar';

export const COMPACT_DOCK_SIZE = 50;
export const COMPACT_DOCK_GAP = 8;
const DOCK_SPRING = { mass: 1, stiffness: 350, damping: 30, reduceMotion: ReduceMotion.System };

interface LiquidDock {
  /** One shared layout animation: zero expanded, one inline. */
  progress: SharedValue<number>;
  compact: boolean;
  expand: () => void;
  enabled: boolean;
  hasSearch: boolean;
  uiEnabled: SharedValue<boolean>;
  uiCompact: SharedValue<boolean>;
  generation: SharedValue<number>;
  notifyCompact: (compact: boolean, generation: number) => void;
}

const noop = () => {};
// Browsers are also used outside tabs; an absent provider leaves their scrolling alone.
const defaultDock: LiquidDock = {
  progress: makeMutable(0), compact: false, expand: noop, enabled: false, hasSearch: false,
  uiEnabled: makeMutable(false), uiCompact: makeMutable(false), generation: makeMutable(0), notifyCompact: noop,
};
const LiquidDockContext = createContext(defaultDock);
type LiquidDockScroll = Pick<LiquidDock, 'progress' | 'expand' | 'enabled' | 'uiEnabled' | 'uiCompact' | 'generation' | 'notifyCompact'>;
// A target change redraws dock controls, but does not change a list's handler.
const LiquidDockScrollContext = createContext<LiquidDockScroll>(defaultDock);

export function LiquidDockProvider({ children }: PropsWithChildren) {
  const segments = useSegments() as string[];
  const route = segments.join('/');
  const withBar = useTabBarShown();
  const hasSong = usePlayerStore((state) => currentSong(state) !== null);
  const entries = useSettings((state) => state.bottomTabs);
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const progress = useSharedValue(0);
  const uiEnabled = useSharedValue(false);
  const uiCompact = useSharedValue(false);
  const generation = useSharedValue(0);
  // The same dock is drawn on detail and settings screens when tabs are
  // visible there. Its interaction follows that visibility, not a tab route.
  const enabled = withBar && hasSong && !keyboardVisible
    && entries.some((entry) => entry.key !== 'search' && entry.enabled);
  // Search is always a separate right-hand control, including without a song
  // and on Search itself. Its visibility is independent of minimizing the dock.
  const hasSearch = entries.some((entry) => entry.key === 'search' && entry.enabled);
  const scope = `${route}:${enabled}:${hasSearch}`;
  const [targetState, setTargetState] = useState({ scope, compact: false });
  if (targetState.scope !== scope) setTargetState({ scope, compact: false });
  const compact = targetState.scope === scope && targetState.compact;
  const enabledRef = useRef(enabled);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    generation.set(generation.get() + 1);
    uiEnabled.set(enabled);
    uiCompact.set(false);
    progress.set(0);
  }, [route, enabled, hasSearch, generation, progress, uiCompact, uiEnabled]);

  const notifyCompact = useCallback((target: boolean, eventGeneration: number) => {
    if (!enabledRef.current || eventGeneration !== generation.get()) return;
    setTargetState((previous) => previous.compact === target ? previous : { ...previous, compact: target });
  }, [generation]);
  const expand = useCallback(() => {
    // A tap cancels a previous list's momentum decision until the next drag.
    generation.set(generation.get() + 1);
    uiCompact.set(false);
    progress.set(withSpring(0, DOCK_SPRING));
    setTargetState((previous) => previous.compact ? { ...previous, compact: false } : previous);
  }, [generation, progress, uiCompact]);
  const value = useMemo(() => ({ progress, compact, expand, enabled, hasSearch, uiEnabled, uiCompact, generation, notifyCompact }),
    [progress, compact, expand, enabled, hasSearch, uiEnabled, uiCompact, generation, notifyCompact]);
  const scrollValue = useMemo(() => ({ progress, expand, enabled, uiEnabled, uiCompact, generation, notifyCompact }),
    [progress, expand, enabled, uiEnabled, uiCompact, generation, notifyCompact]);
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
  const { progress, uiEnabled, uiCompact, generation, notifyCompact, expand, enabled } = useContext(LiquidDockScrollContext);
  const focused = useIsFocused();
  const lastScope = useRef<{ focused: boolean; enabled: boolean; expand: () => void } | null>(null);
  useLayoutEffect(() => {
    const previous = lastScope.current;
    lastScope.current = { focused, enabled, expand };
    // Suspense replays layout effects on return from the background. Expand
    // for a real focus/availability change, while keeping a folded dock on
    // the same screen when only its layout effects are being restored.
    const changed = !previous || previous.focused !== focused
      || previous.enabled !== enabled || previous.expand !== expand;
    if (changed && focused && enabled) expand();
  }, [focused, enabled, expand]);
  return useAnimatedScrollHandler<ScrollContext>({
    onBeginDrag: (event, context) => {
      context.generation = generation.get();
      context.state = createLiquidDockScrollState(uiCompact.get());
      context.userDragging = focused && uiEnabled.get();
      const target = updateLiquidDockScroll(context.state, event.contentOffset.y,
        event.layoutMeasurement.height, event.contentSize.height, false);
      if (!focused || !uiEnabled.get() || target === undefined || target === uiCompact.get()) return;
      uiCompact.set(target);
      progress.set(withSpring(target ? 1 : 0, DOCK_SPRING));
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
          progress.set(withSpring(target ? 1 : 0, DOCK_SPRING));
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
      progress.set(withSpring(target ? 1 : 0, DOCK_SPRING));
      scheduleOnRN(notifyCompact, target, generation.get());
    },
  }, [focused, progress, uiEnabled, uiCompact, generation, notifyCompact]);
}
