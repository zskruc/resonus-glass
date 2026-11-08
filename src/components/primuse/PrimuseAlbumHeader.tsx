/** AlbumDetailView presentation adapted from chenqi92/primuse (MIT).
 * Copyright (c) 2026 Welape. See licenses/PRIMUSE-MIT.txt. */
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { Link } from 'expo-router';

import { Cover } from '@/components/Cover';
import { ExplicitBadge } from '@/components/ExplicitBadge';
import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import type { PrimuseAlbumPalette } from '@/lib/primuseAlbumPalette';
import type { primuseAlbumLayout } from '@/lib/primuseAlbumLayout';
import { usePrimuseAlbumScene } from './PrimuseAlbumScene';

interface Props {
  title: string; subtitle?: string; onSubtitlePress?: () => void; meta?: string; explicit?: boolean;
  coverUri?: string; onCoverPress?: () => void; description?: string; genres?: string[];
  layout: ReturnType<typeof primuseAlbumLayout>; palette: PrimuseAlbumPalette;
  disabled: boolean; showPause: boolean; shuffleActive: boolean; onPlay: () => void; onShuffle: () => void;
  favorite?: ReactNode;
  /** Other media keep the same identity layout with their own appropriate controls. */
  actions?: ReactNode;
  onArtworkLoad: (uri: string) => void; onArtworkError: (uri?: string) => void;
  onTitleLayout: (layout: { y: number; height: number }) => void;
  onCoverCenterY?: (centerY: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  nameStyle: AnimatedStyle<ViewStyle>;
}

export function PrimuseAlbumHeader({ title, subtitle, onSubtitlePress, meta, explicit, coverUri, onCoverPress,
  description, genres, layout, palette, disabled, showPause, shuffleActive, onPlay, onShuffle, favorite, actions,
  onArtworkLoad, onArtworkError, onTitleLayout, onCoverCenterY, onLayout, nameStyle }: Props) {
  const t = useT();
  const scene = usePrimuseAlbumScene();
  const [expanded, setExpanded] = useState(false);
  const measured = useRef({ groupY: NaN, metadataY: NaN, titleY: 0, titleHeight: 0, coverY: NaN, coverHeight: 0 });
  const reportTitle = () => {
    const m = measured.current;
    if (Number.isFinite(m.groupY + m.metadataY) && m.titleHeight > 0)
      onTitleLayout({ y: m.groupY + m.metadataY + m.titleY, height: m.titleHeight });
    if (Number.isFinite(m.groupY + m.coverY) && m.coverHeight > 0)
      onCoverCenterY?.(m.groupY + m.coverY + m.coverHeight / 2);
  };
  const cover = <Cover uri={coverUri} size={layout.coverSide} transition={0} preferStatic
    style={{ borderRadius: layout.compact ? 10 : 14 }}
    onImageDisplay={(uri) => { onArtworkLoad(uri); scene.coverDisplayed(); }}
    onImageError={(uri) => { onArtworkError(uri); scene.coverDisplayed(); }} />;
  const pressedStyle = ({ pressed }: { pressed: boolean }) => pressed && styles.pressed;
  return <View testID="primuse-album-header" onLayout={onLayout}
    style={[styles.header, { paddingTop: layout.topPadding, paddingBottom: layout.bottomPadding, gap: layout.blockSpacing }]}>
    <View style={[styles.identity, !layout.stacked && styles.horizontal]}
      onLayout={(e) => { measured.current.groupY = e.nativeEvent.layout.y; reportTitle(); }}>
      <View style={[styles.cover, { width: layout.coverSide, height: layout.coverSide,
        borderRadius: layout.compact ? 10 : 14 }]} onLayout={(event) => {
          measured.current.coverY = event.nativeEvent.layout.y;
          measured.current.coverHeight = event.nativeEvent.layout.height;
          reportTitle();
        }}>
        {onCoverPress ? <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('View cover')}
          onPress={onCoverPress} style={pressedStyle}>{cover}</Pressable> : cover}
      </View>
      <View style={[styles.metadata, !layout.stacked && styles.leftMetadata]}
        onLayout={(e) => { measured.current.metadataY = e.nativeEvent.layout.y; reportTitle(); }}>
        <Animated.View style={nameStyle} onLayout={(e) => {
          measured.current.titleY = e.nativeEvent.layout.y;
          measured.current.titleHeight = e.nativeEvent.layout.height;
          reportTitle();
        }}>
          <Text style={[styles.title, { color: palette.text }, !layout.stacked && styles.left]}
            numberOfLines={layout.compact ? 2 : 3}>{title}</Text>
        </Animated.View>
        {subtitle ? <Pressable disabled={!onSubtitlePress} onPress={onSubtitlePress} hitSlop={6}
          accessibilityRole={onSubtitlePress ? 'link' : undefined}
          style={({ pressed }) => [styles.artistLink, !layout.stacked && styles.leftLink, pressed && styles.pressed]}>
          <Text style={[styles.artist, { color: palette.textSecondary }, !layout.stacked && styles.left]}>{subtitle}</Text>
          {onSubtitlePress ? <Icon name="chevron-forward" size={10} color={palette.textSecondary} /> : null}
        </Pressable> : null}
        {meta || explicit ? <View style={[styles.metaRow, !layout.stacked && styles.leftLink]}>
          {explicit ? <ExplicitBadge status="explicit" /> : null}
          {meta ? <Text style={[styles.meta, { color: palette.textMuted }, !layout.stacked && styles.left]}>{meta}</Text> : null}
        </View> : null}
      </View>
    </View>
    <View style={styles.actions}>
      {actions ?? <>
      <Pressable accessibilityRole="button" accessibilityLabel={showPause ? t('Pause') : t('Play')}
        disabled={disabled} onPress={onPlay} style={({ pressed }) => [styles.action, styles.play,
          (disabled || pressed) && styles.pressed]}>
        <Icon name={showPause ? 'pause' : 'play'} size={17} color={palette.playLabel} />
        <Text style={[styles.actionLabel, { color: palette.playLabel }]}>{showPause ? t('Pause') : t('Play')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Shuffle')}
        accessibilityState={{ selected: shuffleActive, disabled }} disabled={disabled} onPress={onShuffle}
        style={({ pressed }) => [styles.action, { backgroundColor: palette.controlFill }, (disabled || pressed) && styles.pressed]}>
        <Icon name="shuffle" size={20} color={palette.text} />
        <Text style={[styles.actionLabel, { color: palette.text }]}>{t('Shuffle')}</Text>
      </Pressable>
      {favorite}
      </>}
    </View>
    {description?.trim() ? <Pressable accessibilityRole="button" accessibilityLabel={t(expanded ? 'Show less' : 'Show more')}
      onPress={() => setExpanded((value) => !value)} style={pressedStyle}>
      <Text style={[styles.description, { color: palette.textSecondary }]} numberOfLines={expanded ? undefined : 2}>{description.trim()}</Text>
    </Pressable> : null}
    {genres?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genres}>
      {genres.map((genre) => <Link key={genre} href={`/genre/${encodeURIComponent(genre)}`} asChild>
        <Pressable style={({ pressed }) => [styles.genre, { backgroundColor: palette.controlFill }, pressed && styles.pressed]}>
          <Text style={{ fontSize: 12, color: palette.textSecondary }}>{genre}</Text>
        </Pressable>
      </Link>)}
    </ScrollView> : null}
  </View>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 4 },
  identity: { alignItems: 'center', gap: 14 },
  horizontal: { flexDirection: 'row', gap: 16 },
  cover: { shadowColor: '#000000', shadowOpacity: .34, shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  metadata: { alignSelf: 'stretch', gap: 6 }, leftMetadata: { flex: 1 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center', includeFontPadding: false,
    textShadowColor: '#00000038', textShadowRadius: 12, textShadowOffset: { width: 0, height: 2 } },
  artistLink: { flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  artist: { fontSize: 15, lineHeight: 20, fontWeight: '600', textAlign: 'center', flexShrink: 1, includeFontPadding: false },
  metaRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 },
  meta: { fontSize: 12, lineHeight: 16, textAlign: 'center', flexShrink: 1, includeFontPadding: false },
  left: { textAlign: 'left' }, leftLink: { justifyContent: 'flex-start' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  action: { flex: 1, minHeight: 48, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  play: { backgroundColor: '#FFFFFF' }, actionLabel: { fontSize: 17, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  description: { fontSize: 14, lineHeight: 21 }, genres: { flexGrow: 1, justifyContent: 'center', gap: 8 },
  genre: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }, pressed: { opacity: .55 },
});
