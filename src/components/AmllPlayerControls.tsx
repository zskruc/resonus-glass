/**
 * SPDX-License-Identifier: AGPL-3.0-only
 * React Native adaptation of AMLL react-full controls, commit 5fee356362353dbb24ce9bea3a62536478040de7.
 * Original MediaButton/ToggleIconButton/MenuButton/PrebuiltLyricPlayer sources and
 * modifications are listed in THIRD_PARTY_NOTICES.md; license: licenses/AMLL-AGPL-3.0.txt.
 */
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';

import { useT } from '@/i18n';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import {
  amllBottomActionLayout, amllMoreButtonSize, amllPlayerControlLayout,
  type AmllTransportAction,
} from '@/lib/amllPlayerControls';
import { motion } from '@/theme/motion';

const WHITE = '#FFFFFF';
const CSS_EASE = Easing.bezier(.25, .1, .25, 1);
const PRESS_TIMING = { easing: CSS_EASE, reduceMotion: motion.reduceMotion.decorative };

// Original SVG geometry with explicit white paint: AndroidSVG's Expo tint
// adapter does not replace currentColor. Asset provenance records this change.
const ICONS: Record<string, ImageSource> = {
  previous: require('../../assets/amll-controls/previous.svg'),
  next: require('../../assets/amll-controls/next.svg'),
  play: require('../../assets/amll-controls/play.svg'),
  pause: require('../../assets/amll-controls/pause.svg'),
  shuffle: require('../../assets/amll-controls/shuffle.svg'),
  'shuffle-active': require('../../assets/amll-controls/shuffle-active.svg'),
  repeat: require('../../assets/amll-controls/repeat.svg'),
  'repeat-active': require('../../assets/amll-controls/repeat-active.svg'),
  'repeat-one-active': require('../../assets/amll-controls/repeat-one-active.svg'),
  'lyrics-off': require('../../assets/amll-controls/lyrics-off.svg'),
  'lyrics-on': require('../../assets/amll-controls/lyrics-on.svg'),
  'queue-off': require('../../assets/amll-controls/queue-off.svg'),
  'queue-on': require('../../assets/amll-controls/queue-on.svg'),
  output: require('../../assets/amll-controls/output.svg'),
  more: require('../../assets/amll-controls/more.svg'),
};

function Glyph({ name, size, rotate = 0 }: { name: string; size: number; rotate?: number }) {
  return <Image source={ICONS[name]} style={{ width: size, height: size,
    transform: rotate ? [{ rotate: `${rotate}deg` }] : undefined }}
    contentFit="contain" transition={0} recyclingKey={name} accessible={false} pointerEvents="none" />;
}

function MediaButton({ label, size, visualSize = size, active, selected, onPress, onLongPress, children, kind = 'media' }: {
  label: string;
  size: number;
  visualSize?: number;
  active: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  children: ReactNode;
  kind?: 'media' | 'toggle' | 'menu';
}) {
  const scale = useSharedValue(1);
  const highlight = useSharedValue(0);
  const live = useRef({ active, mounted: true, hovered: false });
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const background = useAnimatedStyle(() => ({ backgroundColor: 'white', opacity: highlight.get() }));
  useLayoutEffect(() => {
    live.current.active = active;
    if (!active) {
      cancelAnimation(scale); cancelAnimation(highlight); scale.set(1); highlight.set(0);
    }
  }, [active, scale, highlight]);
  useEffect(() => {
    const lifetime = live.current;
    lifetime.mounted = true;
    return () => { lifetime.mounted = false; cancelAnimation(scale); cancelAnimation(highlight); };
  }, [scale, highlight]);
  const canAct = () => live.current.active && live.current.mounted;
  return (
    <Pressable disabled={!active} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !active, ...(selected == null ? {} : { selected }) }}
      onPress={() => {
        if (!canAct()) return;
        onPress();
      }}
      onLongPress={onLongPress ? () => { if (canAct()) onLongPress(); } : undefined}
      onPressIn={() => {
        if (!canAct()) return;
        cancelAnimation(scale);
        scale.set(withTiming(.9, { ...PRESS_TIMING, duration: 80 }));
        highlight.set(withTiming(2 / 15, { ...PRESS_TIMING, duration: 80 }));
      }}
      onPressOut={() => {
        if (!live.current.mounted) return;
        if (!canAct()) { scale.set(1); highlight.set(0); return; }
        scale.set(withTiming(1, { ...PRESS_TIMING, duration: 140 }));
        highlight.set(withTiming(canAct() && live.current.hovered ? 2 / 15 : 0,
          { ...PRESS_TIMING, duration: 140 }));
      }}
      onHoverIn={() => {
        live.current.hovered = true;
        if (canAct()) highlight.set(withTiming(2 / 15, { ...PRESS_TIMING, duration: 80 }));
      }}
      onHoverOut={() => {
        live.current.hovered = false;
        if (live.current.mounted) highlight.set(withTiming(0, { ...PRESS_TIMING, duration: 140 }));
      }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View pointerEvents="none" style={[styles.buttonSurface,
        { width: visualSize, height: visualSize, borderRadius: visualSize / 2 },
        kind === 'menu' && { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: visualSize / 2 }, background]} />
        <Animated.View style={[styles.glyphCenter, animated]}>{children}</Animated.View>
      </View>
    </Pressable>
  );
}

