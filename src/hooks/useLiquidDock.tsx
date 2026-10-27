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
import { expandNativeDockScrollInput, isLiquidGlassAvailable, readNativeDockScrollIntent } from '../../modules/liquid-glass';

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
  scope: string;
  nativeInput: boolean;
  nativeInputHost: SharedValue<number>;
  nativeIntent: SharedValue<number>;
  uiScope: SharedValue<string>;
  requestNativeCompact: (compact: boolean, scope: string) => void;
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
  scope: '', nativeInput: false, nativeInputHost: makeMutable(0), nativeIntent: makeMutable(0),
  uiScope: makeMutable(''), requestNativeCompact: noop,
};
const LiquidDockContext = createContext(defaultDock);
type LiquidDockScroll = Pick<LiquidDock, 'progress' | 'expand' | 'enabled' | 'uiEnabled' | 'uiCompact' | 'generation' | 'notifyCompact' | 'amPlus'
  | 'nativeInput' | 'nativeInputHost' | 'nativeIntent' | 'uiScope'>;
// A target change redraws dock controls, but does not change a list's handler.
const LiquidDockScrollContext = createContext<LiquidDockScroll>(defaultDock);
interface DockTargetState {
  scope: string;
  root: string;
  compact: boolean;
  parked?: { scope: string; compact: boolean; token: number };
  parkSerial: number;
  handoff: 'none' | 'park' | 'restore';
  restoredCompact: boolean;
}

