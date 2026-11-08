/** Playlist card for the carousels on Home (the «Playlists» row). */
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER, coverArtUrl, type Playlist } from '@/api/data';
import { songsLabel } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useMediaMenu } from '@/store/mediaMenu';
import { useSettings } from '@/store/settings';
import { fontSize, lineHeight, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { Cover } from './Cover';
import Icon from '@/components/Icon';

interface Props {
  playlist: Playlist;
  downloaded?: boolean;
  width?: number;
}

export const PlaylistCard = memo(function PlaylistCard({ playlist, width = 150, downloaded }: Props) {
  bump('render · PlaylistCard');
  // Memoised, so it has to ask for a repaint on a theme change itself.
  const { accent } = useTheme();
  const lang = useSettings((s) => s.language);
  const openMenu = useMediaMenu((s) => s.open);
  const cover = coverArtUrl(playlist.coverArt ?? playlist.id, COVER.card);

  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      {/* expo-router merges the Link style into this child; it must be a
          single object, not an array, so we flatten it. */}
      <Pressable
        style={StyleSheet.flatten([styles.container, { width }])}
        onLongPress={() => {
          haptic('light');
          openMenu({ kind: 'playlist', playlist });
        }}
      >
        <Cover uri={cover} size={width} />
        <Text style={styles.title} numberOfLines={1}>
          {playlist.name}
        </Text>
        {playlist.songCount !== undefined ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {downloaded ? <Icon name="arrow-down-circle" size={13} color={accent} /> : null}
            <Text style={styles.sub} numberOfLines={1}>{songsLabel(playlist.songCount, lang)}</Text>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
});

const styles = themed((colors) => ({
  container: { gap: spacing.xs },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
  },
}));
