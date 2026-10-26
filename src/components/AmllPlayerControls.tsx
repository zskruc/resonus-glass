/** Independently drawn native controls for the reviewed AMLL arrangements. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useT } from '@/i18n';
import {
  amllBottomActionLayout, amllMoreButtonSize, amllPlayerControlLayout,
  type AmllBottomAction, type AmllTransportAction,
} from '@/lib/amllPlayerControls';

const WHITE = '#FFFFFF';
const CUTOUT = '#25252D';

/** Original simple native shapes; no reference SVGs or path data are used. */
function AuxiliaryGlyph({ action, selected }: { action: AmllBottomAction; selected: boolean }) {
  if (action === 'output') return (
    <View style={styles.glyph}>
      {[26, 18, 10].map((size) => <View key={size} style={[styles.outputRing,
        { width: size, height: size, borderRadius: size / 2, left: (32 - size) / 2, top: (26 - size) / 2 }]} />)}
      <View style={styles.outputTriangle} />
    </View>
  );
  const ink = selected ? CUTOUT : WHITE;
  if (action === 'lyrics') return (
    <View style={styles.glyph}>
      <View style={[styles.lyricBox, selected && { backgroundColor: WHITE }]}>
        <Text allowFontScaling={false} style={[styles.quotation, { color: ink }]}>”</Text>
      </View>
      <View style={styles.lyricTail} />
    </View>
  );
  return (
    <View style={[styles.glyph, selected && styles.queuePlate]}>
      {[8, 15, 22].map((top) => <View key={top} style={[styles.queueLine, { top }]}>
        <View style={[styles.queueDot, { backgroundColor: ink }]} />
        <View style={[styles.queueRule, { backgroundColor: ink }]} />
      </View>)}
    </View>
  );
}

function MediaButton({ label, size, active, selected, onPress, onLongPress, children }: {
  label: string;
  size: number;
  active: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  useEffect(() => {
    if (!active) { cancelAnimation(scale); scale.set(1); }
    return () => cancelAnimation(scale);
  }, [active, scale]);
  return (
    <Pressable disabled={!active} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !active, ...(selected == null ? {} : { selected }) }}
      onPress={onPress} onLongPress={onLongPress}
      onPressIn={() => scale.set(withSpring(.88, { damping: 18, stiffness: 350 }))}
      onPressOut={() => scale.set(withSpring(1, { damping: 12, stiffness: 260 }))}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={[styles.glyphCenter, animated]}>{children}</Animated.View>
    </Pressable>
  );
}

export interface AmllPlayerBottomActionsProps {
  width: number;
  horizontal: boolean;
  showLyrics: boolean;
  queueOpen?: boolean;
  outputLabel?: string;
  active?: boolean;
  onLyrics: () => void;
  onOutput: () => void;
  onQueue: () => void;
}