export function LiquidDockProvider({ children }: PropsWithChildren) {
  const segments = useSegments() as string[];
  // Segments contain file patterns: two different artists both use [id].
  // Include the resolved path so their shared dock still resets on navigation.
  const pathname = usePathname();
  const route = `${segments.join('/')}:${pathname}`;
  const root = segments[0] ?? '';
  const amll = useSettings((state) => state.playerPresentation === 'amll');
  const withBar = useTabBarShown();
  const hasSong = usePlayerStore((state) => currentSong(state) !== null);
  const entries = useSettings((state) => state.bottomTabs);
  const amPlus = useGlassTuning((state) => state.mode === 'amPlus');
  const nativeInput = amPlus && isLiquidGlassAvailable && readNativeDockScrollIntent !== null;
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const progress = useSharedValue(0);
  const uiEnabled = useSharedValue(false);
  const uiCompact = useSharedValue(false);
  const generation = useSharedValue(0);
  const nativeInputHost = useSharedValue(0);
  const nativeIntent = useSharedValue(0);
  const uiScope = useSharedValue('');
  const parkedProgress = useSharedValue(0);
  const parkedCompact = useSharedValue(false);
  // The same dock is drawn on detail and settings screens when tabs are
  // visible there. Its interaction follows that visibility, not a tab route.
  const enabled = withBar && hasSong && !keyboardVisible
    && entries.some((entry) => entry.key !== 'search' && entry.enabled);
  // AM++ keeps Search in the expanded capsule and detaches it while minimizing;
  // the previous appearance modes retain their independent Search control.
  const hasSearch = entries.some((entry) => entry.key === 'search' && entry.enabled);
  const scope = `${route}:${enabled}:${hasSearch}:${amPlus}`;
  const [targetState, setTargetState] = useState<DockTargetState>({ scope, root, compact: false,
    handoff: 'none', restoredCompact: false, parkSerial: 0 });
  let target = targetState;
  if (targetState.scope !== scope) {
    const parking = amll && root === 'player' && targetState.root !== 'player' && !targetState.parked;
    const parkSerial = targetState.parkSerial + (parking ? 1 : 0);
    const parked = parking ? { scope: targetState.scope, compact: targetState.compact, token: parkSerial } : targetState.parked;
    const restoring = parked?.scope === scope;
    target = { scope, root, compact: restoring ? parked.compact : false, parkSerial,
      parked: ['player', 'queue', 'lyrics', 'favorites-add'].includes(root) ? parked : undefined,
      handoff: restoring ? 'restore' : parking ? 'park' : 'none', restoredCompact: restoring && parked.compact };
    setTargetState(target);
  }
  const compact = target.compact;
  const handoff = target.handoff;
  const restoredCompact = target.restoredCompact;
  const parkedToken = target.parked?.token ?? 0;
  const enabledRef = useRef(enabled);
  const scopeRef = useRef(scope);
  const generationRef = useRef(0);
  const captureParkedTarget = useCallback((actual: boolean, token: number) => {
    setTargetState((previous) => previous.parked?.token === token && previous.parked.compact !== actual
      ? { ...previous, parked: { ...previous.parked, compact: actual } } : previous);
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    scopeRef.current = scope;
    const nextGeneration = ++generationRef.current;
    scheduleOnUI(() => {
      if (handoff === 'park') {
        parkedProgress.set(progress.get());
        parkedCompact.set(uiCompact.get());
        // A UI scroll decision can precede its React notification. Preserve
        // that actual target, rather than reverting it when the player pops.
        scheduleOnRN(captureParkedTarget, uiCompact.get(), parkedToken);
      }
      generation.set(nextGeneration);
      nativeIntent.set(0);
      if (nativeInput) expandNativeDockScrollInput?.(nativeInputHost.get());
      uiEnabled.set(enabled);
      const targetCompact = handoff === 'restore' && parkedCompact.get();
      uiCompact.set(targetCompact);
      const start = handoff === 'restore' ? parkedProgress.get() : 0;
      progress.set(start);
      if (handoff === 'restore' && Math.abs(start - (targetCompact ? 1 : 0)) > 0.001)
        progress.set(withSpring(targetCompact ? 1 : 0, dockSpring(targetCompact, amPlus)));
      // Publish readiness last: returning globals must not briefly read the
      // covered player's zero progress before its parked geometry is restored.
      uiScope.set(scope);
    });
  }, [route, enabled, hasSearch, amPlus, scope, handoff, restoredCompact, parkedToken, captureParkedTarget, nativeInput, generation, progress, parkedProgress, parkedCompact, uiCompact, uiEnabled, uiScope, nativeIntent, nativeInputHost]);

  const notifyCompact = useCallback((target: boolean, eventGeneration: number) => {
    if (!enabledRef.current || eventGeneration !== generationRef.current) return;
    setTargetState((previous) => previous.compact === target ? previous : { ...previous, compact: target });
  }, []);
  const requestNativeCompact = useCallback((target: boolean, eventScope: string) => {
    if (!nativeInput || !enabledRef.current || eventScope !== scopeRef.current) return;
    const expectedGeneration = generationRef.current;
    scheduleOnUI(() => {
      if (!uiEnabled.get() || generation.get() !== expectedGeneration) return;
      const serial = readNativeDockScrollIntent?.(nativeInputHost.get(), uiScope.get()) ?? 0;
      // A queued event must not revive a decision superseded by reversal,
      // manual expansion, a route handoff, or a new native input owner.
      if (serial === 0 || (serial > 0) !== target) return;
      nativeIntent.set(serial);
      if (uiCompact.get() !== target) {
        uiCompact.set(target);
        progress.set(withSpring(target ? 1 : 0, dockSpring(target, true)));
      }
      scheduleOnRN(notifyCompact, target, expectedGeneration);
    });
  }, [nativeInput, generation, uiEnabled, nativeInputHost, uiScope, nativeIntent, uiCompact, progress, notifyCompact]);
  const expand = useCallback(() => {
    // A tap cancels a previous list's momentum decision until the next drag.
    const nextGeneration = ++generationRef.current;
    scheduleOnUI(() => {
      generation.set(nextGeneration);
      if (nativeInput) expandNativeDockScrollInput?.(nativeInputHost.get());
      const wasCompact = uiCompact.get();
      uiCompact.set(false);
      if (wasCompact || progress.get() !== 0) progress.set(withSpring(0, dockSpring(false, amPlus)));
    });
    setTargetState((previous) => previous.compact ? { ...previous, compact: false } : previous);
  }, [generation, progress, uiCompact, amPlus, nativeInput, nativeInputHost]);
  const value = useMemo(() => ({ progress, compact, expand, enabled, hasSearch, uiEnabled, uiCompact, generation, notifyCompact, amPlus,
    scope, nativeInput, nativeInputHost, nativeIntent, uiScope, requestNativeCompact }),
    [progress, compact, expand, enabled, hasSearch, uiEnabled, uiCompact, generation, notifyCompact, amPlus,
      scope, nativeInput, nativeInputHost, nativeIntent, uiScope, requestNativeCompact]);
  const scrollValue = useMemo(() => ({ progress, expand, enabled, uiEnabled, uiCompact, generation, notifyCompact, amPlus,
    nativeInput, nativeInputHost, nativeIntent, uiScope }),
    [progress, expand, enabled, uiEnabled, uiCompact, generation, notifyCompact, amPlus,
      nativeInput, nativeInputHost, nativeIntent, uiScope]);
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
  const { progress, uiEnabled, uiCompact, generation, notifyCompact, amPlus,
    nativeInput, nativeInputHost, nativeIntent, uiScope } = useContext(LiquidDockScrollContext);
  const focused = useIsFocused();
  const applyNativeIntent = () => {
    'worklet';
    if (!focused || !uiEnabled.get() || !readNativeDockScrollIntent) return;
    const serial = readNativeDockScrollIntent(nativeInputHost.get(), uiScope.get());
    if (serial === 0 || serial === nativeIntent.get()) return;
    nativeIntent.set(serial);
    const target = serial > 0;
    if (target === uiCompact.get()) return;
    uiCompact.set(target);
    progress.set(withSpring(target ? 1 : 0, dockSpring(target, true)));
    scheduleOnRN(notifyCompact, target, generation.get());
  };
  // The provider resets the dock for every real route/availability change.
  // Replaying an incoming screen's layout effects must not expand it again.
  return useAnimatedScrollHandler<ScrollContext>({
    onBeginDrag: (event, context) => {
      if (nativeInput) { applyNativeIntent(); return; }
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
      if (nativeInput) { applyNativeIntent(); return; }
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
      if (nativeInput) { applyNativeIntent(); return; }
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
  }, [focused, progress, uiEnabled, uiCompact, generation, notifyCompact, amPlus,
    nativeInput, nativeInputHost, nativeIntent, uiScope]);
}
