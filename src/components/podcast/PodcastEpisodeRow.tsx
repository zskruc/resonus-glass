import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PodcastChannel, PodcastEpisode } from '@/api/subsonic';
import { podcastCover } from '@/api/podcasts';
import { Cover } from '@/components/Cover';
import Icon from '@/components/Icon';
import { PrimuseTrackPanelRow } from '@/components/primuse/PrimuseTrackPanelRow';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { podcastListeningState, type PodcastProgress } from '@/lib/podcastLibrary';
import type { PrimuseAlbumPalette } from '@/lib/primuseAlbumPalette';
import { currentSong, usePlayerStore } from '@/store/player';

interface Props {
  episode: PodcastEpisode; channel?: PodcastChannel; palette: PrimuseAlbumPalette; saved?: PodcastProgress;
  downloaded: boolean; favorite?: boolean; fresh?: boolean; unavailable: boolean; first: boolean; last: boolean;
  language: string; onPlay(): void; onDetails(): void; onMenu(): void;
}
export const PodcastEpisodeRow = memo(function PodcastEpisodeRow({ episode, channel, palette, saved, downloaded, favorite, fresh, unavailable,
  first, last, language, onPlay, onDetails, onMenu }: Props) {
  const t = useT();
  // Only the visible, currently playing row changes, at most once per second.
  const live = usePlayerStore((state) => currentSong(state)?.id === episode.id ? Math.floor(state.positionSec) : undefined);
  const state = podcastListeningState(episode, saved, live);
  const kind = (episode as PodcastEpisode & { episodeType?: string }).episodeType;
  const date = episode.publishedAt ? new Date(episode.publishedAt).toLocaleDateString(language, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return <PrimuseTrackPanelRow first={first} last={last}>
    <View style={[styles.row, unavailable && { opacity: .55 }]}>
      <Pressable onPress={onDetails} accessibilityRole="button" accessibilityLabel={t('Episode details')} style={({ pressed }) => [styles.body, pressed && { opacity: .6 }]}>
        {channel ? <View style={styles.show}>
          <Cover uri={podcastCover(channel)} size={36} /><Text style={[styles.showName, { color: palette.textSecondary }]} numberOfLines={1}>{channel.title}</Text>
        </View> : null}
        <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>{[fresh && !state.played ? t('New') : state.played ? t('Played') : null,
          kind === 'trailer' ? t('Trailer') : kind === 'bonus' ? t('Bonus') : null, date].filter(Boolean).join(' · ')}</Text>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={3}>{episode.title || t('Untitled episode')}</Text>
        {episode.description ? <Text style={[styles.description, { color: palette.textSecondary }]} numberOfLines={2}>{episode.description}</Text> : null}
      </Pressable>
      <View style={styles.bottom}>
        <Pressable disabled={unavailable || !episode.url && !downloaded} onPress={onPlay} accessibilityRole="button"
          accessibilityLabel={t(state.inProgress ? 'Continue playing' : 'Play')} style={({ pressed }) => [styles.play, { backgroundColor: palette.controlFill }, pressed && { opacity: .55 }]}>
          <Icon name="play" size={14} color={palette.text} />
          <Text style={[styles.time, { color: palette.textSecondary }]}>{state.inProgress && state.remaining !== undefined
            ? t('{time} left', { time: formatDuration(state.remaining) }) : state.duration > 0 ? formatDuration(state.duration) : t('Play')}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {downloaded ? <Icon name="arrow-down-circle" size={18} color={palette.textSecondary} /> : null}
        {favorite ? <Icon name="heart" size={16} color={palette.textSecondary} /> : null}
        <Pressable onPress={onMenu} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('More')} style={styles.more}>
          <Icon name="ellipsis-horizontal" size={22} color={palette.textSecondary} />
        </Pressable>
      </View>
      {state.inProgress ? <View style={[styles.progress, { backgroundColor: palette.controlFill }]} accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(state.fraction * 100) }}>
        <View style={{ height: 3, width: `${state.fraction * 100}%`, backgroundColor: palette.textSecondary, borderRadius: 2 }} />
      </View> : null}
    </View>
  </PrimuseTrackPanelRow>;
});
const styles = StyleSheet.create({
  row: { paddingHorizontal: 4, paddingVertical: 15, gap: 11 }, body: { gap: 6 },
  meta: { fontSize: 11, lineHeight: 16, fontWeight: '500' }, title: { fontSize: 17, lineHeight: 23, fontWeight: '600', includeFontPadding: false },
  description: { fontSize: 13, lineHeight: 19 }, bottom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18 },
  time: { fontSize: 12, fontWeight: '600' }, more: { padding: 5 }, progress: { height: 3, borderRadius: 2, overflow: 'hidden' },
  show: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }, showName: { flex: 1, fontSize: 12, fontWeight: '600' },
});
