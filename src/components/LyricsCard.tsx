/**
 * Spotify/Apple Music style lyrics for the player: card below the controls
 * with the cover's dominant color. Inside, karaoke with auto-scroll if the
 * lyrics are synced (tapping a line seeks to that point) and animated focus on
 * the current line (the rest are dimmed). Button to expand to full screen
 * (/lyrics). If the song has no lyrics, nothing is rendered.
 */
import Icon from '@/components/Icon';
import { GlassSurface, GlassPressable } from '@/components/glass';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { COVER, songCoverUrl } from '@/api/data';
import { useCoverRadius } from '@/components/Cover';
import { KaraokeWords } from '@/components/KaraokeWords';
import { type LyricLine, type LyricWord } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { amllLyricBlurRadius, lyricBlurRadius } from '@/lib/lyricMotion';
import { retainedLyricFocus } from '@/lib/lyricLifecycle';
import { pushOnce } from '@/lib/pushOnce';
import { currentSong, usePlayerStore } from '@/store/player';
import {
  LYRICS_SIZE_DEFAULT,
  type LyricsSize,
  type LyricsWeight,
  useSettings,
} from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { motion } from '@/theme/motion';

export function LyricsCard() {
  const t = useT();
  const song = usePlayerStore(currentSong);
  const { data } = useLyrics(song ?? undefined);
  // Same setting as the full screen; without color, neutral gray (surface)
  // so the card still stands out from the player background.
  // Its own setting (no blurred-cover option): `bg` doubles as the solid
  // `fadeColor` the synced lyrics fade into, which an image can't provide.
  const tinted = useSettings((s) => s.lyricsCardBackground) !== 'none';
  const dominant = useDominantColor(
    // Without color the palette is not extracted (same savings the player does).
    tinted ? song ? songCoverUrl(song, COVER.card) : undefined : undefined,
  );
  const bg = tinted ? dominant : colors.surface;
  const lineStyle = useLyricsLineStyle();
  const centered = useSettings((s) => s.lyricsAlign) === 'center';

  if (!data) return null;

  return (
    <GlassSurface tint={bg} style={[styles.card, { backgroundColor: bg }]}>
      <Text style={styles.title}>{t('Lyrics')}</Text>
      <View style={styles.body}>
        {data.synced ? (
          <SyncedLyricsView lines={data.lines} nested fadeColor={bg} />
        ) : (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.content, centered && styles.contentCentered]}
          >
            <Text style={lineStyle}>{data.lines.map((l) => l.value).join('\n')}</Text>
          </ScrollView>
        )}
      </View>
      <GlassPressable
        variant="prominent" tint={colors.text}
        style={({ pressed }) => [styles.expand, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('Lyrics')}
        hitSlop={8}
        onPress={() => pushOnce('/lyrics')}
      >
        <Icon name="expand-outline" size={16} color={colors.onInverse} />
      </GlassPressable>
    </GlassSurface>
  );
}

/**
 * Lyrics in place of the cover art ("Lyrics on the cover" setting): occupies
 * the same box as the player cover. Same karaoke as the card, with a button
 * in the corner to go back to the cover. Shows a spinner while fetching and
 * an empty message if no lyrics are available.
 */
export function CoverLyrics({ size, onClose }: { size: number; onClose: () => void }) {
  const t = useT();
  const corner = useCoverRadius(size);
  const song = usePlayerStore(currentSong);
  const { data, isLoading } = useLyrics(song ?? undefined);
  const lineStyle = useLyricsLineStyle();
  const centered = useSettings((s) => s.lyricsAlign) === 'center';

  return (
    // Transparent background: the lyrics go directly over the player background
    // (the cover is hidden while showing).
    <View style={[styles.coverBox, { width: size, height: size, borderRadius: corner }]}>
      <View style={styles.coverBody}>
        {isLoading ? (
          <View style={styles.coverStatus}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : data?.synced ? (
          <SyncedLyricsView lines={data.lines} nested />
        ) : data ? (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.content, centered && styles.contentCentered]}
          >
            <Text style={lineStyle}>{data.lines.map((l) => l.value).join('\n')}</Text>
          </ScrollView>
        ) : (
          <View style={styles.coverStatus}>
            <Text style={styles.coverEmpty}>{t('No lyrics available for this song.')}</Text>
          </View>
        )}
      </View>
      <GlassPressable
        variant="prominent" tint={colors.text}
        style={({ pressed }) => [styles.expand, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('Show cover')}
        hitSlop={8}
        onPress={onClose}
      >
        <Icon name="image-outline" size={16} color={colors.onInverse} />
      </GlassPressable>
    </View>
  );
}

