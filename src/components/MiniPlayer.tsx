/**
 * Compact playback bar above the tab bar. Shows the current song and a
 * play/pause button; tapping it opens the player.
 */
import Icon from '@/components/Icon';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, I18nManager, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  measure,
  useAnimatedRef,
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { COVER, songCoverUrl } from '@/api/data';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { COMPACT_DOCK_GAP, COMPACT_DOCK_SIZE, useLiquidDock } from '@/hooks/useLiquidDock';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { getLiquidDockGeometry } from '@/lib/liquidDock';
import { AMPP_DOCK, amppExpandedAlpha, amppProgress, amppSprungProgress, getAmppDockGeometry } from '@/lib/amppDock';
import { getGlassButtonMotion } from '@/lib/glassButtonMotion';
import { MINI_SWIPE_TRAVEL, miniSwipeDirection, miniSwipeOffset } from '@/lib/miniPlayerSwipe';
import { router } from 'expo-router';
import { miniArtworkMetrics, playerArtworkFlight, playerSurfaceOwner, revealOffset } from '@/lib/playerReveal';
import { pushOnce } from '@/lib/pushOnce';
import { currentSong, useLiveInfo, usePlayerStore } from '@/store/player';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { BOTTOM_BAR_HORIZONTAL_MARGIN, BOTTOM_BAR_MAX_WIDTH, MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT, fontSize, spacing, themed, useThemeMode } from '@/theme';
import { motion } from '@/theme/motion';
import { useBarBlur } from './BarBlur';
import { FloatingGlassBackdrop } from './glass';
import { Cover } from './Cover';
import { FavoriteButton } from './FavoriteButton';
import { MarqueeText } from './MarqueeText';

// AMLL follows LNPopup Automatic: an upward intent snaps open; the full player drags closed.
const DISMISS_Y = 80;
const SWIPE_RETURN = { duration: 180, easing: motion.easing.move, reduceMotion: motion.reduceMotion.decorative };
/** How far up the finger goes before the player starts coming up after it. */
const REVEAL_START = 12;
/** Ignore zeroed activation coordinates and tiny post-activation jitter. */
const AXIS_LOCK_DISTANCE = 2;
/** Past this share of the screen, letting go finishes opening it. */
const REVEAL_COMMIT = 0.2;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const MINI_PRESS_SPRING = { mass: 1, stiffness: 300, damping: Math.sqrt(300), reduceMotion: motion.reduceMotion.decorative };

interface MiniPlayerProps {
  active?: boolean;
  dockProgress?: SharedValue<number>;
  compact?: boolean;
  hasSearch?: boolean;
  dockEnabled?: boolean;
}