/** Portrait: lyrics/output/queue. Landscape: output left, lyrics/queue right. */
export function AmllPlayerBottomActions({ width, horizontal, showLyrics, queueOpen = false,
  outputLabel, active = true, onLyrics, onOutput, onQueue }: AmllPlayerBottomActionsProps) {
  const t = useT();
  const geometry = amllBottomActionLayout(width, horizontal);
  const labels = { lyrics: showLyrics ? t('Show cover') : t('Lyrics'), output: outputLabel || t('Devices'), queue: t('View queue') };
  const handlers = { lyrics: onLyrics, output: onOutput, queue: onQueue };
  const selected = { lyrics: showLyrics, output: false, queue: queueOpen };
  return (
    <ScrollView horizontal scrollEnabled={geometry.scrollable} showsHorizontalScrollIndicator={false}
      bounces={false} style={{ width, height: geometry.height, flexGrow: 0 }}
      contentContainerStyle={{ width: geometry.contentWidth, height: geometry.height }}>
      <View style={{ width: geometry.contentWidth, height: geometry.height }}>
        {geometry.slots.map(({ action, left, size }) => (
          <View key={action} style={{ position: 'absolute', left, top: 0, opacity: .45 }}>
            <MediaButton label={labels[action]} size={size} active={active} selected={selected[action]}
              onPress={handlers[action]}>
              <AuxiliaryGlyph action={action} selected={selected[action]} />
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
  /** Include the times and optional centered quality label in this slot. */
  progress: ReactNode;
  /** Pass the existing system/remote volume row with its visual label hidden. */
  volume?: ReactNode;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onLongPressPlay?: () => void;
}

export function AmllPlayerControls(props: AmllPlayerControlsProps) {
  const { width, viewportHeight, horizontal, fontScale = 1, active = true,
    playing, buffering = false, shuffle, repeat, progress, volume,
    onPrevious, onToggle, onNext, onShuffle, onRepeat, onLongPressPlay } = props;
  const t = useT();
  const layout = amllPlayerControlLayout({ width, viewportHeight, horizontal, fontScale, showVolume: !!volume });
  const labels: Record<AmllTransportAction, string> = {
    previous: t('Previous'), toggle: playing ? t('Pause') : t('Play'), next: t('Next'),
    shuffle: t('Shuffle'), repeat: t('Repeat'),
  };
  const handlers = { previous: onPrevious, toggle: onToggle, next: onNext, shuffle: onShuffle, repeat: onRepeat };
  const glyph = (action: AmllTransportAction) => {
    if (action === 'toggle') return buffering ? <ActivityIndicator color={WHITE} />
      : <Ionicons name={playing ? 'pause' : 'play'} size={layout.playGlyphSize} color={WHITE}
        style={playing ? undefined : { marginLeft: 3 }} />;
    if (action === 'previous' || action === 'next') return <Ionicons
      name={action === 'previous' ? 'play-back' : 'play-forward'} size={layout.skipGlyphSize} color={WHITE} />;
    const checked = action === 'shuffle' ? shuffle : repeat !== 'off';
    return <View style={[styles.modeGlyph, checked && styles.modePlate]}>
      <Ionicons name={action === 'shuffle' ? 'shuffle' : 'repeat'} size={22} color={checked ? CUTOUT : WHITE} />
      {action === 'repeat' && repeat === 'one' ? <Text allowFontScaling={false} style={styles.repeatOne}>1</Text> : null}
    </View>;
  };
  return (
    <View style={{ width, height: layout.height }}>
      <View style={{ height: layout.progressHeight }}>{progress}</View>
      <ScrollView horizontal scrollEnabled={layout.scrollable} showsHorizontalScrollIndicator={false}
        bounces={false} style={{ height: layout.transportHeight, flexGrow: 0 }}
        contentContainerStyle={{ width: layout.contentWidth, height: layout.transportHeight }}>
        <View style={{ width: layout.contentWidth, height: layout.transportHeight }}>
          {layout.slots.map(({ action, left, size }) => <View key={action}
            style={{ position: 'absolute', left, top: layout.transportPaddingTop }}>
            <MediaButton label={labels[action]} size={size} active={active} onPress={handlers[action]}
              selected={action === 'shuffle' ? shuffle : action === 'repeat' ? repeat !== 'off' : undefined}
              onLongPress={action === 'toggle' ? onLongPressPlay : undefined}>
              {glyph(action)}
            </MediaButton>
          </View>)}
        </View>
      </ScrollView>
      {!horizontal ? <AmllPlayerBottomActions {...props} active={active} /> : null}
      {volume ? <View style={{ height: layout.volumeHeight, overflow: 'hidden' }}>{volume}</View> : null}
      {layout.volumeBottomPadding > 0 ? <View style={{ height: layout.volumeBottomPadding }} /> : null}
    </View>
  );
}

/** The reference alone gives More a faint circular background. */
export function AmllPlayerMoreButton({ onPress, viewportWidth, viewportHeight, label, active = true }: {
  onPress: () => void;
  viewportWidth: number;
  viewportHeight: number;
  label?: string;
  active?: boolean;
}) {
  const t = useT();
  const size = amllMoreButtonSize(viewportWidth, viewportHeight);
  return (
    <Pressable onPress={onPress} disabled={!active} accessibilityRole="button"
      accessibilityLabel={label || t('More options')} accessibilityState={{ disabled: !active }}
      style={({ pressed }) => ({ width: Math.max(44, size), height: Math.max(44, size),
        alignItems: 'center', justifyContent: 'center', opacity: pressed ? .6 : 1 })}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFFFFF15',
        alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="ellipsis-horizontal" size={size * .72} color={WHITE} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glyphCenter: { alignItems: 'center', justifyContent: 'center' },
  // Keep the 48dp button's touch area; only the three utility glyphs shrink.
  glyph: { width: 32, height: 32, transform: [{ scale: .75 }] },
  outputRing: { position: 'absolute', borderWidth: 1.7, borderColor: WHITE, borderBottomColor: 'transparent' },
  outputTriangle: { position: 'absolute', left: 9, top: 17, width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: WHITE },
  lyricBox: { position: 'absolute', left: 3, top: 3, width: 26, height: 23,
    borderWidth: 1.8, borderColor: WHITE, borderRadius: 5, alignItems: 'center' },
  quotation: { position: 'absolute', top: -5, fontSize: 30, lineHeight: 33, fontWeight: '700' },
  lyricTail: { position: 'absolute', left: 8, top: 24, width: 0, height: 0,
    borderTopWidth: 5, borderRightWidth: 5, borderTopColor: WHITE, borderRightColor: 'transparent' },
  queuePlate: { backgroundColor: WHITE, borderRadius: 6 },
  queueLine: { position: 'absolute', left: 5, right: 5, height: 2.2, flexDirection: 'row', alignItems: 'center', gap: 3 },
  queueDot: { width: 2.8, height: 2.8, borderRadius: 1.4 },
  queueRule: { flex: 1, height: 2.2, borderRadius: 1.1 },
  modeGlyph: { width: 29, height: 25, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  modePlate: { backgroundColor: WHITE },
  repeatOne: { position: 'absolute', color: CUTOUT, backgroundColor: WHITE, fontSize: 8, lineHeight: 10,
    fontWeight: '700', left: 12, top: 8 },
});
