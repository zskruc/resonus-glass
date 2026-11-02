/** One podcast and its episodes, played straight from the publisher's files. */
import Animated from 'react-native-reanimated';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { GlassPressable } from '@/components/glass';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import { getChannel, listEpisodes, episodeToSong, refreshChannel, podcastCover, playedEpisodeIds, type PodcastEpisode } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { openPodcastMenu, openPodcastEpisodeMenu } from '@/components/PodcastMenuSheet';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { COVER, coverArtUrl } from '@/api/data';
import { BackButton } from '@/components/BackButton';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { listPerf } from '@/lib/listPerf';
import { queryClient } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { currentSong, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, tracking, useTheme } from '@/theme';

/** The date an episode was published, in the app's language. */
function dayLabel(at: number, lang: string): string {
  const d = new Date(at);
  const now = new Date();
  return d.toLocaleDateString(lang, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export default function PodcastScreen() {
  const dockScroll = useLiquidDockScrollHandler();
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const bottomPad = useScreenBottomPadding();
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playingId = usePlayerStore((s) => currentSong(s)?.id);
  const [refreshing, setRefreshing] = useState(false);
  const files = usePodcastDownloads((state) => state.files);
  const favorites = usePodcastFavoriteIds();
  const played = useQuery({ queryKey: ['podcastPlayed', id], queryFn: () => playedEpisodeIds(id), enabled: !!id });
  const refetchPlayed = played.refetch;
  useFocusEffect(useCallback(() => { void refetchPlayed(); }, [refetchPlayed]));

  const channel = useQuery({
    queryKey: ['podcastChannel', id],
    queryFn: () => getChannel(id),
    enabled: !!id,
  });

  const episodes = useQuery({
    queryKey: ['podcastEpisodes', id],
    queryFn: () => listEpisodes(id),
    enabled: !!id,
  });

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['podcastChannel', id] });
    void queryClient.invalidateQueries({ queryKey: ['podcastEpisodes', id] });
    void queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] });
  }, [id]);

  const refresh = useCallback(async () => {
    const feedUrl = channel.data?.feedUrl;
    if (!feedUrl) return;
    setRefreshing(true);
    try {
      await refreshChannel(feedUrl);
      reload();
    } catch {
      toast(t("Couldn't read this feed"));
    } finally {
      setRefreshing(false);
    }
  }, [channel.data?.feedUrl, reload, t, toast]);

  /** The whole playable list, starting at the one tapped. */
  const play = useCallback(
    (list: PodcastEpisode[], from: number) => {
      const ch = channel.data;
      if (!ch) return;
      const playable = list.filter((e) => (e.url || files[e.id]) && (!isManualOffline() || files[e.id]));
      if (!playable.length) { toast(t('Not available offline')); return; }
      const start = playable.findIndex((e) => e.id === list[from]?.id);
      void playQueue(
        playable.map((e) => episodeToSong(e, ch)),
        start < 0 ? 0 : start,
        ch.title,
        `/podcast/${ch.id}`,
      );
    },
    [channel.data, playQueue, files, toast, t],
  );

  if (channel.isLoading || episodes.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!channel.data) {
    return (
      <View style={styles.center}>
        <BackButton />
        <Message text={t("Couldn't load this podcast.")} onRetry={reload} />
      </View>
    );
  }

  const ch = channel.data;
  const list = episodes.data ?? [];
  const siteUrl = /^https?:\/\//i.test(ch.siteUrl ?? '') ? ch.siteUrl : undefined;

  return (
    <Animated.FlatList
      onScroll={dockScroll}
      scrollEventThrottle={16}
      {...listPerf}
      data={list}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Cover
            uri={coverArtUrl(podcastCover(ch), COVER.card)}
            size={160}
            rounded
            placeholderIcon="headset-outline"
          />
          <Text style={styles.title}>{ch.title}</Text>
          {ch.author ? <Text style={styles.author}>{ch.author}</Text> : null}
          {ch.description ? (
            <Text style={styles.description} numberOfLines={6}>
              {ch.description}
            </Text>
          ) : null}
          {ch.error ? (
            <Text style={styles.error}>
              {t("This podcast's feed could not be read, so these episodes may be out of date.")}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {list.length > 0 ? (
              <GlassPressable variant="prominent" tint={colors.accent}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.7 }]}
                onPress={() => play(list, 0)}
              >
                <Icon name="play" size={18} color={colors.onAccent} />
                <Text style={styles.primaryText}>{t('Play latest')}</Text>
              </GlassPressable>
            ) : null}
            {siteUrl ? (
              <GlassPressable variant="regular"
                style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
                onPress={() => void Linking.openURL(siteUrl).catch(() => {})}
              >
                <Icon name="link-outline" size={18} color={colors.text} />
                <Text style={styles.secondaryText}>{t('Website')}</Text>
              </GlassPressable>
            ) : null}
            <GlassPressable variant="regular" style={styles.secondary} onPress={() => openPodcastMenu(ch)} accessibilityLabel={t('More')}>
              <Icon name="ellipsis-horizontal" size={22} color={colors.text} />
            </GlassPressable>
          </View>
          {list.length > 0 ? <Text style={styles.sectionTitle}>{t('Episodes')}</Text> : null}
        </View>
      }
      renderItem={({ item, index }: { item: PodcastEpisode; index: number }) => {
        const playing = playingId === item.id;
        const unavailable = isManualOffline() && !files[item.id];
        const done = !!played.data?.has(item.id);
        const fresh = !!ch.newSinceAt && (item.firstSeenAt ?? 0) >= ch.newSinceAt && !done;
        return (
          <Pressable
            style={({ pressed }) => [styles.episode, pressed && { opacity: 0.6 }, unavailable && { opacity: .45 }]}
            disabled={!item.url && !files[item.id]}
            onPress={() => unavailable ? toast(t('Not available offline')) : play(list, index)}
            onLongPress={() => openPodcastEpisodeMenu(ch, item)}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.episodeTitle, playing && { color: colors.accent }]}
                numberOfLines={2}
              >
                {item.title || t('Untitled episode')}
              </Text>
              <Text style={styles.episodeSub} numberOfLines={1}>
                {[fresh ? t('New') : done ? t('Played') : null, item.publishedAt ? dayLabel(item.publishedAt, lang) : null, formatDuration(item.duration)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {item.description ? <Text style={styles.episodeSub} numberOfLines={2}>{item.description}</Text> : null}
            </View>
            {files[item.id] ? <Icon name="download-outline" size={17} color={colors.accent} /> : null}
            {favorites.has(item.id) ? <Icon name="heart" size={16} color={colors.accent} /> : null}
            <Pressable hitSlop={10} onPress={(event) => { event.stopPropagation(); openPodcastEpisodeMenu(ch, item); }} accessibilityLabel={t('More')}>
              <Icon name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
            </Pressable>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="headset-outline"
          title={t('No episodes')}
          subtitle={t('Pull down to read the feed again.')}
        />
      }
    />
  );
}

const styles = themed((colors) => ({
  center: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
  list: { padding: spacing.lg, gap: spacing.xs },
  header: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  author: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
  description: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  primaryText: { color: colors.onAccent, fontSize: fontSize.sm, fontWeight: '600' },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  secondaryText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sectionTitle: {
    alignSelf: 'flex-start',
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginTop: spacing.lg,
  },
  episode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  episodeTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  episodeSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  unplayable: { color: colors.textMuted, fontSize: fontSize.xs },
}));