export interface AmllPlayerBottomActionsProps {
  width: number;
  viewportWidth?: number;
  viewportHeight?: number;
  horizontal: boolean;
  showLyrics: boolean;
  queueOpen?: boolean;
  outputLabel?: string;
  active?: boolean;
  onLyrics: () => void;
  onOutput: () => void;
  onQueue: () => void;
}

/** Source row-reverse puts output at left and lyrics/queue at right in landscape. */
export function AmllPlayerBottomActions({ width, viewportWidth = width, viewportHeight = 840, horizontal,
  showLyrics, queueOpen = false, outputLabel, active = true, onLyrics, onOutput, onQueue }: AmllPlayerBottomActionsProps) {
  const t = useT();
  const geometry = amllBottomActionLayout(width, horizontal, viewportWidth, viewportHeight);
  const labels = { lyrics: showLyrics ? t('Show cover') : t('Lyrics'), output: outputLabel || t('Devices'), queue: t('View queue') };
  const handlers = { lyrics: onLyrics, output: onOutput, queue: onQueue };
  const selected = { lyrics: showLyrics, output: false, queue: queueOpen };
  return (
    <ScrollView horizontal scrollEnabled={geometry.scrollable} showsHorizontalScrollIndicator={false}
      bounces={false} style={{ width, height: geometry.height, flexGrow: 0 }}
      contentContainerStyle={{ width: geometry.contentWidth, height: geometry.height }}>
      <View style={{ width: geometry.contentWidth, height: geometry.height }}>
        {geometry.slots.map(({ action, left, size }) => (
          <View key={action} style={{ position: 'absolute', left, top: 0, opacity: selected[action] ? 1 : .8 }}>
            <MediaButton kind="toggle" label={labels[action]} size={size} active={active} selected={selected[action]}
              onPress={handlers[action]}>
              <Glyph name={action === 'output' ? 'output' : `${action === 'queue' ? 'queue' : 'lyrics'}-${selected[action] ? 'on' : 'off'}`}
                size={selected[action] ? geometry.selectedGlyphSize : geometry.glyphSize} />
            </MediaButton>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export interface AmllPlayerControlsProps extends AmllPlayerBottomActionsProps {
  viewportHeight: number;
  fontScale?: number;
  playing: boolean;
  buffering?: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  progress: ReactNode;
  volume?: ReactNode;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onLongPressPlay?: () => void;
}

export function AmllPlayerControls(props: AmllPlayerControlsProps) {
  const { width, viewportWidth = width, viewportHeight, horizontal, fontScale = 1, active = true,
    playing, buffering = false, shuffle, repeat, progress, volume,
    onPrevious, onToggle, onNext, onShuffle, onRepeat, onLongPressPlay } = props;
  const t = useT();
  const layout = amllPlayerControlLayout({ width, viewportWidth, viewportHeight, horizontal, fontScale, showVolume: !!volume });
  const labels: Record<AmllTransportAction, string> = {
    previous: t('Previous'), toggle: playing ? t('Pause') : t('Play'), next: t('Next'),
    shuffle: t('Shuffle'), repeat: t('Repeat'),
  };
  const handlers = { previous: onPrevious, toggle: onToggle, next: onNext, shuffle: onShuffle, repeat: onRepeat };
  const glyph = (action: AmllTransportAction) => {
    if (action === 'toggle') return buffering ? <ActivityIndicator color={WHITE} />
      : <Glyph name={playing ? 'pause' : 'play'} size={layout.playGlyphSize} />;
    if (action === 'previous' || action === 'next') return <Glyph name={action} size={layout.skipGlyphSize} />;
    const selected = action === 'shuffle' ? shuffle : repeat !== 'off';
    return <Glyph name={action === 'shuffle' ? shuffle ? 'shuffle-active' : 'shuffle'
      : repeat === 'one' ? 'repeat-one-active' : repeat === 'all' ? 'repeat-active' : 'repeat'}
    size={selected ? layout.modeSelectedGlyphSize : layout.modeGlyphSize} />;
  };
  return (
    <View style={{ width, height: layout.height }}>
      <View style={{ position: 'absolute', left: horizontal ? 0 : width / 12, right: horizontal ? 0 : width / 12,
        top: 0, height: layout.progressHeight }}>{progress}</View>
      <ScrollView horizontal scrollEnabled={layout.scrollable} showsHorizontalScrollIndicator={false}
        bounces={false} style={{ position: 'absolute', left: 0, top: layout.transportTop,
          width, height: layout.transportHeight, flexGrow: 0 }}
        contentContainerStyle={{ width: layout.contentWidth, height: layout.transportHeight }}>
        <View style={{ width: layout.contentWidth, height: layout.transportHeight }}>
          {layout.slots.map(({ action, left, top, size }) => <View key={action}
            style={{ position: 'absolute', left, top }}>
            <MediaButton label={labels[action]} size={size} active={active} onPress={handlers[action]}
              selected={action === 'shuffle' ? shuffle : action === 'repeat' ? repeat !== 'off' : undefined}
              onLongPress={action === 'toggle' ? onLongPressPlay : undefined}>
              {glyph(action)}
            </MediaButton>
          </View>)}
        </View>
      </ScrollView>
      {!horizontal ? <View style={{ position: 'absolute', left: 0, top: layout.auxiliaryTop }}>
        <AmllPlayerBottomActions {...props} active={active} />
      </View> : null}
      {volume ? <View style={{ position: 'absolute', left: horizontal ? 0 : width / 12, right: horizontal ? 0 : width / 12,
        top: layout.volumeTop, height: layout.volumeHeight, overflow: 'hidden' }}>{volume}</View> : null}
    </View>
  );
}

export function AmllPlayerMoreButton({ onPress, viewportWidth, viewportHeight, label, active = true }: {
  onPress: () => void; viewportWidth: number; viewportHeight: number; label?: string; active?: boolean;
}) {
  const t = useT();
  const size = amllMoreButtonSize(viewportWidth, viewportHeight);
  return <MediaButton kind="menu" onPress={onPress} active={active} label={label || t('More options')}
    size={Math.max(44, size)} visualSize={size}>
    <Glyph name="more" size={size * .72} rotate={viewportHeight >= viewportWidth ? 90 : 0} />
  </MediaButton>;
}

/** The shared favorite transaction with a flat player-only star presentation. */
export function AmllPlayerFavoriteButton({ id, starred, active = true }: {
  id: string; starred?: boolean; active?: boolean;
}) {
  const favorites = useFavoriteIds(active);
  return <View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active}
    importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    <View pointerEvents="none" style={{ position: 'absolute', width: 28, height: 28, borderRadius: 14,
      backgroundColor: 'rgba(255,255,255,0.15)' }} />
    <FavoriteButton id={id} starred={favorites ? favorites.has(id) : starred} glyph="star" size={22}
      selectedColor={WHITE} unselectedColor={WHITE} resetKey={`amll:${id}`} hitSlop={0}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} />
  </View>;
}

const styles = StyleSheet.create({
  glyphCenter: { alignItems: 'center', justifyContent: 'center' },
  buttonSurface: { alignItems: 'center', justifyContent: 'center' },
});