export function MiniPlayer(props: MiniPlayerProps = {}) {
  const { width: screenW, height: screenH } = useScreenSize();
  const dock = useLiquidDock();
  const amPlus = dock.amPlus;
  const miniHeight = amPlus ? AMPP_DOCK.miniHeight : MINI_PLAYER_HEIGHT;
  const navHeight = amPlus ? AMPP_DOCK.navigationHeight : TAB_BAR_HEIGHT;
  const compactSize = amPlus ? AMPP_DOCK.compactSize : COMPACT_DOCK_SIZE;
  const margin = amPlus ? AMPP_DOCK.margin : BOTTOM_BAR_HORIZONTAL_MARGIN;
  const controlTop = (miniHeight - 32) / 2;
  const dockProgress = props.dockProgress ?? dock.progress;
  const compact = props.compact ?? dock.compact;
  const hasSearch = props.hasSearch ?? dock.hasSearch;
  const dockEnabled = props.dockEnabled ?? dock.enabled;
  const targetCompact = dockEnabled && compact;
  const visualProgress = useDerivedValue(() => dockEnabled
    ? amPlus ? amppSprungProgress(dockProgress.get()) : amppProgress(dockProgress.get()) : 0);
  const [settledLayout, setSettledLayout] = useState<'expanded' | 'compact' | 'moving'>(targetCompact ? 'compact' : 'expanded');
  // Restore hidden hit targets and marquee scrolling only at the final width.
  // Route coverage pauses the mounted title instead of replacing its text tree.
  useAnimatedReaction(
    () => {
      const raw = dockEnabled ? dockProgress.get() : 0;
      return targetCompact ? raw === 1 ? 'compact' : 'moving' : raw === 0 ? 'expanded' : 'moving';
    },
    (ready, previous) => { if (ready !== previous) scheduleOnRN(setSettledLayout, ready); },
    [targetCompact, dockEnabled, dockProgress],
  );
  const expandedControls = !targetCompact && settledLayout === 'expanded';
  const baseMargin = Math.max(margin, (screenW - BOTTOM_BAR_MAX_WIDTH) / 2);
  const fullWidth = Math.max(0, screenW - baseMargin * 2);
  const rtl = I18nManager.isRTL;
  const geometry = amPlus ? getAmppDockGeometry(fullWidth, 1, hasSearch, rtl)
    : getLiquidDockGeometry(fullWidth, navHeight, compactSize, COMPACT_DOCK_GAP, hasSearch, rtl);
  const compactWidth = geometry.miniWidth;
  const expandedCoverStart = spacing.lg;
  const compactCoverStart = geometry.miniLogicalLeadingSpace + 10;
  const frameRef = useAnimatedRef<View>();
  const artworkRef = useAnimatedRef<Animated.View>();
  const restingArtworkRef = useAnimatedRef<Animated.View>();
  const recordArtwork = useCallback(() => {
    'worklet';
    // Reanimated's Fabric ref starts as null, while measure() only rejects -1.
    // The first reaction can run before either view has attached.
    if (!frameRef() || !artworkRef()) return;
    const frame = measure(frameRef);
    const picture = measure(artworkRef);
    const resting = restingArtworkRef() ? measure(restingArtworkRef) : null;
    if (!frame || !picture || picture.width <= 0 || picture.height <= 0) return;
    const p = visualProgress.get();
    miniArtworkMetrics.set({ viewportWidth: screenW, viewportHeight: screenH,
      miniPlayer: { x: frame.pageX + geometry.miniPhysicalOffsetX * p, y: frame.pageY,
        width: fullWidth + (compactWidth - fullWidth) * p, height: miniHeight, cornerRadius: miniHeight / 2 },
      miniArtwork: { x: picture.pageX, y: picture.pageY, width: picture.width, height: picture.height, cornerRadius: 4 },
      restingArtwork: resting && resting.width > 0 && resting.height > 0
        ? { x: resting.pageX, y: resting.pageY, width: resting.width, height: resting.height, cornerRadius: 4 }
        : undefined,
    });
  }, [frameRef, artworkRef, restingArtworkRef, visualProgress, geometry.miniPhysicalOffsetX, screenW, screenH, fullWidth, compactWidth, miniHeight]);
  useAnimatedReaction(() => visualProgress.get(), () => { recordArtwork(); });
  // Minimized navigation sits physically left and Search sits right;
  // foreground offsets still follow React Native's logical text direction.
  const leadingSpace = geometry.miniLogicalLeadingSpace;
  const targetStart = targetCompact ? leadingSpace : 0;
  const targetWidth = targetCompact ? compactWidth : fullWidth;
  const target = targetCompact ? 1 : 0;
  const physicalDirection = I18nManager.isRTL ? -1 : 1;
  const dark = useThemeMode() === 'dark';
  // Keep glyphs crisp above the lens. Offset/blurred text shadows create a
  // second edge, especially with Android's system bold-text adjustment.
  const foreground = dark ? '#FFFFFF' : '#111113';
  const song = usePlayerStore(currentSong);
  const queueIndex = usePlayerStore((s) => s.index);
  // Radio metadata follows the current track title here; full details stay in the player.
  const live = useLiveInfo(song);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const reset = usePlayerStore((s) => s.reset);
  const t = useT();
  const playerPresentation = useSettings((state) => state.playerPresentation);
  const buttons = useSettings((s) => s.miniPlayerButtons);
  const hasSecondary = buttons !== 'none';
  const hasPrevious = buttons === 'previousNext';
  const coverDistance = compactCoverStart - expandedCoverStart;
  const expandedInfoStart = expandedCoverStart + 30 + spacing.sm;
  const compactInfoStart = compactCoverStart + 30 + spacing.sm;
  const infoDistance = compactInfoStart - expandedInfoStart;
  const expandedPlayStart = fullWidth - spacing.lg - 32 - (hasSecondary ? 32 + spacing.sm : 0);
  const compactPlayStart = leadingSpace + compactWidth - 10 - 32;
  const playDistance = compactPlayStart - expandedPlayStart;
  const targetCoverStart = expandedCoverStart + coverDistance * target - targetStart;
  const targetInfoStart = expandedInfoStart + infoDistance * target - targetStart;
  const targetPlayStart = expandedPlayStart + playDistance * target - targetStart;
  const expandedInfoWidth = Math.max(0, expandedPlayStart - (hasPrevious ? 32 + spacing.sm : 0) - spacing.sm - expandedInfoStart);
  const compactInfoWidth = Math.max(0, compactPlayStart - spacing.sm - compactInfoStart);
  // A narrow transition width prevents a restored long title from covering
  // the moving play button. Restore each full endpoint width only on settling.
  const targetInfoWidth = expandedControls ? expandedInfoWidth
    : targetCompact && settledLayout === 'compact' ? compactInfoWidth
      : Math.min(expandedInfoWidth, compactInfoWidth);
  // Endpoint layout changes once per target. The inverse translation keeps
  // the one live foreground at its interpolated position without remeasuring
  // text, resizing controls, or stretching fonts on every animation frame.
  const coverMotion = useAnimatedStyle(() => ({
    transform: [{ translateX: physicalDirection * coverDistance * (visualProgress.get() - target) }],
  }));
  const titleMotion = useAnimatedStyle(() => ({
    transform: [{ translateX: physicalDirection * infoDistance * (visualProgress.get() - target) }],
  }));
  const playMotion = useAnimatedStyle(() => ({
    transform: [{ translateX: physicalDirection * playDistance * (visualProgress.get() - target) }],
  }));
  const secondaryMotion = useAnimatedStyle(() => ({
    opacity: amPlus ? amppExpandedAlpha(visualProgress.get()) : 1 - visualProgress.get(),
    transform: [{ translateX: physicalDirection * playDistance * (visualProgress.get() - target) }],
  }));

  // Mini-player gestures: swipe left → next, swipe right → previous (same as
  // the player carousel), swipe down → dismiss (stop and clear), swipe up →
  // open the player. The pan is locked to the dominant axis to prevent
  // diagonal movement.
  const buttonPressProgress = useSharedValue(0);
  const buttonPressX = useSharedValue(0);
  const buttonPressY = useSharedValue(0);
  const buttonOffsetX = useSharedValue(0);
  const buttonOffsetY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const gestureAxis = useSharedValue(0);
  const dragging = useSharedValue(false);
  const contentOpacity = useSharedValue(1);
  // Pulled up, the player comes with the finger (see `playerReveal`): it is
  // opened with no animation and `revealOffset` places it.
  const revealing = useSharedValue(false);
  const snappingOpen = useSharedValue(false);
  const dismissing = useSharedValue(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => {
      scheduleOnUI(() => {
        // Android can cancel a pointer without delivering its final frame.
        // Only clear transient mini gestures, never the full player's reveal.
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        cancelAnimation(contentOpacity);
        if (dismissing.get()) {
          dismissing.set(false);
          scheduleOnRN(reset);
        }
        // The legacy player already owns its route after an upward reveal.
        // Finish that handoff rather than leaving it at a partial screen offset.
        if (revealing.get()) {
          cancelAnimation(revealOffset);
          revealOffset.set(withTiming(0, { duration: 0 }, () => revealOffset.set(-1)));
        }
        translateX.set(0);
        translateY.set(0);
        contentOpacity.set(1);
        dragging.set(false);
        gestureAxis.set(0);
        revealing.set(false);
        snappingOpen.set(false);
        buttonPressProgress.set(0);
        buttonOffsetX.set(0);
        buttonOffsetY.set(0);
      });
    });
    return () => subscription.remove();
  }, [translateX, translateY, contentOpacity, dragging, gestureAxis, revealing, snappingOpen, dismissing, reset,
    buttonPressProgress, buttonOffsetX, buttonOffsetY]);
  const startReveal = () => pushOnce(playerPresentation === 'amll' ? '/player?reveal=1&artwork=1' : '/player?reveal=1');
  const openPlayer = () => {
    if (playerPresentation === 'amll') scheduleOnUI(recordArtwork);
    pushOnce(playerPresentation === 'amll' ? '/player?artwork=1' : '/player');
  };
  // Down at the bottom, out of sight: it is let go of (`revealOffset` back to
  // -1) by the player as it unmounts, or it would flash back up for a frame.
  const cancelReveal = () => {
    if (router.canGoBack()) router.back();
    else revealOffset.value = -1;
  };
  const pan = Gesture.Pan()
    .minDistance(10)
    .onBegin((event) => {
      if (!amPlus) return;
      buttonPressX.set(event.x);
      buttonPressY.set(event.y);
      buttonOffsetX.set(0);
      buttonOffsetY.set(0);
      buttonPressProgress.set(withSpring(1, MINI_PRESS_SPRING));
    })
    .onStart(() => {
      // Android RNGH resets translation when Pan becomes ACTIVE. Choose the
      // dominant axis on its first real update instead of treating 0/0 as X.
      gestureAxis.value = 0;
      dragging.value = true;
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      dismissing.set(false);
    })
    .onUpdate((e) => {
      if (amPlus) {
        buttonPressX.set(e.x);
        buttonPressY.set(e.y);
        buttonOffsetX.set(e.translationX);
        buttonOffsetY.set(e.translationY);
      }
      if (snappingOpen.get()) return;
      // Once the legacy player is coming up, the pull is only ever vertical.
      if (revealing.value) {
        revealOffset.value = Math.min(screenH, Math.max(0, screenH + e.translationY + REVEAL_START));
        return;
      }
      if (gestureAxis.value === 0) {
        const x = Math.abs(e.translationX);
        const y = Math.abs(e.translationY);
        if (Math.max(x, y) <= AXIS_LOCK_DISTANCE) return;
        // Lock once: a later diagonal path cannot change skip into reveal.
        gestureAxis.value = x >= y ? 1 : 2;
      }
      if (gestureAxis.value === 1) {
        translateX.value = miniSwipeOffset(e.translationX);
        translateY.value = 0;
      } else if (e.translationY >= 0) {
        translateY.value = e.translationY;
        translateX.value = 0;
      } else {
        translateX.value = 0;
        translateY.value = 0;
        if (e.translationY < -REVEAL_START) {
          recordArtwork();
          if (playerPresentation === 'amll') {
            snappingOpen.set(true);
            scheduleOnRN(openPlayer);
            return;
          }
          revealing.value = true;
          revealOffset.value = screenH;
          scheduleOnRN(startReveal);
        }
      }
    })
    .onEnd((e, success) => {
      if (!success || !dragging.get()) return;
      dragging.value = false;
      if (snappingOpen.get()) return;
      const horizontal = !revealing.value && gestureAxis.value === 1;
      if (horizontal) {
        const width = fullWidth + (compactWidth - fullWidth) * visualProgress.get();
        const direction = miniSwipeDirection(e.translationX, e.velocityX, width);
        if (direction === -1) scheduleOnRN(next);
        else if (direction === 1) scheduleOnRN(previous);
        // Always settle, including the queue boundary or a previous-song restart.
        translateX.value = withTiming(0, SWIPE_RETURN);
        translateY.value = 0;
      } else if (revealing.value) {
        revealing.value = false;
        const opened = -e.translationY > screenH * REVEAL_COMMIT || e.velocityY < -600;
        if (opened) {
          revealOffset.value = withTiming(0, { duration: motion.duration.move }, () => {
            revealOffset.value = -1;
          });
        } else {
          revealOffset.value = withTiming(screenH, { duration: motion.duration.move }, (f) => {
            if (f) scheduleOnRN(cancelReveal);
            else revealOffset.value = -1;
          });
        }
      } else if (e.translationY > DISMISS_Y || e.velocityY > 800) {
        dismissing.set(true);
        translateY.value = withTiming(screenH, { duration: motion.duration.move }, (finished) => {
          if (finished && dismissing.get()) {
            dismissing.set(false);
            scheduleOnRN(reset);
          }
        });
      } else {
        translateX.value = withTiming(0, SWIPE_RETURN);
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    })
    // A pull that was cut off (the system took the touch) still ends somewhere:
    // opened, since the player is already up on the screen.
    .onFinalize((_e, success) => {
      if (amPlus) {
        buttonPressProgress.set(withSpring(0, MINI_PRESS_SPRING));
        buttonOffsetX.set(withSpring(0, MINI_PRESS_SPRING));
        buttonOffsetY.set(withSpring(0, MINI_PRESS_SPRING));
      }
      dragging.value = false;
      gestureAxis.value = 0;
      if (snappingOpen.get()) { snappingOpen.set(false); return; }
      if (!revealing.value) {
        if (!success) {
          translateX.value = withTiming(0, SWIPE_RETURN);
          translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
        }
        return;
      }
      revealing.value = false;
      revealOffset.value = withTiming(0, { duration: motion.duration.move }, () => {
        revealOffset.value = -1;
      });
    });
  // Dismissal moves the card down; AM++ adds its small elastic press transform.
  const cardStyle = useAnimatedStyle(() => {
    if (!amPlus) return {
      transform: [{ translateY: translateY.value }],
      opacity: interpolate(translateY.value, [0, screenW * 0.6], [1, 0], Extrapolation.CLAMP),
    };
    const width = fullWidth + (compactWidth - fullWidth) * visualProgress.get();
    const pressed = getGlassButtonMotion(width, miniHeight, buttonPressProgress.get(), buttonOffsetX.get(), buttonOffsetY.get());
    return {
      transform: [{ translateY: translateY.value }, { translateX: amPlus ? pressed.x : 0 },
        { translateY: amPlus ? pressed.y : 0 }, { scaleX: amPlus ? pressed.scaleX : 1 },
        { scaleY: amPlus ? pressed.scaleY : 1 }],
      opacity: interpolate(translateY.value, [0, screenW * 0.6], [1, 0], Extrapolation.CLAMP),
    };
  });
  // Each moving detail clips inside its own frame; the dock's geometry stays fixed.
  const detailsStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value * interpolate(Math.abs(translateX.value), [0, MINI_SWIPE_TRAVEL], [1, 0.65], Extrapolation.CLAMP),
  }));
  const coverSwipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: playerArtworkFlight.get()?.owner === playerSurfaceOwner.get() && playerSurfaceOwner.get() > 0 ? 0 : 1,
  }));
  const titleSwipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const trackKey = `${queueIndex}:${song?.id ?? ''}`;
  const lastTrack = useRef(trackKey);
  // Store commits can be delayed or keep the same song. Never await a skip or
  // hide the UI waiting for playback; animate only an actual current-item change.
  useLayoutEffect(() => {
    if (lastTrack.current === trackKey) return;
    lastTrack.current = trackKey;
    contentOpacity.value = 0.65;
    contentOpacity.value = withTiming(1, { ...SWIPE_RETURN, duration: 160 });
    if (!dragging.value) {
      translateX.value = withTiming(0, SWIPE_RETURN);
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
    }
  }, [trackKey, contentOpacity, dragging, translateX, translateY]);

  // A radio has no album, but the station may carry its own image.
  const cover = song ? songCoverUrl(song, COVER.thumb) : undefined;
  const marqueeTitles = useSettings((s) => s.marqueeTitles);
  const blur = useBarBlur('miniPlayer');
  // Not "unless the file is on the phone": see the player screen, which had the
  // same test in the same two places and the same hole under it.
  const favIds = useFavoriteIds(!!song && buttons === 'favorite');

  if (!song) return null;

  // The central list wins when loaded; `song.starred` from the queue becomes
  // stale (only kept as backup for local files or while loading).
  const favorited = favIds ? favIds.has(song.id) : !!song.starred;

  return (
    <View ref={frameRef} collapsable={false} onLayout={() => scheduleOnUI(recordArtwork)} pointerEvents="box-none"
      style={[styles.frame, { height: miniHeight, marginStart: baseMargin, marginEnd: baseMargin }]}>
      {/* Mirror the image's Yoga hierarchy outside press/swipe transforms.
          Native measurement preserves the exact physical-pixel rounding. */}
      <View collapsable={false} pointerEvents="none" accessible={false} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" style={[styles.card, { position: 'absolute', top: 0, height: miniHeight }]}>
        <View collapsable={false}
          style={[styles.hitArea, { start: targetStart, width: targetWidth, height: miniHeight }]}>
          <Animated.View collapsable={false} style={styles.details}>
            <Animated.View collapsable={false}
              style={[styles.artwork, { start: targetCoverStart, top: (miniHeight - 30) / 2 }, coverMotion]}>
              <Animated.View ref={restingArtworkRef} collapsable={false}
                onLayout={() => scheduleOnUI(recordArtwork)} style={{ width: 30, height: 30 }} />
            </Animated.View>
          </Animated.View>
        </View>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View pointerEvents="box-none" collapsable={false} style={[styles.card, { height: miniHeight }, cardStyle]}>
          {/* Native material morphs inside fixed bounds. It must not inherit
              the one-time hit rectangle's compact width a second time. */}
          <FloatingGlassBackdrop target="miniPlayer" radius={miniHeight / 2} blurred={blur}
            dockProgress={visualProgress} dockExpandedWidth={fullWidth}
            dockCompactWidth={dockEnabled ? compactWidth : fullWidth} dockCompactHeight={miniHeight}
            dockRole={amPlus ? 'mini' : undefined} dockRowWidth={amPlus ? fullWidth : undefined}
            buttonPressProgress={amPlus ? buttonPressProgress : undefined}
            buttonPressX={amPlus ? buttonPressX : undefined} buttonPressY={amPlus ? buttonPressY : undefined}
            dockCompactOffsetX={dockEnabled ? geometry.miniPhysicalOffsetX : 0} />
          <Pressable
            collapsable={false}
            style={[styles.hitArea, { start: targetStart, width: targetWidth, height: miniHeight, borderRadius: miniHeight / 2 }]}
            onPress={openPlayer}
          >
            <Animated.View pointerEvents="none" style={[styles.details, detailsStyle]}>
              <Animated.View style={[styles.artwork, { start: targetCoverStart, top: (miniHeight - 30) / 2 }, coverMotion]}>
                <Animated.View ref={artworkRef} collapsable={false} style={coverSwipeStyle}>
                  <Cover uri={cover} size={30} transition={0} autoplay={props.active ?? true} preferStatic={false}
                    style={styles.cover} placeholderIcon={song.url ? 'radio' : 'musical-notes'} />
                </Animated.View>
              </Animated.View>
              <Animated.View style={[styles.titleFrame, { start: targetInfoStart, width: targetInfoWidth, top: (miniHeight - 20) / 2 }, titleMotion]}>
                <Animated.View style={[styles.titleContent, titleSwipeStyle]}>
                  {marqueeTitles ? <MarqueeText
                    text={live?.title ?? song.title}
                    style={[styles.title, { color: foreground }]}
                    enabled={expandedControls}
                    active={props.active ?? true}
                  /> : <Text style={[styles.title, { color: foreground }]} numberOfLines={1}>
                    {live?.title ?? song.title}
                  </Text>}
                </Animated.View>
              </Animated.View>
            </Animated.View>
            {buttons === 'previousNext' ? (
              <Animated.View style={[styles.secondary, { start: targetPlayStart - 32 - spacing.sm, top: controlTop }, secondaryMotion]}
                pointerEvents={expandedControls ? 'auto' : 'none'} accessibilityElementsHidden={!expandedControls}
                importantForAccessibility={expandedControls ? 'auto' : 'no-hide-descendants'}>
                <Pressable style={styles.control} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('Previous')}
                  onPress={(event) => { event.stopPropagation(); previous(); }}>
                  <Icon name="play-back" size={28} color={foreground} />
                </Pressable>
              </Animated.View>
            ) : null}
            <AnimatedPressable
              style={[styles.control, styles.playControl, { start: targetPlayStart, top: controlTop }, playMotion]}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('Pause') : t('Play')}
              onPress={(event) => { event.stopPropagation(); toggle(); }}
              // Real stop: stops and clears queue, mini player, and notification.
              onLongPress={() => {
                haptic('medium');
                void usePlayerStore
                  .getState()
                  .stopAndClear()
                  .then((undo) => {
                    if (undo) {
                      useToast.getState().show(t('Playback stopped'), { label: t('Undo'), run: undo });
                    }
                  });
              }}
            >
              {isBuffering ? (
                <ActivityIndicator size="small" color={foreground} style={styles.spinner} />
              ) : (
                <Icon name={isPlaying ? 'pause' : 'play'} size={24} color={foreground} />
              )}
            </AnimatedPressable>
            {buttons === 'favorite' ? (
              <Animated.View style={[styles.secondary, { start: targetPlayStart + 32 + spacing.sm, top: controlTop }, secondaryMotion]}
                pointerEvents={expandedControls ? 'auto' : 'none'} accessibilityElementsHidden={!expandedControls}
                importantForAccessibility={expandedControls ? 'auto' : 'no-hide-descendants'}>
                <View style={styles.control}>
                  <FavoriteButton id={song.id} starred={favorited} size={24} unselectedColor={foreground}
                    playlistSong={props.active === false || !expandedControls ? undefined : song} />
                </View>
              </Animated.View>
            ) : null}
            {buttons === 'next' || buttons === 'previousNext' ? (
              <Animated.View style={[styles.secondary, { start: targetPlayStart + 32 + spacing.sm, top: controlTop }, secondaryMotion]}
                pointerEvents={expandedControls ? 'auto' : 'none'} accessibilityElementsHidden={!expandedControls}
                importantForAccessibility={expandedControls ? 'auto' : 'no-hide-descendants'}>
                <Pressable style={styles.control} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('Next')}
                  onPress={(event) => { event.stopPropagation(); next(); }}>
                  <Icon name="play-forward" size={28} color={foreground} />
                </Pressable>
              </Animated.View>
            ) : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = themed((colors) => ({
  frame: { height: MINI_PLAYER_HEIGHT },
  card: { width: '100%', height: MINI_PLAYER_HEIGHT },
  // This rectangle changes only when the target changes. The wide decorative
  // host is box-none, so compact navigation/search retain their own hit areas.
  hitArea: { position: 'absolute', top: 0, height: MINI_PLAYER_HEIGHT, borderRadius: MINI_PLAYER_HEIGHT / 2 },
  details: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  artwork: { position: 'absolute', top: 9, width: 30, height: 30, borderRadius: 4, overflow: 'hidden' },
  cover: { borderRadius: 4 },
  titleFrame: { position: 'absolute', top: (MINI_PLAYER_HEIGHT - 20) / 2, height: 20, overflow: 'hidden' },
  titleContent: { width: '100%', height: 20 },
  secondary: { position: 'absolute', top: 8, width: 32, height: 32, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playControl: { position: 'absolute', top: 8 },
  control: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  spinner: { width: 24, height: 24 },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 20,
    includeFontPadding: false,
    fontWeight: '400',
  },
}));
