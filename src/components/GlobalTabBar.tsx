/**
 * The navigation bar, for the whole app (#96).
 *
 * A stack can get deep: an artist, one of its albums, another artist off a
 * track, a genre from there, and Home is five taps back. With "Always show the
 * navigation bar" on, this puts every tab within one tap of anywhere, and that
 * tap also clears the stack it was covering.
 *
 * It is the only bar there is. The tabs navigator draws none of its own
 * (`tabBar={() => null}` in the tabs layout) and this is rendered next to the
 * Stack, like `GlobalMiniPlayer`: one bar that never unmounts, rather than two
 * that hand over to each other. Two would have to be kept looking identical by
 * hand, and the handover showed as a blink of empty space in the middle of
 * every back animation.
 *
 * Search has its own glass circle on the right; the other tabs share a capsule.
 */
import Icon from '@/components/Icon';
import { useNavigationContainerRef, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { useBarBlur } from '@/components/BarBlur';
import { FloatingGlassBackdrop } from '@/components/glass';
import { isLiquidGlassAvailable, LiquidGlassTabsView, updateNativeDockProgress, updateNativeTabsMotion } from '../../modules/liquid-glass';

import { useTabBarShown } from '@/hooks/useTabBar';
import { COMPACT_DOCK_GAP, COMPACT_DOCK_SIZE, useLiquidDock } from '@/hooks/useLiquidDock';
import { useScreenSize } from '@/hooks/useScreenSize';
import { motion } from '@/theme/motion';
import { useT } from '@/i18n';
import { rememberTab, requestSearchFocus, reselectTab, tabOrigin, TABS, type TabSegment } from '@/lib/tabOrigin';
import { getActiveTabJumpAction } from '@/lib/tabNavigation';
import { getLiquidDockGeometry } from '@/lib/liquidDock';
import { useSettings } from '@/store/settings';
import { resolveGlassProfile, useGlassTuning } from '@/store/glassTuning';
import { BOTTOM_BAR_HORIZONTAL_MARGIN, BOTTOM_BAR_MAX_WIDTH, TAB_BAR_BOTTOM_GAP, TAB_BAR_HEIGHT, useTheme, useThemeMode } from '@/theme';

const ICONS: Record<string, 'home' | 'search' | 'library' | 'albums' | 'settings'> = {
  index: 'home',
  search: 'search',
  library: 'library',
  explore: 'albums',
  options: 'settings',
};

// Same critically damped tracking and soft shape springs as the upstream tabs.
const SELECTION_SPRING = { damping: 63.25, stiffness: 1000, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const PRESS_SPRING = { damping: 63.25, stiffness: 1000, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const SCALE_X_SPRING = { damping: 18.97, stiffness: 250, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const SCALE_Y_SPRING = { damping: 22.14, stiffness: 250, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const RELEASE_SPRING = { damping: 34.64, stiffness: 300, mass: 1, reduceMotion: motion.reduceMotion.decorative };
const INNER_GAP = 4;
const HORIZONTAL_INSET = 12;
const PRESSED_SCALE = 78 / 56;

function NavigationItem({
  showLabels, glassPressed, onPressedChange, onPressIn, onPressOut, ...props
}: Omit<PressableProps, 'style'> & {
  showLabels: boolean;
  glassPressed: boolean;
  onPressedChange?: (pressed: boolean) => void;
}) {
  return (
    <Pressable
      {...props}
      style={[styles.item, !showLabels && styles.itemIconOnly, glassPressed && styles.pressedItem]}
      onPressIn={(event) => {
        onPressedChange?.(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        onPressedChange?.(false);
        onPressOut?.(event);
      }}
    />
  );
}

export function GlobalTabBar() {
  const insets = useSafeAreaInsets();
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const rtl = I18nManager.isRTL;
  const reduceMotion = useReducedMotion();
  const { width: screenWidth } = useScreenSize();
  const { progress: sourceDockProgress, compact: targetCompact, uiCompact: dockCompactTarget,
    expand, hasSearch: dockHasSearch } = useLiquidDock();
  const navigationOverrides = useGlassTuning((s) => s.overrides.navigation);
  const glassMode = useGlassTuning((s) => s.mode);
  const glass = resolveGlassProfile('navigation', dark, navigationOverrides, glassMode);
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();
  const t = useT();
  const segments = useSegments() as string[];
  const shown = useTabBarShown();
  // Opening the player resets the provider for its new route. Keep the last
  // visible dock geometry during this bar's existing fade-out transition.
  const [lastDockTarget, setLastDockTarget] = useState({ compact: targetCompact, hasSearch: dockHasSearch });
  if (shown && (lastDockTarget.compact !== targetCompact || lastDockTarget.hasSearch !== dockHasSearch)) {
    setLastDockTarget({ compact: targetCompact, hasSearch: dockHasSearch });
  }
  const compact = shown ? targetCompact : lastDockTarget.compact;
  const hasSearch = shown ? dockHasSearch : lastDockTarget.hasSearch;
  const uiShown = useSharedValue(shown);
  useLayoutEffect(() => { uiShown.set(shown); }, [shown, uiShown]);
  const frozenDockProgress = useSharedValue(0);
  useAnimatedReaction(() => uiShown.value ? sourceDockProgress.value : null, (value) => {
    if (value !== null) frozenDockProgress.set(value);
  });
  const dockProgress = useDerivedValue(() => uiShown.value ? sourceDockProgress.value : frozenDockProgress.value);
  // Mirror only the transition boundary. JS taps must not synchronously wait
  // for a UI-thread shared-value read while the glass is being rendered.
  const dockNavigationBlocked = useRef(compact);
  const updateDockNavigationBlocked = useCallback((blocked: boolean) => {
    dockNavigationBlocked.current = blocked;
  }, []);
  useLayoutEffect(() => {
    if (compact) dockNavigationBlocked.current = true;
  }, [compact]);
  useAnimatedReaction(() => dockCompactTarget.get() || dockProgress.value > 0.001, (blocked, previous) => {
    if (blocked !== previous) scheduleOnRN(updateDockNavigationBlocked, blocked);
  });
  // It is also the bar of the tab screens (the tabs navigator draws none):
  // the blur only works from out here (`BarBlur`). The setting only decides
  // where else it shows.
  const blur = useBarBlur('tabs');
  const bottomTabs = useSettings((s) => s.bottomTabs);
  const showLabels = useSettings((s) => s.showTabLabels);
  const root = segments[0];
  const inTabs = root === '(tabs)' || root === undefined;
  // Where a stack opened from here would belong; the back arrow reads the same
  // thing to know where to let you out (see `tabOrigin`).
  if (inTabs) rememberTab(segments[1]);
  const origin = tabOrigin();
  const current = inTabs ? origin : null;
  const enabledTabs = bottomTabs
    .filter((tab) => tab.enabled)
    .map(({ key }) => TABS.find((tab) => tab.segment === key))
    .filter((tab): tab is (typeof TABS)[number] => !!tab);
  const searchTab = enabledTabs.find((tab) => tab.segment === 'search');
  const tabs = enabledTabs.filter((tab) => tab.segment !== 'search');
  const tabOrder = tabs.map((tab) => tab.segment).join(',');
  // The gesture always uses expanded coordinates. Measuring the morphing
  // capsule with onLayout would send a JS state update on every layout frame.
  const fullWidth = Math.min(BOTTOM_BAR_MAX_WIDTH, Math.max(COMPACT_DOCK_SIZE, screenWidth - BOTTOM_BAR_HORIZONTAL_MARGIN * 2));
  const geometry = getLiquidDockGeometry(fullWidth, TAB_BAR_HEIGHT, COMPACT_DOCK_SIZE, COMPACT_DOCK_GAP, hasSearch, rtl);
  const navigationOffsetX = geometry.navigationOffsetX;
  const barWidth = geometry.navigationWidth;
  const baseMargin = Math.max(BOTTOM_BAR_HORIZONTAL_MARGIN, (screenWidth - BOTTOM_BAR_MAX_WIDTH) / 2);
  const [glassPressed, setGlassPressed] = useState(false);
  const tabWidth = tabs.length > 0 ? Math.max(0, barWidth - HORIZONTAL_INSET * 2) / tabs.length : 0;
  const selectedIndex = tabs.findIndex((tab) => tab.segment === (current ?? origin));
  const [lastMainTab, setLastMainTab] = useState(tabs[selectedIndex]?.segment ?? tabs[0]?.segment);
  if (selectedIndex >= 0 && tabs[selectedIndex].segment !== lastMainTab) setLastMainTab(tabs[selectedIndex].segment);
  const compactTab = tabs[selectedIndex] ?? tabs.find((tab) => tab.segment === lastMainTab) ?? tabs[0];
  const selectionPosition = useSharedValue(0);
  const selectionDestination = useSharedValue(-1);
  const selectionOpacity = useSharedValue(0);
  const pressProgress = useSharedValue(0);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const dragVelocity = useSharedValue(0);
  const panelOffset = useSharedValue(0);
  const routeSelection = useSharedValue(0);
  const dragFinished = useSharedValue(false);
  const dragging = useSharedValue(false);
  const geometryGeneration = useSharedValue(0);
  const geometryGenerationRef = useRef(0);
  const dragGeneration = useSharedValue(0);
  const positioned = useRef(false);
  const nativeMotionHost = useSharedValue(0);
  const lastNativeMotion = useSharedValue<number[]>([]);
  const motionEnabled = useSharedValue(false);
  useEffect(() => {
    // A rotation, hidden bar, or reordered tabs invalidates a gesture that
    // started with different coordinates. It must not select an old index.
    const nextGeneration = ++geometryGenerationRef.current;
    scheduleOnUI(() => {
      geometryGeneration.set(nextGeneration);
      dragging.set(false);
      dragFinished.set(false);
      pressProgress.set(0);
      scaleX.set(1);
      scaleY.set(1);
      dragVelocity.set(0);
      panelOffset.set(0);
      scheduleOnRN(setGlassPressed, false);
    });
  }, [tabWidth, tabOrder, shown, compact, geometryGeneration, dragging, dragFinished, pressProgress, scaleX, scaleY, dragVelocity, panelOffset]);
  useLayoutEffect(() => {
    if (tabWidth <= 0 || selectedIndex < 0) {
      selectionOpacity.set(withTiming(0, { duration: motion.duration.exit }));
      return;
    }
    const target = rtl ? tabs.length - 1 - selectedIndex : selectedIndex;
    const animate = positioned.current && !reduceMotion;
    positioned.current = true;
    scheduleOnUI(() => {
      routeSelection.set(target);
      // A completed drag already started this same spring on the UI thread.
      // Ordinary taps start it with the route commit, never ahead of the page.
      if (selectionDestination.get() !== target) {
        selectionDestination.set(target);
        selectionPosition.set(animate ? withSpring(target, SELECTION_SPRING) : target);
      }
      selectionOpacity.set(withTiming(inTabs ? 1 : 0.38, { duration: motion.duration.exit }));
    });
  }, [tabWidth, selectedIndex, tabs.length, inTabs, routeSelection, selectionDestination, selectionPosition, selectionOpacity, reduceMotion, rtl]);
  const selectionStyle = useAnimatedStyle(() => {
    const progress = Math.max(0, Math.min(1, dockProgress.value));
    return {
      width: tabWidth,
      // Unsupported platforms use endpoint geometry rather than native morph.
      opacity: compact ? 0 : selectionOpacity.value * (1 - progress),
      transform: [{ translateX: (selectionPosition.value - (rtl ? tabs.length - 1 : 0)) * tabWidth },
        { scaleX: scaleX.value }, { scaleY: scaleY.value }],
    };
  });
  // Dispatch the prepared values in the same mapper pass as the foreground.
  // An extra RAF would read derived progress before the next mapper update,
  // leaving the native material a frame behind. Last values stay outside
  // prepare so dispatch cannot trigger its own reaction or an idle frame loop.
  useAnimatedReaction(() => motionEnabled.value ? [nativeMotionHost.value,
    selectionPosition.value, pressProgress.value, scaleX.value, scaleY.value,
    dragVelocity.value, panelOffset.value,
    selectionOpacity.value * (1 - Math.max(0, Math.min(1, dockProgress.value))),
    Math.max(0, Math.min(1, dockProgress.value))] : null, (motionState) => {
    if (!motionState || !updateNativeTabsMotion || motionState[0] <= 0) return;
    const previous = lastNativeMotion.value;
    if (previous.length === motionState.length && motionState.every((value, index) => value === previous[index])) return;
    updateNativeTabsMotion(motionState[0], motionState[1], motionState[2], motionState[3], motionState[4],
      motionState[5], motionState[6], motionState[7]);
    if (previous[0] !== motionState[0] || previous[8] !== motionState[8]) updateNativeDockProgress?.(motionState[0], motionState[8]);
    lastNativeMotion.set(motionState);
  });

  const press = (drag = false) => {
    'worklet';
    if (reduceMotion) return;
    if (!drag) {
      pressProgress.set(withSpring(1, PRESS_SPRING));
      return;
    }
    // A single full-width tab cannot grow sideways beyond the screen margins.
    const horizontalScale = tabs.length === 1 ? 1 : tabs.length === 2 ? 1.1 : PRESSED_SCALE;
    scaleX.set(withSpring(horizontalScale, SCALE_X_SPRING));
    scaleY.set(withSpring(PRESSED_SCALE, SCALE_Y_SPRING));
  };
  const release = (drag = false) => {
    'worklet';
    pressProgress.set(reduceMotion ? 0 : drag
      ? withDelay(120, withSpring(0, PRESS_SPRING)) : withSpring(0, PRESS_SPRING));
    if (drag) {
      scaleX.set(reduceMotion ? 1 : withDelay(120, withSpring(1, SCALE_X_SPRING)));
      scaleY.set(reduceMotion ? 1 : withDelay(120, withSpring(1, SCALE_Y_SPRING)));
      dragVelocity.set(reduceMotion ? 0 : withSpring(0, RELEASE_SPRING));
      panelOffset.set(reduceMotion ? 0 : withSpring(0, RELEASE_SPRING));
    }
  };
  const foregroundShadow = {
    textShadowColor: dark ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)',
    textShadowOffset: { width: 0, height: dark ? 1 : 0 },
    textShadowRadius: dark ? 2 : 1.5,
  };
  /**
   * Going, rather than gone.
   *
   * This bar is drawn after the Stack, so it is over everything, the player
   * included — which is why it has to take itself off screen for the screens
   * that cover the app. It used to do that the instant the route changed,
   * while the modal still had its ~165 ms of animation to run: the strip it
   * had been covering was left showing the list rows underneath, and the way
   * into the player began with a hole.
   *
   * Fading rather than timing the disappearance to the animation. A fixed wait
   * is wrong in both directions and only one of them is recoverable: too short
   * leaves the hole again, too long puts the navigation bar on top of the
   * player. Fading, being early or late by a few frames costs a little more or
   * a little less of something already almost transparent.
   */
  const fade = useSharedValue(shown ? 1 : 0);
  // The blur redraws every frame it is on screen, invisible or not, so it goes
  // once the bar has faded out.
  const [blurOn, setBlurOn] = useState(shown);
  useEffect(() => {
    motionEnabled.set(shown && blurOn && isLiquidGlassAvailable);
    return () => { motionEnabled.set(false); };
  }, [shown, blurOn, motionEnabled]);
  if (shown && !blurOn) setBlurOn(true);
  useEffect(() => {
    // Straight back on the way in: coming out of the player the bar was there
    // before and belongs there again, and until the modal finishes dismissing
    // nobody can see it anyway.
    fade.value = shown
      ? 1
      : withTiming(0, { duration: motion.duration.exit }, (done) => {
          if (done) scheduleOnRN(setBlurOn, false);
        });
  }, [shown, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const searchDockStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: geometry.searchTranslationX * Math.max(0, Math.min(1, dockProgress.value)) }],
  }), [geometry.searchTranslationX]);
  const expandedContentStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, Math.min(1, dockProgress.value)),
  }));
  const compactContentStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, dockProgress.value)),
  }));
  const expandedSearchIconTop = showLabels ? 10 : (TAB_BAR_HEIGHT - 30) / 2;
  const searchIconStyle = useAnimatedStyle(() => {
    const progress = Math.max(0, Math.min(1, dockProgress.value));
    return { transform: [
      { translateX: (COMPACT_DOCK_SIZE - TAB_BAR_HEIGHT) / 2 * progress },
      { translateY: (TAB_BAR_HEIGHT - COMPACT_DOCK_SIZE + (COMPACT_DOCK_SIZE - 30) / 2 - expandedSearchIconTop) * progress },
    ] };
  }, [expandedSearchIconTop]);

  /** Leaves for a tab, dropping the screens piled on top of it. */
  const go = (href: string, segment: TabSegment) => {
    if (inTabs && navigationRef.isReady()) {
      const action = getActiveTabJumpAction(navigationRef.getRootState(), segment);
      if (action) {
        // Expo Router's URL API queues navigation until a later React effect.
        // An existing tab can switch directly in the current event instead.
        navigationRef.dispatch(action);
        return;
      }
    }
    // `canDismiss`, not `canGoBack`: inside the tabs there is history to go
    // back to but no stack to pop, and asking for it anyway is the navigator
    // warning about POP_TO_TOP going unhandled.
    if (router.canDismiss()) router.dismissAll();
    router.navigate(href);
  };

  const selectTab = (index: number, allowReselect = true) => {
    const tab = tabs[index];
    if (!tab || !shown) return;
    if (allowReselect && current === tab.segment) reselectTab(tab.segment);
    go(tab.href, tab.segment);
  };
  const tabsPan = Gesture.Pan()
    .enabled(shown && !compact && tabWidth > 0 && tabs.length > 1)
    .activeOffsetX([-6, 6])
    .failOffsetY([-8, 8])
    .onBegin(() => {
      if (dockCompactTarget.get() || dockProgress.value > 0.001) {
        dragGeneration.set(-1);
        return;
      }
      dragGeneration.set(geometryGeneration.value);
      dragFinished.set(false);
      dragging.set(false);
      press();
    })
    .onStart(() => {
      if (dragGeneration.value !== geometryGeneration.value) return;
      dragging.set(true);
      scheduleOnRN(setGlassPressed, true);
      press(true);
    })
    .onUpdate((event) => {
      if (dragGeneration.value !== geometryGeneration.value) return;
      const target = Math.max(0, Math.min(tabs.length - 1, (event.x - HORIZONTAL_INSET) / tabWidth - 0.5));
      selectionDestination.set(target);
      selectionPosition.set(reduceMotion ? target : withSpring(target, SELECTION_SPRING));
      if (!reduceMotion) {
        dragVelocity.set(Math.max(-10, Math.min(10, event.velocityX / tabWidth / Math.max(1, tabs.length - 1))));
        const fraction = Math.max(-1, Math.min(1, event.translationX / barWidth));
        panelOffset.set(4 * Math.sign(fraction) * (1 - Math.pow(1 - Math.abs(fraction), 3)));
      }
    })
    .onEnd((event, success) => {
      if (!success || dragGeneration.value !== geometryGeneration.value) return;
      const physicalIndex = Math.max(0, Math.min(tabs.length - 1, Math.round((event.x - HORIZONTAL_INSET) / tabWidth - 0.5)));
      dragFinished.set(true);
      selectionDestination.set(physicalIndex);
      selectionPosition.set(reduceMotion ? physicalIndex : withSpring(physicalIndex, SELECTION_SPRING));
      const logicalIndex = rtl ? tabs.length - 1 - physicalIndex : physicalIndex;
      scheduleOnRN(selectTab, logicalIndex, false);
    })
    .onFinalize(() => {
      // Vertical pulls and system interruptions give the glass back to the
      // actual route; a completed horizontal drag keeps its chosen destination.
      const wasDragging = dragging.get();
      dragging.set(false);
      if (wasDragging) scheduleOnRN(setGlassPressed, false);
      if (dragGeneration.value !== geometryGeneration.value) return;
      if (wasDragging && !dragFinished.value) {
        selectionDestination.set(routeSelection.value);
        selectionPosition.set(reduceMotion ? routeSelection.value : withSpring(routeSelection.value, SELECTION_SPRING));
      }
      release(wasDragging);
    });

  if (tabs.length === 0 && !searchTab) return null;
  return (
    <>
    {tabs.length > 0 ? (
    <Animated.View
      // Nothing to press once it is on its way out, so a tap meant for the
      // screen taking over does not land on a bar that is no longer there.
      pointerEvents={shown ? 'box-none' : 'none'}
      collapsable={false}
      style={[
        styles.frame,
        { bottom: insets.bottom + TAB_BAR_BOTTOM_GAP, width: barWidth,
          height: TAB_BAR_HEIGHT,
          start: rtl ? screenWidth - baseMargin - navigationOffsetX - barWidth : baseMargin + navigationOffsetX },
        fadeStyle,
      ]}
    >
      <View style={styles.shell} pointerEvents="box-none">
        <GestureDetector gesture={tabsPan}>
        <View collapsable={false} style={styles.bar} pointerEvents={compact ? 'box-none' : 'auto'}>
          {blurOn ? isLiquidGlassAvailable && tabs.length > 0 ? (
            <LiquidGlassTabsView style={StyleSheet.absoluteFill} radius={TAB_BAR_HEIGHT / 2}
              materialPreset={glassMode === 'kyantDefault' ? 'tabs' : 'custom'}
              tabsCount={tabs.length} tabHorizontalInset={HORIZONTAL_INSET} tabVerticalInset={INNER_GAP}
              dockCompactWidth={COMPACT_DOCK_SIZE} dockCompactHeight={COMPACT_DOCK_SIZE}
              dockCompactOffsetX={geometry.compactNavigationOffsetX}
              onMotionHostReady={(event) => nativeMotionHost.set(event.nativeEvent.hostId)}
              blur={blur ? glass.blur : 0} refraction={blur ? glass.refraction : 0}
              refractionHeight={blur ? glass.refractionHeight : 0}
              highlightWidth={glass.highlightWidth} highlightOpacity={glass.highlightOpacity}
              depthEffect={glass.depthEffect} chromaticAberration={glass.chromaticAberration}
              tintColor={glass.tintColor ?? colors.surface} tintOpacity={blur ? glass.tintOpacity : 1}
              dark={dark} enabled />
          ) : <View pointerEvents="none" style={[styles.fallbackMaterial,
            { width: compact ? COMPACT_DOCK_SIZE : barWidth, height: compact ? COMPACT_DOCK_SIZE : TAB_BAR_HEIGHT,
              start: rtl && compact ? barWidth - COMPACT_DOCK_SIZE : 0 }]}>
              <FloatingGlassBackdrop radius={TAB_BAR_HEIGHT / 2} tint={colors.surface} blurred={blur} />
            </View> : null}
          {blurOn && !isLiquidGlassAvailable && tabWidth > 0 && selectedIndex >= 0 ? (
            <Animated.View pointerEvents="none" collapsable={false} style={[styles.selection, selectionStyle]}>
              <FloatingGlassBackdrop appearance="selection" radius={TAB_BAR_HEIGHT / 2 - INNER_GAP} tint={colors.surface} blurred={blur} />
            </Animated.View>
          ) : null}
          <View style={styles.contentClip} pointerEvents={compact ? 'none' : 'box-none'}
            accessibilityElementsHidden={compact} importantForAccessibility={compact ? 'no-hide-descendants' : 'auto'}>
          <Animated.View style={[styles.items, { width: barWidth - HORIZONTAL_INSET * 2,
            start: HORIZONTAL_INSET }, expandedContentStyle]}>
          {/* The user's order, and only the ones they kept (Settings › Appearance
              › Navigation bar). `TABS` stays the catalogue: it is what says where
              each one goes and what it is called. */}
          {tabs.map((tab, index) => {
              // On a tab screen the bar says which one you are on. Off the tabs
              // nothing is current, and the tab the stack came from is only marked
              // enough to keep the bar from looking dead.
              const here = current === tab.segment;
              const from = !inTabs && origin === tab.segment;
              const color = here ? colors.accent : colors.text;
              return (
                <NavigationItem
                  key={tab.href}
                  // Same height without the names, so nothing else has to move: the
                  // icons just sit in the middle of it.
                  showLabels={showLabels}
                  glassPressed={glassPressed && index === selectedIndex}
                  // Multi-tab pointer feedback belongs to the Pan's full
                  // touch session. Activating it cancels RN Pressability and
                  // its onPressOut must not shrink a lens still being dragged.
                  onPressedChange={tabs.length === 1 ? (pressed) => {
                    if (compact || dockNavigationBlocked.current) return;
                    setGlassPressed(pressed);
                    if (pressed) press();
                    else release();
                  } : undefined}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: here }}
                  accessibilityLabel={t(tab.label)}
                  onPress={() => {
                    if (compact || dockNavigationBlocked.current) {
                      expand();
                      return;
                    }
                    // Already here: this is the second press, which is a screen's to
                    // answer (Search puts the cursor in its box). Still navigates,
                    // since there may be a stack on top to drop.
                    selectTab(index);
                  }}
                >
                  <View style={styles.iconBox}>
                    <Icon
                      name={here || from ? ICONS[tab.segment] : `${ICONS[tab.segment]}-outline`}
                      size={30}
                      color={color}
                      style={foregroundShadow}
                    />
                  </View>
                  {showLabels ? (
                    <Text style={[styles.label, here && styles.selectedLabel, { color }, foregroundShadow]} numberOfLines={1}>
                      {t(tab.label)}
                    </Text>
                  ) : null}
                </NavigationItem>
              );
            })}
          </Animated.View>
          </View>
          <Animated.View pointerEvents={compact ? 'box-none' : 'none'}
            accessibilityElementsHidden={!compact} importantForAccessibility={compact ? 'auto' : 'no-hide-descendants'}
            style={[styles.compactContent, { start: rtl ? barWidth - COMPACT_DOCK_SIZE : 0 }, compactContentStyle]}>
            <Pressable style={styles.compactButton} accessibilityRole="button"
              accessibilityLabel={`${t(compactTab.label)}, ${t('Navigation bar')}`}
              onPress={expand}>
              <Icon name={ICONS[compactTab.segment]} size={30} color={colors.accent} style={foregroundShadow} />
            </Pressable>
          </Animated.View>
        </View>
        </GestureDetector>
      </View>
    </Animated.View>
    ) : null}
    {hasSearch && searchTab && blurOn ? (
      <Animated.View pointerEvents={shown ? 'box-none' : 'none'} collapsable={false}
        accessibilityElementsHidden={!shown} importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
        style={[styles.searchFrame, { bottom: insets.bottom + TAB_BAR_BOTTOM_GAP,
          start: rtl ? screenWidth - baseMargin - geometry.searchOffsetX - TAB_BAR_HEIGHT
            : baseMargin + geometry.searchOffsetX }, fadeStyle, searchDockStyle]}>
        <View pointerEvents="box-none" collapsable={false} style={styles.searchCircle}>
          <FloatingGlassBackdrop radius={TAB_BAR_HEIGHT / 2} tint={colors.surface} blurred={blur}
            dockProgress={dockProgress} dockExpandedWidth={TAB_BAR_HEIGHT}
            dockCompactWidth={COMPACT_DOCK_SIZE} dockCompactHeight={COMPACT_DOCK_SIZE} />
          <Pressable style={[styles.searchButton, { width: compact ? COMPACT_DOCK_SIZE : TAB_BAR_HEIGHT,
            height: compact ? COMPACT_DOCK_SIZE : TAB_BAR_HEIGHT,
            start: rtl && compact ? TAB_BAR_HEIGHT - COMPACT_DOCK_SIZE : 0 }]} accessibilityRole="tab"
            accessibilityState={{ selected: current === 'search' }} accessibilityLabel={t('Search')}
            onPress={() => {
              if (current === 'search') reselectTab('search');
              else requestSearchFocus();
              expand();
              go(searchTab.href, searchTab.segment);
            }} />
          <Animated.View pointerEvents="none" style={[styles.searchIcon,
            { top: expandedSearchIconTop }, searchIconStyle]}>
            <Icon name="search" size={30} color={current === 'search' ? colors.accent : colors.text} style={foregroundShadow} />
          </Animated.View>
          {showLabels ? <Animated.View pointerEvents="none" style={[styles.searchLabel, expandedContentStyle]}>
            <Text style={[styles.label, current === 'search' && styles.selectedLabel,
              { color: current === 'search' ? colors.accent : colors.text }, foregroundShadow]} numberOfLines={1}>
              {t('Search')}
            </Text>
          </Animated.View> : null}
        </View>
      </Animated.View>
    ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
  },
  shell: {
    width: '100%',
    height: '100%',
    borderRadius: TAB_BAR_HEIGHT / 2,
  },
  bar: {
    height: '100%',
    borderRadius: TAB_BAR_HEIGHT / 2,
    // The upstream pressed lens grows beyond the resting capsule; its native
    // material clips to its own outline without clipping that elastic shape.
    overflow: 'visible',
  },
  contentClip: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    borderRadius: TAB_BAR_HEIGHT / 2,
    overflow: 'hidden',
  },
  items: {
    position: 'absolute',
    top: INNER_GAP,
    height: TAB_BAR_HEIGHT - INNER_GAP * 2,
    flexDirection: 'row',
  },
  compactContent: {
    position: 'absolute', bottom: 0,
    width: COMPACT_DOCK_SIZE, height: COMPACT_DOCK_SIZE,
  },
  fallbackMaterial: { position: 'absolute', bottom: 0 },
  compactButton: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: COMPACT_DOCK_SIZE / 2,
  },
  searchFrame: {
    position: 'absolute',
    width: TAB_BAR_HEIGHT,
    height: TAB_BAR_HEIGHT,
    borderRadius: TAB_BAR_HEIGHT / 2,
  },
  searchCircle: {
    width: '100%',
    height: '100%',
  },
  searchButton: { position: 'absolute', bottom: 0, borderRadius: TAB_BAR_HEIGHT / 2 },
  searchIcon: { position: 'absolute', left: (TAB_BAR_HEIGHT - 30) / 2, width: 30, height: 30 },
  searchLabel: { position: 'absolute', left: 2, right: 2, top: 40, alignItems: 'center' },
  selection: {
    position: 'absolute',
    start: HORIZONTAL_INSET,
    top: INNER_GAP,
    bottom: INNER_GAP,
    borderRadius: TAB_BAR_HEIGHT / 2 - INNER_GAP,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TAB_BAR_HEIGHT / 2 - INNER_GAP,
    paddingHorizontal: 2,
    gap: 0,
  },
  itemIconOnly: { gap: 0 },
  pressedItem: { transform: [{ scale: 1.2 }] },
  iconBox: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '500' },
  selectedLabel: { fontWeight: '700' },
});
