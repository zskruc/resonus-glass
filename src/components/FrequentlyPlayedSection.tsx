import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Song } from '@/api/subsonic';
import { useT } from '@/i18n';
import { selectFrequentlyPlayedSongs } from '@/lib/frequentlyPlayed';
import { usePlayCounts } from '@/store/playCounts';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, useTheme } from '@/theme';
import { TrackRow } from './TrackRow';
import { useArtistPagePalette } from './volta/ArtistPagePalette';

interface Props {
  songs: readonly Song[];
  sourceName: string;
  sourceHref: string;
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/** Personal listening history only, over tracks already available to this
 * page. No catalog downloads, random fill or global-popularity substitute. */
export const FrequentlyPlayedSection = memo(function FrequentlyPlayedSection({ songs, sourceName, sourceHref, title, style }: Props) {
  useTheme();
  const t = useT();
  const palette = useArtistPagePalette();
  const counts = usePlayCounts((state) => state.counts);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((state) => state.playQueue);
  const frequent = useMemo(() => selectFrequentlyPlayedSongs(songs, counts), [songs, counts]);
  const live = useRef<{ songs: Song[]; name: string; href: string; play: typeof playQueue } | null>(null);
  useLayoutEffect(() => {
    live.current = { songs: frequent, name: sourceName, href: sourceHref, play: playQueue };
    return () => { live.current = null; };
  }, [frequent, sourceName, sourceHref, playQueue]);
  if (!frequent.length) return null;
  const owner = `frequently-played:${sourceHref}`;
  return <View testID="frequently-played-section" style={[styles.section, style]}>
    <Text style={[styles.title, { color: palette?.text ?? colors.text }]}>{title ?? t('Frequently played songs')}</Text>
    <View style={[styles.panel, { backgroundColor: palette ? 'rgba(255,255,255,0.09)' : colors.surface,
      borderColor: palette ? 'rgba(255,255,255,0.12)' : colors.surfaceHighlight }]}>
      {frequent.map((song, index) => <View key={song.id}>
        {index ? <View style={[styles.separator, { backgroundColor: palette ? '#FFFFFF1F' : colors.surfaceHighlight }]} /> : null}
        <TrackRow song={song} rowOccurrenceKey={`${owner}:${song.id}`} ownerScope={owner}
          displayIndex={index} serverIndex={index} position={index + 1} showArtwork
          isCurrent={playing?.id === song.id}
          onPress={() => {
            const current = live.current;
            const position = current?.songs.findIndex((candidate) => candidate.id === song.id) ?? -1;
            if (current && position >= 0) void current.play(current.songs, position, current.name, current.href);
          }} />
      </View>)}
    </View>
  </View>;
});

const styles = StyleSheet.create({
  section: { gap: 12 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  panel: { borderRadius: 20, borderWidth: 0.5, paddingHorizontal: 10, paddingVertical: 5 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 58 },
});
