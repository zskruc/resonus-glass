/** Album card for home and search grids/carousels. */
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER, coverArtUrl, type Album } from '@/api/data';
import { useMediaMenu } from '@/store/mediaMenu';
import { useAppleMusicStyle } from '@/hooks/useAppleMusicStyle';
import { appleMusicStyles } from '@/theme/appleMusic';
import { useArtistPagePalette } from '@/components/volta/ArtistPagePalette';
import { haptic } from '@/lib/haptics';
import { fontSize, lineHeight, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { Cover } from './Cover';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';

interface Props {
  album: Album;
  width?: number;
  /** Called when the card is tapped (in addition to navigating to the album). */
  onPress?: () => void;
}

// Memoised: a Home render redrew every card on every shelf (a report had 77
// card renders per Home render).
export const AlbumCard = memo(function AlbumCard({ album, width = 150, onPress }: Props) {
  bump('render · AlbumCard');
  // Memoised, so it has to ask for a repaint on a theme change itself.
  useTheme();
  const appleMusic = useAppleMusicStyle();
  const pagePalette = useArtistPagePalette();
  const cover = coverArtUrl(album.coverArt ?? album.id, COVER.card);
  const openMenu = useMediaMenu((s) => s.open);
  const explicit = useExplicitBadge(album.explicitStatus);

  return (
    <Link href={`/album/${album.id}`} asChild>
      {/* expo-router merges the Link style into this child; it must be a
          single object, not an array, so we flatten it. */}
      <Pressable
        style={StyleSheet.flatten([styles.container, { width }])}
        onPress={onPress}
        onLongPress={() => {
          haptic('light');
          openMenu({ kind: 'album', album });
        }}
      >
        <Cover uri={cover} size={width} style={appleMusic ? appleMusicStyles.cover : undefined} />
        <Text style={[styles.title, appleMusic && appleMusicStyles.cardTitle,
          pagePalette && { color: pagePalette.text }]} numberOfLines={appleMusic ? 2 : 1}>
          {album.name}
        </Text>
        {explicit || album.artist ? (
          <View style={styles.subRow}>
            <ExplicitBadge status={album.explicitStatus} />
            {album.artist ? (
              <Text style={[styles.artist, appleMusic && appleMusicStyles.cardSubtitle,
                pagePalette && { color: pagePalette.textSecondary }]} numberOfLines={1}>
                {album.artist}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
});

const styles = themed((colors) => ({
  container: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    // Gives way to the badge instead of pushing it off the card.
    flexShrink: 1,
  },
}));
