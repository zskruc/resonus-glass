/**
 * Album presentation adapted from Loriage/Minidisc AlbumDetailView.swift,
 * commit 09789242135b6f63a51cab1f3f6207986bb72c3d.
 * Copyright (c) 2026 NO HIT Dev; based on Cassette,
 * Copyright (c) 2024-2026 Mathieu Dubart.
 * This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See licenses/Minidisc-MPL-2.0.txt or https://mozilla.org/MPL/2.0/.
 */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import Icon from '@/components/Icon';
import { Cover } from '@/components/Cover';
import { ExplicitBadge } from '@/components/ExplicitBadge';
import { useT } from '@/i18n';
import type { MinidiscAlbumPalette } from '@/lib/minidiscAlbumPalette';

interface Props {
  title: string;
  subtitle?: string;
  onSubtitlePress?: () => void;
  meta?: string;
  explicit?: boolean;
  coverUri?: string;
  coverSize: number;
  onCoverPress?: () => void;
  description?: string;
  genres?: string[];
  palette: MinidiscAlbumPalette;
  disabled: boolean;
  shuffleActive: boolean;
  onShuffle: () => void;
  onPlay: () => void;
  download?: { status: 'none' | 'active' | 'done'; progress: number; onPress: () => void };
  artwork?: ReactNode;
}

export function MinidiscAlbumHeader({ title, subtitle, onSubtitlePress, meta, explicit, coverUri,
  coverSize, onCoverPress, description, genres, palette, disabled, shuffleActive, onShuffle,
  onPlay, download, artwork }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const circular = [styles.circle, { backgroundColor: palette.controlFill }];
  const image = artwork ?? <Cover uri={coverUri} size={coverSize} style={{ borderRadius: 12 }} />;
  return (
    <View style={styles.header}>
      <View style={[styles.artwork, { width: coverSize, height: coverSize }]}>
        {onCoverPress ? <Pressable onPress={onCoverPress} accessibilityRole="imagebutton"
          accessibilityLabel={t('View cover')}>{image}</Pressable> : image}
      </View>
      <View style={styles.metadata}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>{title}</Text>
        {subtitle ? onSubtitlePress ? <Pressable onPress={onSubtitlePress} hitSlop={6}
          accessibilityRole="link" style={styles.artistLink}>
          <Text style={[styles.artist, { color: palette.textSecondary }]}>{subtitle}</Text>
        </Pressable> : <Text style={[styles.artist, { color: palette.textSecondary }]}>{subtitle}</Text> : null}
        {explicit || meta ? <View style={styles.metaRow}>
          {explicit ? <ExplicitBadge status="explicit" /> : null}
          {meta ? <Text style={[styles.meta, { color: palette.textSecondary }]}>{meta}</Text> : null}
        </View> : null}
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Shuffle')}
          accessibilityState={{ selected: shuffleActive, disabled }} disabled={disabled} onPress={onShuffle}
          style={({ pressed }) => [circular, (pressed || disabled) && styles.dim]}>
          <Icon name="shuffle" size={22} color={palette.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Play')} disabled={disabled}
          onPress={onPlay} style={({ pressed }) => [styles.play, (pressed || disabled) && styles.dim]}>
          <Icon name="play" size={20} color={palette.playLabel} />
          <Text style={[styles.playLabel, { color: palette.playLabel }]}>{t('Play')}</Text>
        </Pressable>
        {download ? <Pressable accessibilityRole="button"
          accessibilityLabel={download.status === 'done' ? t('Remove download') : t('Download')}
          accessibilityValue={download.status === 'active' ? { text: `${Math.round(download.progress * 100)}%` } : undefined}
          onPress={download.onPress} style={({ pressed }) => [circular, pressed && styles.dim]}>
          {download.status === 'active' ? <ActivityIndicator size="small" color={palette.text} />
            : <Icon name={download.status === 'done' ? 'checkmark' : 'arrow-down'} size={23} color={palette.text} />}
        </Pressable> : <View style={styles.circle} />}
      </View>
      {description?.trim() ? <View style={styles.descriptionWrap}>
        <Text style={[styles.measure, styles.description]} onTextLayout={(event) => setHasMore(event.nativeEvent.lines.length > 2)}>
          {description.trim()}
        </Text>
        <Text style={[styles.description, { color: palette.textSecondary }]} numberOfLines={expanded ? undefined : 2}>
          {description.trim()}
        </Text>
        {hasMore ? <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setExpanded((value) => !value)}>
          <Text style={[styles.more, { color: palette.text }]}>{expanded ? t('Show less') : t('Show more')}</Text>
        </Pressable> : null}
      </View> : null}
      {genres?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.genres} style={styles.genreScroll}>
        {genres.map((genre) => <Link key={genre} href={`/genre/${encodeURIComponent(genre)}`} asChild>
          <Pressable style={[styles.genreChip, { backgroundColor: palette.controlFill }]}>
            <Text style={[styles.genre, { color: palette.textSecondary }]}>{genre}</Text>
          </Pressable>
        </Link>)}
      </ScrollView> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: 24, paddingBottom: 20 },
  artwork: { alignSelf: 'center', borderRadius: 12, shadowColor: '#000000', shadowOpacity: 0.16,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5, marginBottom: 20 },
  metadata: { paddingHorizontal: 8, alignItems: 'center', gap: 4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  artist: { fontSize: 20, lineHeight: 25, fontWeight: '500', textAlign: 'center' },
  artistLink: { maxWidth: '100%' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4 },
  meta: { fontSize: 13, lineHeight: 19, textAlign: 'center', flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    marginTop: 16, marginBottom: 4, paddingHorizontal: 16 },
  circle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  play: { flex: 1, maxWidth: 220, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  playLabel: { fontSize: 17, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  dim: { opacity: 0.55 },
  descriptionWrap: { marginTop: 16, paddingHorizontal: 8 },
  description: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  measure: { position: 'absolute', opacity: 0, left: 8, right: 8 },
  more: { textAlign: 'center', fontSize: 14, lineHeight: 20, marginTop: 4, fontWeight: '500' },
  genreScroll: { marginTop: 16 },
  genres: { flexGrow: 1, justifyContent: 'center', gap: 8, paddingHorizontal: 8 },
  genreChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  genre: { fontSize: 12, lineHeight: 17 },
});
