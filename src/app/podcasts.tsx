/**
 * The podcasts subscribed to on this phone: a screen, and `embedded`, the
 * Podcasts section of Explore. All local, so nothing is gated on a server.
 */
import { GlassBackdrop, GlassPressable } from '@/components/glass';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';

import {
  listAddedChannels,
  refreshAll,
  queueEpisode,
  type PodcastChannel,
} from '@/api/podcasts';
import { COVER, coverArtUrl } from '@/api/data';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame, useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { PodcastAddSheet } from '@/components/PodcastAddSheet';
import { openPodcastEpisodeMenu, openPodcastMenu } from '@/components/PodcastMenuSheet';
import { PodcastOPMLManager } from '@/components/podcast/PodcastOPMLManager';
import { PodcastEpisodeRow } from '@/components/podcast/PodcastEpisodeRow';
import { isManualOffline } from '@/api/netGate';
import { PODCAST_LIBRARY_PAGE_SIZE, readPodcastLibrary, type PodcastLibraryFilter } from '@/lib/podcastLibrary';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { podcastCover } from '@/api/podcasts';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { episodesLabel, useT } from '@/i18n';
import { useAppleMusicStyle } from '@/hooks/useAppleMusicStyle';
import { appleMusicStyles } from '@/theme/appleMusic';
import type { Language } from '@/i18n/languages';
import { listPerf } from '@/lib/listPerf';
import { queryClient } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
import {
  colors,
  fontSize,
  radius,
  spacing,
  themed,
  tracking,
  useTheme,
} from '@/theme';

/** Channels from which the list stops being read at a glance. */
const SEARCH_FROM = 8;
const EMPTY_FILES: Record<string, string> = {};

export default function PodcastsScreen() {
  return <PodcastsBrowser />;
}

/** "12 episodes · Ada Lovelace", or whichever half of that there is. */
function channelSubtitle(
  channel: PodcastChannel,
  t: ReturnType<typeof useT>,
  lang: Language,
) {
  const parts: string[] = [];
  if (channel.episodeCount) parts.push(episodesLabel(channel.episodeCount, lang));
  if (channel.author) parts.push(channel.author);
  return parts.join(' · ') || t('No episodes yet');
}