/**
 * Reusable karaoke list (card and full screen): the current line lights up
 * and grows a little, the rest are dimmed. Auto-scroll keeps the
 * focus above; manual scroll pauses it for a few seconds. Tapping a line
 * seeks to that point in the song.
 */
export function SyncedLyricsView({
  lines,
  large,
  nested,
  fadeColor,
  appearance = 'default',
  focusAnchor,
  active = true,
  onLinePress,
}: {
  lines: LyricLine[];
  /** Large typography (full screen). */
  large?: boolean;
  /** Inside another scroll (the player card). */
  nested?: boolean;
  /** Color to which the top/bottom edges fade (the background). */
  fadeColor?: string;
  /** White, left-aligned lyrics for the player's animated dark backdrop. */
  appearance?: 'default' | 'amll';
  /** Active-line top as a fraction of this viewport, independent of layout orientation. */
  focusAnchor?: number;
  /** Keep the last lyric frame mounted, but stop scrolling, highlighting and seeking. */
  active?: boolean;
  /** Optional player action; without it, every existing lyric surface only seeks. */
  onLinePress?: (seconds: number) => void;
}) {
  const amll = appearance === 'amll';
  // The line, not the position: the position moves twice a second and the
  // line every few, and only a new line has anything to redraw.
  const wordTimed = lines.some((line) => line.words && line.words.length > 0);
  const currentRef = useRef(-1);
  const activeRef = useRef(active);
  const current = usePlayerStore((s) => {
    // Retain the upstream line-only subscription and the PR's word pre-roll.
    return retainedLyricFocus(lines, s.positionSec, wordTimed, active, currentRef.current);
  });
  const seekTo = usePlayerStore((s) => s.seekTo);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // Real scroll position (regardless of who moved it: user or auto-scroll).
  const liveY = useScrollViewOffset(scrollRef);
  // Auto-scroll target. Animated with Reanimated (not native smooth-scroll) for
  // two reasons: native respects the system animation scale (with "reduced
  // motion" it snaps abruptly) and while running, the ScrollView swallows taps
  // on the lines.
  const targetY = useSharedValue(0);
  const offsets = useRef<{ y: number; h: number }[]>([]);
  const userScroll = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewH, setViewH] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  useLayoutEffect(() => {
    if (active) {
      if (!activeRef.current) {
        // Resume an externally retained screen, releasing its old manual-scroll timeout.
        setBrowsing(false);
      }
      currentRef.current = current;
    }
    activeRef.current = active;
  }, [active, current]);
  /**
   * Bumped when the line being aimed at finally reports where it is.
   *
   * The positioning below waits for that, and reads it out of a ref, and a ref
   * filling up re-renders nothing: opening the lyrics part way through a song
   * left them at the top, because by the time the line answered there was
   * nothing listening. What ran the positioning next was the song moving on a
   * line, so they sat still and then travelled, one line late, every time. Now
   * the measurement says so itself.
   */
  const [placed, setPlaced] = useState(0);
  /** The line already positioned for, so a measurement only speaks up once. */
  const placedFor = useRef(-1);
  // In full screen we anchor the active line near the center (and pad
  // top/bottom) so that when the song starts, the lyrics begin centered and
  // readable, not stuck to the top edge. On the small card, higher up.
  const anchor = focusAnchor !== undefined && Number.isFinite(focusAnchor)
    ? Math.max(0, Math.min(1, focusAnchor)) : amll ? 0.1 : large ? 0.42 : 0.3;
  const size = useSettings((s) => s.lyricsSize);
  const weight = useSettings((s) => s.lyricsWeight);
  const alignment = useSettings((s) => s.lyricsAlign);
  const centered = !amll && alignment === 'center';
  const blurInactiveLyrics = useSettings((s) => s.blurInactiveLyrics);
  const blurEnabled = Platform.OS === 'android' && blurInactiveLyrics && !browsing;

  const onMeasure = useCallback((index: number, y: number, h: number) => {
    const previous = offsets.current[index];
    offsets.current[index] = { y, h };
    // The active row speaks once when it first appears, then again only if a
    // typography change actually moved or resized it. That recentres a line
    // immediately after the listener changes the font size without turning
    // every ordinary layout pass into another render.
    const changed = previous === undefined || previous.y !== y || previous.h !== h;
    if (activeRef.current && index === currentRef.current && (placedFor.current !== index || changed)) {
      setPlaced((n) => n + 1);
    }
  }, []);

  // Each targetY change pushes the scroll from the UI thread.
  useAnimatedReaction(
    () => targetY.value,
    (y, prev) => {
      if (active && prev !== null && y !== prev) scrollTo(scrollRef, 0, y, false);
    },
  );

  // Tapping a line is an intentional seek: we cancel the auto-scroll pause
  // triggered by manual scroll (the user usually scrolled to reach this
  // line), so the focus recenters on the chosen line instantly.
  const onLineTap = useCallback(
    (sec: number) => {
      if (!activeRef.current) return;
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      userScroll.current = false;
      setBrowsing(false);
      if (onLinePress) onLinePress(sec);
      else seekTo(sec);
    },
    [seekTo, onLinePress],
  );

  // Taps are detected with a separate gesture (not each line's onPress): the
  // gesture coexists with scroll and works even while auto-scroll is active.
  // The line is located by vertical position using actual measurements.
  const handleTap = useCallback(
    (yInView: number) => {
      const contentY = yInView + liveY.value;
      for (let i = 0; i < lines.length; i++) {
        const m = offsets.current[i];
        if (m && contentY >= m.y && contentY < m.y + m.h) {
          if (lines[i].start !== undefined) onLineTap(lines[i].start! / 1000);
          return;
        }
      }
    },
    [lines, onLineTap, liveY],
  );

  const tapGesture = Gesture.Tap()
    .enabled(active)
    .maxDuration(300)
    // eslint-disable-next-line react-hooks/refs -- RNGH invokes this after a native gesture; the callback reads the committed activity gate then.
    .onEnd((e, success) => {
      if (success) scheduleOnRN(handleTap, e.y);
    });

  useLayoutEffect(() => {
    if (!active) {
      cancelAnimation(targetY);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
      userScroll.current = false;
      return;
    }
    if (current < 0 || viewH === 0 || userScroll.current) return;
    const m = offsets.current[current];
    if (m === undefined) return;
    const dest = Math.max(0, m.y - viewH * anchor);
    cancelAnimation(targetY);
    placedFor.current = current;
    // We start from the real position (the user may have scrolled) and animate
    // ourselves: same path on any device, regardless of whether the system
    // ignores animations. Opening part way through a song is the same journey
    // as any other, taken as soon as there is somewhere to go rather than at
    // the next line.
    targetY.set(liveY.get());
    targetY.set(withTiming(dest, {
      duration: motion.duration.scroll,
      easing: motion.easing.move,
      reduceMotion: motion.reduceMotion.essential,
    }));
    return () => cancelAnimation(targetY);
  }, [current, viewH, anchor, targetY, liveY, placed, active]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  const fadeH = amll ? Math.min(64, viewH > 0 ? viewH * 0.18 : 64) : large ? 56 : 36;

  const lyrics = (
    <GestureDetector gesture={tapGesture}>
      <Animated.ScrollView
        ref={scrollRef}
        scrollEnabled={active}
        nestedScrollEnabled={nested}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onScrollBeginDrag={() => {
          if (!activeRef.current) return;
          userScroll.current = true;
          setBrowsing(true);
          cancelAnimation(targetY);
          if (resumeTimer.current) clearTimeout(resumeTimer.current);
        }}
        onScrollEndDrag={() => {
          if (!activeRef.current) return;
          resumeTimer.current = setTimeout(() => {
            if (!activeRef.current) return;
            userScroll.current = false;
            setBrowsing(false);
          }, 3000);
        }}
        contentContainerStyle={[
          styles.content,
          amll && styles.amllContent,
          centered && styles.contentCentered,
          // Padding so the first/last line can rest at the anchor (center)
          // instead of being stuck at the top/bottom. Full screen only.
          (large || amll) && viewH > 0 ? { paddingTop: viewH * anchor, paddingBottom: viewH * (1 - anchor) } : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {lines.map((line, i) => (
          <LyricRow
            key={i}
            index={i}
            text={line.value.trim() || '♪'}
            words={line.words}
            highlighted={i === current}
            active={active}
            past={current >= 0 && i < current}
            blurRadius={amll ? amllLyricBlurRadius(i, current, blurEnabled) : lyricBlurRadius(i, current, blurEnabled)}
            large={large}
            size={size}
            weight={weight}
            centered={centered}
            appearance={appearance}
            onMeasure={onMeasure}
          />
        ))}
      </Animated.ScrollView>
    </GestureDetector>
  );

  return (
    <View style={styles.wrap}>
      {amll && Platform.OS !== 'web' ? (
        <MaskedView
          style={styles.wrap}
          androidRenderingMode="hardware"
          maskElement={(
            <View pointerEvents="none" style={styles.wrap}>
              <LinearGradient colors={['transparent', '#000000']} style={{ height: fadeH }} />
              <View style={styles.maskSolid} />
              <LinearGradient colors={['#000000', 'transparent']} style={{ height: fadeH }} />
            </View>
          )}
        >
          {lyrics}
        </MaskedView>
      ) : lyrics}
      {!amll && fadeColor ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={[fadeColor, `${fadeColor}00`]}
            style={[styles.fade, { top: 0, height: fadeH }]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[`${fadeColor}00`, fadeColor]}
            style={[styles.fade, { bottom: 0, height: fadeH }]}
          />
        </>
      ) : null}
    </View>
  );
}

/** A lyric line with animated focus. */
const LyricRow = memo(({
  index,
  text,
  words,
  highlighted,
  active = true,
  past,
  blurRadius,
  large,
  size,
  weight,
  centered,
  appearance = 'default',
  onMeasure,
}: {
  index: number;
  text: string;
  words?: LyricWord[];
  highlighted: boolean;
  active?: boolean;
  /** Lines before the current one: same colour as active, slightly dimmer. */
  past: boolean;
  /** Primuse-style depth blur; zero keeps the row's filter layer disabled. */
  blurRadius: number;
  large?: boolean;
  size: LyricsSize;
  weight: LyricsWeight;
  centered: boolean;
  appearance?: 'default' | 'amll';
  onMeasure: (index: number, y: number, h: number) => void;
}) => {
  // Memoized, so the screen repainting is not enough to bring this one along.
  useTheme();
  const amll = appearance === 'amll';
  // Primuse's line takeover coordinates scale and opacity with auto-scroll.
  // Blur takes a gentler path because Android's filter is visually stronger
  // and a fast change reads as the completed line suddenly losing focus.
  const focus = useSharedValue(highlighted ? 1 : 0);
  const inactiveOpacity = amll ? past ? 0.32 : 0.42 : past ? 0.36 : 0.46;
  const dim = useSharedValue(highlighted ? 1 : inactiveOpacity);
  const blur = useSharedValue(blurRadius);
  useLayoutEffect(() => {
    cancelAnimation(focus);
    if (!active) return;
    focus.value = withTiming(highlighted ? 1 : 0, {
      duration: motion.duration.scroll,
      easing: motion.easing.move,
      reduceMotion: motion.reduceMotion.essential,
    });
    return () => cancelAnimation(focus);
  }, [active, highlighted, focus]);
  useLayoutEffect(() => {
    cancelAnimation(dim);
    if (!active) return;
    dim.value = withTiming(highlighted ? 1 : inactiveOpacity, {
      duration: motion.duration.scroll,
      easing: motion.easing.move,
      reduceMotion: motion.reduceMotion.essential,
    });
    return () => cancelAnimation(dim);
  }, [active, highlighted, inactiveOpacity, dim]);
  useLayoutEffect(() => {
    cancelAnimation(blur);
    if (!active) return;
    blur.value = withTiming(blurRadius, {
      duration: motion.duration.depth,
      easing: motion.easing.depth,
      reduceMotion: motion.reduceMotion.essential,
    });
    return () => cancelAnimation(blur);
  }, [active, blur, blurRadius]);
  // The growth (8%) is compensated by the right margin of `content` so the
  // active line, scaling from the left, doesn't overflow the edge.
  const anim = useAnimatedStyle(() => {
    const radius = blur.value;
    return {
      opacity: dim.value,
      transform: [{ scale: 1 + focus.value * (amll ? 0.04 : 0.08) }],
      // RN's Android filter clips descendants. AMLL also releases a filter
      // immediately outside its focus window, rather than keeping an old
      // offscreen layer alive while its blur value animates back to zero.
      filter: radius > 0.01 && (!amll || blurRadius > 0) ? [{ blur: radius }] : [],
    };
  });
  const lineStyle = amll ? amllLyricsLineStyle(size, weight) : lyricsLineStyle(large, size, weight, centered);
  const flattened = StyleSheet.flatten<TextStyle>(lineStyle);
  const wordTextStyle: TextStyle = {
    fontFamily: flattened.fontFamily,
    fontSize: flattened.fontSize,
    fontStyle: flattened.fontStyle,
    fontWeight: flattened.fontWeight,
    letterSpacing: flattened.letterSpacing,
    lineHeight: flattened.lineHeight,
  };
  const paddingVertical = typeof flattened.paddingVertical === 'number'
    ? flattened.paddingVertical
    : 0;

  return (
    <View
      onLayout={(e) => onMeasure(index, e.nativeEvent.layout.y, e.nativeEvent.layout.height)}
    >
      <Animated.View style={[centered ? styles.centerOrigin : styles.leftOrigin, anim]}>
        {words && words.length > 0 ? (
          <KaraokeWords
            words={words}
            highlighted={highlighted}
            active={active}
            centered={centered}
            textStyle={wordTextStyle}
            activeColor={amll ? '#FFFFFF' : colors.text}
            inactiveColor={amll ? '#FFFFFF66' : `${colors.text}6B`}
            paddingVertical={paddingVertical}
          />
        ) : (
          <Text style={lineStyle}>{text}</Text>
        )}
      </Animated.View>
    </View>
  );
});
LyricRow.displayName = 'LyricRow';


/** Typography shared by the card and the full screen. */
export const lyricsStyles = themed((colors) => ({
  line: {
    color: colors.text,
    paddingVertical: spacing.xs,
  },
  lineLarge: { paddingVertical: spacing.sm },
  centered: { textAlign: 'center' },
}));

/**
 * The line style with the reader's size, weight and alignment on every lyrics
 * surface. Compact cards scale the chosen full-screen size proportionally.
 */
export function useLyricsLineStyle(large?: boolean) {
  const size = useSettings((s) => s.lyricsSize);
  const weight = useSettings((s) => s.lyricsWeight);
  const centered = useSettings((s) => s.lyricsAlign) === 'center';
  return lyricsLineStyle(large, size, weight, centered);
}

function lyricsLineStyle(
  large: boolean | undefined,
  size: LyricsSize,
  weight: LyricsWeight,
  centered: boolean,
) {
  // The setting is expressed in full-screen points. Compact surfaces retain
  // the old 20:28 ratio, so the default is visually unchanged while every
  // other size still follows the listener's choice.
  const textSize = large
    ? size
    : Math.max(16, Math.round((size * 20) / LYRICS_SIZE_DEFAULT));
  const lineHeight = Math.round(textSize * (large ? 10 / 7 : 1.5));
  return [
    lyricsStyles.line,
    large && lyricsStyles.lineLarge,
    { fontSize: textSize, lineHeight, fontWeight: weight },
    centered && lyricsStyles.centered,
  ];
}

function amllLyricsLineStyle(size: LyricsSize, weight: LyricsWeight): TextStyle {
  // Retain relative size/weight choices while giving this full-player style
  // its own 34dp/semibold baseline. The other lyrics surfaces stay unchanged.
  const textSize = Math.round(size * 34 / LYRICS_SIZE_DEFAULT);
  return {
    color: '#FFFFFF',
    fontSize: textSize,
    lineHeight: Math.round(textSize * 1.25),
    fontWeight: weight === '500' ? '600' : weight,
    paddingVertical: Math.round(textSize * 0.35),
    textAlign: 'left',
  };
}

const CARD_BODY_H = 280;

const styles = themed((colors) => ({
  card: {
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    // The player no longer has global horizontal padding (because of the
    // slider): the card supplies its own margin.
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', marginBottom: spacing.sm },
  body: { height: CARD_BODY_H, overflow: 'hidden' },
  // Lyrics in place of the cover: box exactly the size of the cover.
  coverBox: { overflow: 'hidden', padding: spacing.lg },
  coverBody: { flex: 1, overflow: 'hidden' },
  coverStatus: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverEmpty: { color: colors.textSecondary, fontSize: fontSize.md, textAlign: 'center' },
  wrap: { flex: 1 },
  // Right margin so the active line (which grows 8% from the left) doesn't get
  // clipped against the edge.
  content: { paddingBottom: spacing.xl, paddingRight: '10%' },
  amllContent: { paddingRight: '5%' },
  maskSolid: { flex: 1, backgroundColor: '#000000' },
  leftOrigin: { transformOrigin: 'left center' },
  centerOrigin: { transformOrigin: 'center center' },
  // Centred, the 8% growth spills to both sides, so the margin is split.
  contentCentered: { paddingRight: '5%', paddingLeft: '5%' },
  fade: { position: 'absolute', left: 0, right: 0 },
  expand: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
