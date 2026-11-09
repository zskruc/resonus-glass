/** One podcast and its episodes, played straight from the publisher's files. */
import { GlassPressable } from '@/components/glass';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { addedChannelIds, getChannel, getPodcastEpisode, listEpisodePage, listEpisodes, episodeToSong, refreshChannel, subscribe, type PodcastEpisode, type PodcastChannel } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { openPodcastMenu, openPodcastEpisodeMenu } from '@/components/PodcastMenuSheet';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { BackButton } from '@/components/BackButton';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { usePodcastEpisodeSort } from '@/hooks/usePodcastEpisodeSort';
import { useT } from '@/i18n';
import { queryClient } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, themed, useTheme } from '@/theme';
import { PodcastDetailView } from '@/components/podcast/PodcastDetailView';
import { PodcastEpisodeRow } from '@/components/podcast/PodcastEpisodeRow';
import { PodcastDownloadDialog } from '@/components/PodcastDownloadDialog';
import { filterPodcastEpisodes, readPodcastShowProgress, type PodcastEpisodeFilter, type PodcastProgress } from '@/lib/podcastLibrary';
import { hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { sortPodcastEpisodes } from '@/lib/podcastPresentation';
import { usePodcastPreview } from '@/hooks/usePodcastPreview';
import { usePodcastStorageVisit } from '@/hooks/usePodcastStorageVisit';

const EMPTY_EPISODES: PodcastEpisode[] = [];

const EMPTY_FILES: Record<string, string> = {};
const EMPTY_PROGRESS = new Map<string, PodcastProgress>();

export default function PodcastScreen() {
  useTheme();
  const params = useLocalSearchParams<{ id: string; preview?: string }>();
  const previewToken = typeof params.preview === 'string' ? params.preview : undefined;
  const preview = usePodcastPreview(previewToken);
  const clearPreviewError = preview.clearError;
  const id = preview.channel?.id ?? (previewToken ? '' : params.id);
  usePodcastStorageVisit(id);
  const t = useT(), router = useRouter();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playingId = usePlayerStore((s) => currentSong(s)?.id);
  const playingChannelId = usePlayerStore((s) => currentSong(s)?.podcastChannelId);
  const isPlaying = usePlayerStore((s) => s.isPlaying), toggle = usePlayerStore((s) => s.toggle);
  const [filter, setFilter] = useState<PodcastEpisodeFilter>('all');
  const [season, setSeason] = useState<number | 'other' | undefined>();
  const [downloadTarget, setDownloadTarget] = useState<{ channel: PodcastChannel; owner: unknown; profile: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [partialError, setPartialError] = useState<string>();
  const [requestEpoch, setRequestEpoch] = useState(0);
  const [subscribingRequest, setSubscribingRequest] = useState<{ context: object; controller: AbortController } | null>(null);
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const offline = useAuthStore((state) => state.offline), automaticOffline = useAuthStore((state) => state.autoOffline);
  const subscriptionContext = useMemo(() => ({ auth, profile, id, offline, automaticOffline }), [auth, profile, id, offline, automaticOffline]);
  const subscribing = subscribingRequest?.context === subscriptionContext;
  const mounted = useRef(true);
  const liveId = useRef(id);
  useLayoutEffect(() => { liveId.current = id; }, [id]);
  const playRequest = useRef(0);
  const subscribeRequest = useRef<AbortController | null>(null);
  const finishSubscription = useCallback((controller: AbortController | null) => {
    if (!controller || subscribeRequest.current !== controller) return;
    subscribeRequest.current = null;
    if (mounted.current) setSubscribingRequest((before) => before?.controller === controller ? null : before);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.auth !== previous.auth || next.offline !== previous.offline || next.autoOffline !== previous.autoOffline) {
        setRequestEpoch((value) => value + 1);
        const canceled = subscribeRequest.current; canceled?.abort(); finishSubscription(canceled);
      }
    });
    return () => { mounted.current = false; const canceled = subscribeRequest.current; canceled?.abort(); finishSubscription(canceled); unsubscribe(); };
  }, [finishSubscription]);
  useEffect(() => { subscribeRequest.current?.abort(); }, [subscriptionContext]);
  const current = useCallback(() => mounted.current && liveId.current === id && profileScopeId() === profile && useAuthStore.getState().auth === auth, [auth, id, profile]);
  const files = usePodcastDownloads((state) => state.scope === hashKey(profile) ? state.files : EMPTY_FILES);
  const favorites = usePodcastFavoriteIds();
  const progress = useQuery({ queryKey: ['podcastPlayed', 'progress', id, profile],
    queryFn: ({ signal }) => readPodcastShowProgress(id, profile, signal), enabled: !!id });
  const refetchProgress = progress.refetch;
  useFocusEffect(useCallback(() => { if (id) void refetchProgress(); }, [id, refetchProgress]));

  const channel = useQuery({
    queryKey: ['podcastChannel', id, profile],
    queryFn: async () => {
      const owns = captureLyricOwner(profile); if (!current() || !owns()) throw new Error('Podcast profile changed');
      const value = await getChannel(id); if (!current() || !owns()) throw new Error('Podcast profile changed'); return value ?? null;
    },
    enabled: !!id,
    initialData: preview.channel,
  });
  useEffect(() => {
    if (!preview.channel || !current()) return;
    queryClient.setQueryData(['podcastChannel', id, profile], preview.channel);
    const key = ['podcastEpisodes', id, profile];
    if (queryClient.getQueriesData({ queryKey: key }).some(([, data]) => data !== undefined))
      void queryClient.invalidateQueries({ queryKey: key });
  }, [preview.channel, current, id, profile]);
  const realChannel = channel.data ?? preview.channel;
  const { order, openSort, sortSheet } = usePodcastEpisodeSort(EMPTY_EPISODES, realChannel?.id ?? params.id, lang, realChannel?.showType === 'serial');
  const partial = realChannel?.syncComplete === false;
  // A feed prefix is not the whole show's alphabetical/oldest-first result.
  // Keep the saved preference intact and restore it after the full snapshot.
  const pageOrder = partial ? 'recent' : order;
  const pageFilter = partial ? 'all' : filter, pageSeason = partial ? undefined : season;
  const episodes = useInfiniteQuery({
    queryKey: ['podcastEpisodes', id, profile, 'pages', pageOrder, lang, pageFilter, pageSeason ?? 'all'],
    queryFn: ({ pageParam, signal }) => listEpisodePage(id, { offset: pageParam, limit: pageParam === 0 ? 7 : 20,
      order: pageOrder, language: lang, filter: pageFilter, season: pageSeason }, { expectedProfile: profile, signal, current }),
    initialPageParam: 0, getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: !!id, staleTime: 60_000, retry: false,
  });
  const added = useQuery({ queryKey: ['podcastChannels', 'added', profile], queryFn: async () => {
    const owns = captureLyricOwner(profile); if (!current() || !owns()) throw new Error('Podcast profile changed');
    const value = await addedChannelIds(); if (!current() || !owns()) throw new Error('Podcast profile changed'); return value;
  } });
  const subscribed = !!added.data?.has(id);
  const partialFeedUrl = realChannel?.feedUrl;
  // A partially cached feed can also be reopened from the local podcast list,
  // without a Discovery handoff. Resume its full read under this screen owner.
  useFocusEffect(useCallback(() => {
    if (previewToken || !partial || !partialFeedUrl || isManualOffline()) return;
    const controller = new AbortController(), owns = captureLyricOwner(profile);
    const valid = () => current() && owns() && !controller.signal.aborted;
    setPartialError(undefined); setRefreshing(true);
    void refreshChannel(partialFeedUrl, { expectedProfile: profile, signal: controller.signal, current: valid,
      onPreview: (value) => { if (valid()) queryClient.setQueryData(['podcastChannel', id, profile], value); },
    }).then((value) => {
      if (!valid()) return;
      queryClient.setQueryData(['podcastChannel', id, profile], value);
      void queryClient.invalidateQueries({ queryKey: ['podcastEpisodes', id, profile] });
    }).catch(() => { if (valid()) setPartialError(id); }).finally(() => { if (valid()) setRefreshing(false); });
    return () => { controller.abort(); setRefreshing(false); };
  // Restart even a batched offline→online round trip whose final flags match.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewToken, partial, partialFeedUrl, profile, current, id, requestEpoch]));
  const savedProgress = progress.data ?? EMPTY_PROGRESS;
  const shown = useMemo(() => {
    const seen = new Set<string>();
    return episodes.data?.pages.flatMap((page) => page.items).filter((episode) => !seen.has(episode.id) && !!seen.add(episode.id)) ?? EMPTY_EPISODES;
  }, [episodes.data]);
  const seasons = episodes.data?.pages[0]?.seasons ?? [];
  const resumeId = partial ? undefined : episodes.data?.pages[0]?.resumeId;
  const playingEpisode = useQuery({ queryKey: ['podcastCurrentEpisode', playingId, profile],
    queryFn: async () => {
      const owns = captureLyricOwner(profile); if (!current() || !owns()) throw new Error('Podcast profile changed');
      const value = await getPodcastEpisode(playingId!); if (!current() || !owns()) throw new Error('Podcast profile changed'); return value ?? null;
    }, enabled: !!id && !!playingId && playingChannelId === id && (pageFilter !== 'all' || pageSeason !== undefined) });
  const showingCurrent = !!playingId && playingChannelId === id && (pageFilter === 'all' && pageSeason === undefined
    || shown.some((episode) => episode.id === playingId)
    || !!playingEpisode.data && filterPodcastEpisodes([playingEpisode.data], filter, savedProgress, files, season).length > 0);
  useEffect(() => {
    const key = ['podcastEpisodes', id, profile];
    if (id && queryClient.getQueriesData({ queryKey: key }).some(([, data]) => data !== undefined))
      void queryClient.invalidateQueries({ queryKey: key });
  }, [id, profile, files, savedProgress]);

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['podcastChannel', id] });
    void queryClient.invalidateQueries({ queryKey: ['podcastEpisodes', id] });
    void queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] });
  }, [id]);

  const refresh = useCallback(async () => {
    const feedUrl = realChannel?.feedUrl;
    if (!feedUrl || !current() || isManualOffline() || preview.pending || refreshing) return;
    setRefreshing(true);
    try {
      await refreshChannel(feedUrl);
      if (current()) { clearPreviewError(); reload(); }
    } catch {
      if (current()) toast(t("Couldn't read this feed"));
    } finally {
      if (current()) setRefreshing(false);
    }
  }, [realChannel?.feedUrl, current, reload, clearPreviewError, t, toast, preview.pending, refreshing]);

  const keepShow = async () => {
    const feed = realChannel?.feedUrl;
    if (!feed || !current() || partial || subscribed || subscribing || isManualOffline()) return;
    const controller = new AbortController();
    subscribeRequest.current?.abort(); subscribeRequest.current = controller;
    const valid = () => current() && !controller.signal.aborted && subscribeRequest.current === controller;
    setSubscribingRequest({ context: subscriptionContext, controller });
    try {
      const kept = await subscribe(feed, { expectedProfile: profile, signal: controller.signal, current: valid });
      if (!valid()) return;
      queryClient.setQueryData<Set<string>>(['podcastChannels', 'added', profile], (before) => new Set([...(before ?? []), kept.id]));
      toast(t('Subscribed'));
    } catch {
      if (valid()) toast(t("Couldn't subscribe to this podcast."));
    } finally { finishSubscription(controller); }
  };

  /** Read the available queue only after explicit play; paging never truncates it.
   * During the labeled feed preview, only verified episodes are available. */
  const play = useCallback(
    async (fromId?: string) => {
      const ch = realChannel;
      if (!ch || !current()) return;
      const serial = ++playRequest.current, owns = captureLyricOwner(profile);
      try {
        const [all, currentProgress] = await Promise.all([listEpisodes(ch.id), readPodcastShowProgress(ch.id, profile)]);
        if (!current() || !owns() || serial !== playRequest.current) return;
        const list = filterPodcastEpisodes(sortPodcastEpisodes(all, pageOrder, lang), pageFilter, currentProgress, files, pageSeason);
        const playable = list.filter((e) => (e.url || files[e.id]) && (!isManualOffline() || files[e.id]));
        const start = fromId ? playable.findIndex((episode) => episode.id === fromId) : 0;
        if (!playable.length || start < 0) { toast(t('Not available offline')); return; }
        void playQueue(playable.map((episode) => episodeToSong(episode, ch)), start, ch.title, `/podcast/${ch.id}`, { ordered: true });
      } catch { if (current() && owns() && serial === playRequest.current) toast(t("Couldn't load this podcast.")); }
    },
    [realChannel, current, playQueue, profile, pageOrder, lang, pageFilter, files, pageSeason, toast, t],
  );

  if (!realChannel && !preview.metadata && channel.isLoading) {
    return (
      <View style={styles.center}>
        <BackButton />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!realChannel && !preview.metadata) {
    return (
      <View style={styles.center}>
        <BackButton />
        <Message text={t("Couldn't load this podcast.")} onRetry={previewToken ? preview.retry : reload} />
      </View>
    );
  }

  const ch = realChannel ?? preview.metadata!;
  const ready = !!realChannel;
  const loading = preview.pending && !ready || episodes.isPending && !!id;
  const chip = (label: string, selected: boolean, onPress: () => void, palette: { text: string; playLabel: string; controlFill: string }) => <GlassPressable
    key={label} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={[styles.chip, { backgroundColor: selected ? '#FFFFFF' : palette.controlFill }]}>
    <Text style={{ color: selected ? palette.playLabel : palette.text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
  </GlassPressable>;
  return <>
    <PodcastDetailView channel={ch} episodes={shown} offline={offline && !automaticOffline} refreshing={refreshing}
      presentationIdentity={JSON.stringify([profile, previewToken ?? params.id])} initialArtworkUri={preview.metadata?.imageUrl}
      loadingMeta={partial || !ready && ch.episodeCount === undefined}
      pagingIdentity={JSON.stringify([id, profile, partial, pageOrder, lang, pageFilter, pageSeason ?? 'all'])}
      onRefresh={() => { if (preview.pending || refreshing) return; if (partial && previewToken || !ready) preview.retry(); else void refresh(); }}
      onEndReached={() => { if (!partial && episodes.hasNextPage && !episodes.isFetching && !episodes.isError) void episodes.fetchNextPage(); }}
      footer={episodes.isFetchingNextPage ? <ActivityIndicator color="#FFFFFF" style={{ padding: 20 }} />
        : episodes.isError && shown.length ? <PodcastStatus text={t("Couldn't load this podcast.")}
          onRetry={() => { if (episodes.isFetchNextPageError) void episodes.fetchNextPage(); else void episodes.refetch(); }} />
          : partial ? preview.error || partialError === id ? <PodcastStatus text={t('The rest of this feed could not be loaded. The available episodes can still be played.')}
            onRetry={() => { if (previewToken) preview.retry(); else void refresh(); }} />
              : <View style={styles.status}>{isManualOffline() ? null : <ActivityIndicator color="#FFFFFF" />}<Text style={styles.statusText}>{t(isManualOffline()
                ? 'Only part of this feed is available offline.' : 'You can play these episodes while the rest of the feed loads.')}</Text></View>
            : preview.error && ready ? <PodcastStatus text={t("This podcast's feed could not be read, so these episodes may be out of date.")}
              onRetry={() => { void refresh(); }} /> : null}
      actions={(palette) => <>
        <GlassPressable accessibilityRole="button" accessibilityLabel={t(showingCurrent && isPlaying ? 'Pause' : resumeId ? 'Continue playing' : 'Play')}
          disabled={!ready || !shown.length} onPress={() => { if (!ready) return; if (showingCurrent) void toggle(); else if (shown.length) void play(resumeId ?? undefined); }}
          style={[styles.action, { backgroundColor: '#FFFFFF' }, (!ready || !shown.length) && { opacity: .5 }]}>
          <Icon name={showingCurrent && isPlaying ? 'pause' : 'play'} size={17} color={palette.playLabel} />
          <Text style={[styles.actionText, { color: palette.playLabel }]}>{t(showingCurrent && isPlaying ? 'Pause' : resumeId ? 'Continue playing' : 'Play')}</Text>
        </GlassPressable>
        {ch.feedUrl ? <GlassPressable accessibilityRole="button" accessibilityState={{ selected: subscribed, busy: subscribing }}
          disabled={!ready || partial || added.isPending || subscribing || (!subscribed && offline && !automaticOffline)}
          style={[styles.action, { backgroundColor: palette.controlFill }, !subscribed && offline && !automaticOffline && { opacity: .45 }]}
          onPress={() => { if (ready && !partial && current()) { if (subscribed) openPodcastMenu(ch); else void keepShow(); } }}>
          {subscribing || added.isPending ? <ActivityIndicator size="small" color={palette.text} /> : <Icon name={subscribed ? 'checkmark' : 'add'} size={18} color={palette.text} />}
          <Text style={[styles.actionText, { color: palette.text }]}>{t(subscribed ? 'Subscribed' : 'Subscribe')}</Text>
        </GlassPressable> : null}
      </>}
      toolbar={(palette) => <>
        <GlassPressable style={styles.tool} disabled={!ready || partial} onPress={openSort} accessibilityLabel={t('Sort by')}><Icon name="swap-vertical" size={22} color={palette.text} /></GlassPressable>
        <GlassPressable style={[styles.tool, offline && { opacity: .45 }]} disabled={!ready || partial || offline} accessibilityLabel={t('Download episodes')}
          onPress={() => { if (ready && !partial && current()) setDownloadTarget({ channel: ch, owner: auth, profile }); }}>
          <Icon name="arrow-down-circle-outline" size={23} color={palette.text} />
        </GlassPressable>
        <GlassPressable style={styles.tool} disabled={!ready || partial} onPress={() => { if (ready && !partial && current()) openPodcastMenu(ch); }} accessibilityLabel={t('More')}>
          <Icon name="ellipsis-horizontal" size={23} color={palette.text} />
        </GlassPressable>
      </>}
      filters={(palette) => <View style={styles.filters}>
        {ch.error ? <Text style={{ color: palette.textSecondary, fontSize: 13 }}>{t("This podcast's feed could not be read, so these episodes may be out of date.")}</Text> : null}
        <Text style={{ color: palette.text, fontSize: 20, fontWeight: '700' }}>{t(partial ? 'First episodes' : 'Episodes')}</Text>
        {!partial ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {([['all', 'All episodes'], ['unplayed', 'Unplayed'], ['progress', 'In progress'], ['downloaded', 'Downloaded']] as const)
            .map(([value, label]) => chip(t(label), filter === value, () => setFilter(value), palette))}
        </ScrollView> : null}
        {!partial && seasons.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {chip(t('All seasons'), season === undefined, () => setSeason(undefined), palette)}
          {seasons.map((value) => chip(t('Season {n}', { n: value }), season === value, () => setSeason(value), palette))}
          {chip(t('Other episodes'), season === 'other', () => setSeason('other'), palette)}
        </ScrollView> : null}
      </View>}
      renderEpisode={(episode, index, palette) => <PodcastEpisodeRow episode={episode} palette={palette} saved={savedProgress.get(episode.id)}
        downloaded={!!files[episode.id]} favorite={favorites.has(episode.id)} fresh={!!ch.newSinceAt && (episode.firstSeenAt ?? 0) >= ch.newSinceAt}
        unavailable={isManualOffline() && !files[episode.id]} first={index === 0} last={index === shown.length - 1} language={lang}
        onPlay={() => { void play(episode.id); }} onMenu={() => { if (ready && current()) openPodcastEpisodeMenu(ch, episode); }}
        onDetails={() => { if (current()) router.push({ pathname: '/podcast-episode/[id]', params: { id: episode.id, channelId: ch.id } }); }} />}
      empty={loading ? <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
        <ActivityIndicator color="#FFFFFF" /><Text style={styles.empty}>{t('Loading…')}</Text></View>
        : preview.error && !ready ? <PodcastStatus text={t(isManualOffline() ? 'Not available offline' : "Couldn't preview this podcast. Try again.")} onRetry={preview.retry} />
          : episodes.isError ? <PodcastStatus text={t("Couldn't load this podcast.")} onRetry={() => { void episodes.refetch(); }} />
            : <Text style={styles.empty}>{t('No episodes match this filter.')}</Text>} />
    {sortSheet}
    <PodcastDownloadDialog channel={downloadTarget?.owner === auth && downloadTarget.profile === profile ? downloadTarget.channel : null} onClose={() => setDownloadTarget(null)} />
  </>;
}

function PodcastStatus({ text, onRetry }: { text: string; onRetry(): void }) {
  const t = useT();
  return <View style={styles.status}>
    <Text style={styles.statusText}>{text}</Text>
    <GlassPressable variant="subtle" style={styles.retry} onPress={onRetry}>
      <Text style={styles.retryText}>{t('Retry')}</Text>
    </GlassPressable>
  </View>;
}

const styles = themed((palette) => ({
  center: { flex: 1, justifyContent: 'center', backgroundColor: palette.background },
  action: { flex: 1, minHeight: 48, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  actionText: { fontSize: 16, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  tool: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 12, paddingBottom: 16 }, chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  empty: { color: '#FFFFFFCC', paddingVertical: 28, fontSize: 14, textAlign: 'center' },
  status: { padding: 24, gap: 14, alignItems: 'center' }, statusText: { color: '#FFFFFFDD', fontSize: 14, textAlign: 'center' },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#FFFFFF' },
  retryText: { color: '#222222', fontSize: 14, fontWeight: '600' },
}));