export function PodcastsBrowser({ embedded, actionRef, searchOpen }: BrowserProps) {
  const appleMusic = useAppleMusicStyle();
  const dockScroll = useLiquidDockScrollHandler();
  useTheme();
  const router = useRouter();
  const bottomPad = useScreenBottomPadding();
  const listPad = useListPadding(spacing.lg);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const files = usePodcastDownloads((state) => state.scope === hashKey(profile) ? state.files : EMPTY_FILES);
  const current = () => auth === useAuthStore.getState().auth && profileScopeId() === profile;

  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [mode, setMode] = useState<'shows' | PodcastLibraryFilter>('shows');
  const [query, setQuery] = useState('');
  const [settledQuery, setSettledQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSettledQuery(query.trim()), 350); return () => clearTimeout(timer); }, [query]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['podcastChannels', profile],
    queryFn: async () => { const owns = captureLyricOwner(profile); if (!current() || !owns()) throw new Error('Podcast profile changed');
      const values = await listAddedChannels(); if (!current() || !owns()) throw new Error('Podcast profile changed'); return values; },
  });
  const library = useInfiniteQuery({ queryKey: ['podcastLibrary', profile, mode, settledQuery], initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => readPodcastLibrary(mode as PodcastLibraryFilter, pageParam, profile, signal, settledQuery),
    enabled: mode !== 'shows' && query.trim() === settledQuery, getNextPageParam: (last, pages) => last.length === PODCAST_LIBRARY_PAGE_SIZE ? pages.length * PODCAST_LIBRARY_PAGE_SIZE : undefined,
    staleTime: 30_000, gcTime: 60_000 });
  const refetchLibrary = library.refetch;
  useFocusEffect(useCallback(() => { if (mode !== 'shows') void refetchLibrary(); }, [mode, refetchLibrary]));
  const libraryRows = useMemo(() => {
    return query.trim() === settledQuery ? library.data?.pages.flat() ?? [] : [];
  }, [library.data, query, settledQuery]);
  const rowPalette = { backgroundTop: colors.background, background: colors.background, text: colors.text,
    textSecondary: colors.textSecondary, textMuted: colors.textMuted, controlFill: colors.surfaceHighlight,
    accent: colors.accent, onText: colors.onAccent, playLabel: colors.onAccent };

  // Home's shelf is built from the same rows.
  const reload = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['podcastChannels'] }),
      queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] }), queryClient.invalidateQueries({ queryKey: ['podcastLibrary'] })]);

  async function refresh() {
    const owner = profileScopeId();
    setRefreshing(true);
    try {
      if (isManualOffline()) { await reload(); return; }
      const { failed, total } = await refreshAll();
      if (owner !== profileScopeId()) return;
      await reload();
      if (total > 0 && failed === total) toast(t("Couldn't reach any of your podcast feeds."));
      else if (failed > 0) toast(t('{n} podcast feeds could not be read.', { n: failed }));
    } catch {
      if (owner === profileScopeId()) toast(t("Couldn't load your podcasts."));
    } finally { setRefreshing(false); }
  }

  const channels = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data ?? [];
    return q
      ? all.filter(
          (c) =>
            c.title.toLowerCase().includes(q) || (c.author ?? '').toLowerCase().includes(q),
        )
      : all;
  }, [data, query]);

  const showSearch = (data?.length ?? 0) > SEARCH_FROM;
  const boxOpen = useSearchBox(embedded, searchOpen, () => setQuery(''));

  // Embedded, Explore's header button opens the sheet.
  useEffect(() => {
    if (actionRef) actionRef.current = () => setAdding(true);
  });

  const addButton = (
    <GlassPressable variant="subtle" hitSlop={10} onPress={() => setAdding(true)} accessibilityLabel={t('Add podcast')}>
      <Icon name="add" size={28} color={colors.text} />
    </GlassPressable>
  );


  return (
    <BrowseFrame embedded={embedded}>
      {embedded ? null : (
        <View style={[styles.header, appleMusic && appleMusicStyles.settingsHeader]}>
          <BackChevron />
          <Text style={[styles.title, appleMusic && appleMusicStyles.settingsTitle]}>{t('Podcasts')}</Text>
          {addButton}
        </View>
      )}

      <View style={[styles.discoveryActions, { marginHorizontal: listPad }]}>
      <GlassPressable style={styles.discover} accessibilityRole="button"
        onPress={() => router.push('/podcast-discover')}>
        <Icon name="compass-outline" size={23} color={colors.accent} />
        <Text style={styles.discoverText}>{t('Discover podcasts')}</Text>
        <Icon name="chevron-forward" size={18} color={colors.textMuted} />
      </GlassPressable>
      <GlassPressable style={styles.management} accessibilityRole="button" accessibilityLabel={t('Import / export subscriptions')} onPress={() => setManaging(true)}>
        <Icon name="documents-outline" size={23} color={colors.textSecondary} />
      </GlassPressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: listPad, gap: 8, paddingBottom: 14 }}>
        {([['shows', 'Shows'], ['continue', 'Continue listening'], ['unplayed', 'Latest unplayed'], ['downloaded', 'Downloaded']] as const).map(([value, label]) =>
          <GlassPressable key={value} accessibilityRole="button" accessibilityState={{ selected: mode === value }} onPress={() => setMode(value)}
            style={[styles.chip, { backgroundColor: mode === value ? colors.accent : colors.surfaceHighlight }]}>
            <Text style={{ color: mode === value ? colors.onAccent : colors.text, fontSize: 13, fontWeight: '600' }}>{t(label)}</Text>
          </GlassPressable>)}
      </ScrollView>

      {(embedded ? boxOpen : showSearch) ? (
        <View collapsable={false} style={styles.searchBar}>
          <GlassBackdrop radius={radius.pill} tint={colors.surfaceHighlight} variant="regular" />
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('Find a podcast')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            autoFocus={embedded}
          />
          {query ? (
            <GlassPressable variant="subtle" hitSlop={8} onPress={() => setQuery('')} accessibilityLabel={t('Clear')}>
              <Icon name="close-circle" size={18} color={colors.textMuted} />
            </GlassPressable>
          ) : null}
        </View>
      ) : null}

      {mode !== 'shows' ? <Animated.FlatList {...listPerf} onScroll={dockScroll} scrollEventThrottle={16} data={libraryRows}
        keyExtractor={(item) => item.episode.id} contentContainerStyle={{ paddingHorizontal: listPad, paddingBottom: bottomPad, gap: 12 }}
        onEndReached={() => { if (query.trim() === settledQuery && library.hasNextPage && !library.isFetchingNextPage) void library.fetchNextPage(); }} onEndReachedThreshold={.5}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.accent} />}
        renderItem={({ item }) => <View style={{ backgroundColor: colors.surfaceHighlight, borderRadius: 20 }}>
          <PodcastEpisodeRow episode={item.episode} channel={item.channel} palette={rowPalette}
            saved={{ positionSec: item.positionSec, durationSec: item.durationSec }} downloaded={item.downloaded} first last language={lang}
            unavailable={isManualOffline() && !files[item.episode.id]}
            onPlay={() => { if (current() && (!isManualOffline() || files[item.episode.id])) queueEpisode(item.episode, item.channel); }}
            onMenu={() => { if (current()) openPodcastEpisodeMenu(item.channel, item.episode); }}
            onDetails={() => { if (current()) router.push({ pathname: '/podcast-episode/[id]', params: { id: item.episode.id, channelId: item.channel.id } }); }} />
        </View>}
        ListEmptyComponent={library.isPending ? <ActivityIndicator color={colors.accent} /> : library.isError
          ? <Message text={t("Couldn't load your podcasts.")} onRetry={() => { void library.refetch(); }} />
          : <EmptyState icon="headset-outline" title={t('No episodes match this filter.')} />}
        ListFooterComponent={library.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : null} />
      : isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError && !data ? (
        <Message text={t("Couldn't load your podcasts.")} onRetry={() => refetch()} />
      ) : (
        <Animated.FlatList
      onScroll={dockScroll}
      scrollEventThrottle={16}
          {...listPerf}
          keyboardShouldPersistTaps="handled"
          data={channels}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad, paddingHorizontal: listPad },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }: { item: PodcastChannel }) => (
            <Pressable
              style={styles.row}
              onPress={() => { if (current()) router.push(`/podcast/${item.id}`); }}
              onLongPress={() => { if (current()) openPodcastMenu(item); }}
            >
              <Cover
                uri={coverArtUrl(podcastCover(item), COVER.thumb)}
                size={64}
                placeholderIcon="headset-outline"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.error ? (
                  <Text style={[styles.rowSub, { color: colors.danger }]} numberOfLines={1}>
                    {t("Couldn't read this feed")}
                  </Text>
                ) : (
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {channelSubtitle(item, t, lang)}
                  </Text>
                )}
              </View>
              <Pressable
                hitSlop={8}
                onPress={() => { if (current()) openPodcastMenu(item); }}
                accessibilityLabel={t('More')}
              >
                <Icon name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
              </Pressable>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="headset-outline"
              title={t('No podcasts')}
              subtitle={t('Tap + to subscribe to a show.')}
            />
          }
        />
      )}

      <PodcastAddSheet
        visible={adding}
        subscribed={(data ?? []).map((c) => c.feedUrl ?? '').filter(Boolean)}
        onCancel={() => setAdding(false)}
        onSubscribed={() => void reload()}
      />
      <PodcastOPMLManager visible={managing} onClose={() => setManaging(false)} onImported={() => { void reload(); }} />
    </BrowseFrame>
  );
}

const styles = themed((colors) => ({
  discoveryActions: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  discover: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.surfaceHighlight },
  management: { width: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surfaceHighlight },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: radius.pill },
  discoverText: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
  },
  list: { paddingHorizontal: spacing.lg, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: 12, borderRadius: 18, backgroundColor: colors.surfaceHighlight },
  rowTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  rowSub: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.md, padding: 0 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
