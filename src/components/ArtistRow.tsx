/**
 * Artist row for lists: small round photo, name, and album count. The
 * list-mode sibling of `ArtistCard`; until now it only existed loose inside
 * the Library.
 */
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { COVER, coverArtUrl, type Artist } from '@/api/data';
import { usePressFeedback } from '@/hooks/usePressFeedback';
import { useAppleMusicStyle } from '@/hooks/useAppleMusicStyle';
import { appleMusicStyles } from '@/theme/appleMusic';
import { albumsLabel } from '@/i18n';
import { useSettings } from '@/store/settings';
import { fontSize, spacing, themed } from '@/theme';
import { bump } from '@/lib/perfLog';
import { Cover } from './Cover';

export function ArtistRow({ artist }: { artist: Artist }) {
  bump('render · ArtistRow');
  const lang = useSettings((s) => s.language);
  const press = usePressFeedback();
  const appleMusic = useAppleMusicStyle();
  // The fade sits outside the Link: its child is handed to a `Slot`, which
  // refuses an array of styles, and an animated one cannot be flattened into
  // the single object it wants.
  return (
    <Animated.View style={press.style}>
      <Link href={`/artist/${artist.id}`} asChild>
        <Pressable
          style={StyleSheet.flatten([styles.row, appleMusic && appleMusicStyles.mediaRow])}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
        >
          <Cover uri={coverArtUrl(artist.coverArt ?? artist.id, COVER.thumb)} size={56} rounded />
          <View style={[styles.info, appleMusic && appleMusicStyles.rowInfo]}>
            <Text style={[styles.name, appleMusic && appleMusicStyles.rowTitle]} numberOfLines={1}>
              {artist.name}
            </Text>
            <Text style={[styles.sub, appleMusic && appleMusicStyles.rowSubtitle]}>{albumsLabel(artist.albumCount ?? 0, lang)}</Text>
          </View>
        </Pressable>
      </Link>
    </Animated.View>
  );
}

const styles = themed((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  sub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
}));
