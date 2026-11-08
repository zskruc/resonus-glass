/** One podcast and its episodes, played straight from the publisher's files. */
import { GlassPressable } from '@/components/glass';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { addedChannelIds, getChannel, listEpisodes, episodeToSong, refreshChannel, subscribe, type PodcastEpisode, type PodcastChannel } from '@/api/podcasts';
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
import { filterPodcastEpisodes, podcastListeningState, readPodcastShowProgress, type PodcastEpisodeFilter, type PodcastProgress } from '@/lib/podcastLibrary';
import { hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';

const EMPTY_EPISODES: PodcastEpisode[] = [];

const EMPTY_FILES: Record<string, string> = {};
const EMPTY_PROGRESS = new Map<string, PodcastProgress>();

export default function PodcastScreen() {
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT(), router = useRouter();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playingId = usePlayerStore((s) => currentSong(s)?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying), toggle = usePlayerStore((s) => s.toggle);
  const [filter, setFilter] = useState<PodcastEpisodeFilter>('all');
  const [season, setSeason] = useState<number | 'other' | undefined>();
  const [downloadTarget, setDownloadTarget] = useState<{ channel: PodcastChannel; owner: unknown; profile: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [subscribingRequest, setSubscribingRequest] = useState<{ context: object; controller: AbortController } | null>(null);
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const offline = useAuthStore((state) => state.offline), automaticOffline = useAuthStore((state) => state.autoOffline);
  const subscriptionContext = useMemo(() => ({ auth, profile, id, offline, automaticOffline }), [auth, profile, id, offline, automaticOffline]);
  const subscribing = subscribingRequest?.context === subscriptionContext;
  const mounted = useRef(true);
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
        const canceled = subscribeRequest.current; canceled?.abort(); finishSubscription(canceled);
      }
    });
    return () => { mounted.current = false; const canceled = subscribeRequest.current; canceled?.abort(); finishSubscription(canceled); unsubscribe(); };
  }, [finishSubscription]);
  useEffect(() => { subscribeRequest.current?.abort(); }, [subscriptionContext]);
  const current = useCallback(() => mounted.current && profileScopeId() === profile && useAuthStore.getState().auth === auth, [auth, profile]);
  const files = usePodcastDownloads((state) => state.scope === hashKey(profile) ? state.files : EMPTY_FILES);
  const favorites = usePodcastFavoriteIds();
  const progress = useQuery({ queryKey: ['podcastPlayed', 'progress', id, profile],
    queryFn: ({ signal }) => readPodcastShowProgress(id, profile, signal), enabled: !!id });
  const refetchProgress = progress.refetch;
  useFocusEffect(useCallback(() => { void refetchProgress(); }, [refetchProgress]));

  const channel = useQuery({
    queryKey: ['podcastChannel', id, profile],
    queryFn: async () => {
      const owns = captureLyricOwner(profile); if (!current() || !owns()) throw new Error('Podcast profile changed');
      const value = await getChannel(id); if (!current() || !owns()) throw new Error('Podcast profile changed'); return value ?? null;
    },
    enabled: !!id,
  });

  const episodes = useQuery({
    queryKey: ['podcastEpisodes', id, profile],
    queryFn: async () => {
      const owns = captureLyricOwner(profile); if (!current() || !owns()) throw new Error('Podcast profile changed');
      const value = await listEpisodes(id); if (!current() || !owns()) throw new Error('Podcast profile changed'); return value;
    },
    enabled: !!id,
  });
  const added = useQuery({ queryKey: ['podcastChannels', 'added', profile], queryFn: async () => {
    const owns = captureLyricOwner(profile); if (!current() || !owns()) throw new Error('Podcast profile changed');
    const value = await addedChannelIds(); if (!current() || !owns()) throw new Error('Podcast profile changed'); return value;
  } });
  const subscribed = !!added.data?.has(id);
  const { episodes: sorted, openSort, sortSheet } = usePodcastEpisodeSort(episodes.data ?? EMPTY_EPISODES, channel.data?.id ?? id, lang, channel.data?.showType === 'serial');

  const savedProgress = progress.data ?? EMPTY_PROGRESS;
  const shown = useMemo(() => filterPodcastEpisodes(sorted, filter, savedProgress, files, season), [sorted, filter, savedProgress, files, season]);
  const seasons = useMemo(() => [...new Set(sorted.map((episode) => (episode as PodcastEpisode & { season?: number }).season)
    .filter((value): value is number => value !== undefined))].sort((a, b) => b - a), [sorted]);
  const resumeIndex = shown.findIndex((episode) => podcastListeningState(episode, savedProgress.get(episode.id)).inProgress);
  const showingCurrent = !!playingId && shown.some((episode) => episode.id === playingId);

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['podcastChannel', id] });
    void queryClient.invalidateQueries({ queryKey: ['podcastEpisodes', id] });
    void queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] });
  }, [id]);

  const refresh = useCallback(async () => {
    const feedUrl = channel.data?.feedUrl;
    if (!feedUrl || !current() || isManualOffline()) return;
    setRefreshing(true);
    try {
      await refreshChannel(feedUrl);
      if (current()) reload();
    } catch {
      if (current()) toast(t("Couldn't read this feed"));
    } finally {
      if (current()) setRefreshing(false);
    }
  }, [channel.data?.feedUrl, current, reload, t, toast]);

  const keepShow = async () => {
    const feed = channel.data?.feedUrl;
    if (!feed || !current() || subscribed || subscribing || isManualOffline()) return;
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

  /** The whole playable list, starting at the one tapped. */
  const play = useCallback(
    (list: PodcastEpisode[], from: number) => {
      const ch = channel.data;
      if (!ch || !current()) return;
      const playable = list.filter((e) => (e.url || files[e.id]) && (!isManualOffline() || files[e.id]));
      if (!playable.length) { toast(t('Not available offline')); return; }
      const start = playable.findIndex((e) => e.id === list[from]?.id);
      void playQueue(
        playable.map((e) => episodeToSong(e, ch)),
        start < 0 ? 0 : start,
        ch.title,
        `/podcast/${ch.id}`,
        { ordered: true },
      );
    },
    [channel.data, current, playQueue, files, toast, t],
  );

  if (channel.isLoading || episodes.isLoading) {
    return (
      <View style={styles.center}>
        <BackButton />
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
  const chip = (label: string, selected: boolean, onPress: () => void, palette: { text: string; playLabel: string; controlFill: string }) => <GlassPressable
    key={label} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={[styles.chip, { backgroundColor: selected ? '#FFFFFF' : palette.controlFill }]}>
    <Text style={{ color: selected ? palette.playLabel : palette.text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
  </GlassPressable>;
  return <>
    <PodcastDetailView channel={ch} episodes={shown} offline={offline && !automaticOffline} refreshing={refreshing} onRefresh={() => { void refresh(); }}
      actions={(palette) => <>
        <GlassPressable accessibilityRole="button" accessibilityLabel={t(showingCurrent && isPlaying ? 'Pause' : resumeIndex >= 0 ? 'Continue playing' : 'Play')}
          disabled={!shown.length} onPress={() => { if (showingCurrent) void toggle(); else if (shown.length) play(shown, resumeIndex >= 0 ? resumeIndex : 0); }}
          style={[styles.action, { backgroundColor: '#FFFFFF' }, !shown.length && { opacity: .5 }]}>
          <Icon name={showingCurrent && isPlaying ? 'pause' : 'play'} size={17} color={palette.playLabel} />
          <Text style={[styles.actionText, { color: palette.playLabel }]}>{t(showingCurrent && isPlaying ? 'Pause' : resumeIndex >= 0 ? 'Continue playing' : 'Play')}</Text>
        </GlassPressable>
        {ch.feedUrl ? <GlassPressable accessibilityRole="button" accessibilityState={{ selected: subscribed, busy: subscribing }}
          disabled={added.isPending || subscribing || (!subscribed && offline && !automaticOffline)}
          style={[styles.action, { backgroundColor: palette.controlFill }, !subscribed && offline && !automaticOffline && { opacity: .45 }]}
          onPress={() => { if (current()) { if (subscribed) openPodcastMenu(ch); else void keepShow(); } }}>
          {subscribing || added.isPending ? <ActivityIndicator size="small" color={palette.text} /> : <Icon name={subscribed ? 'checkmark' : 'add'} size={18} color={palette.text} />}
          <Text style={[styles.actionText, { color: palette.text }]}>{t(subscribed ? 'Subscribed' : 'Subscribe')}</Text>
        </GlassPressable> : null}
      </>}
      toolbar={(palette) => <>
        <GlassPressable style={styles.tool} onPress={openSort} accessibilityLabel={t('Sort by')}><Icon name="swap-vertical" size={22} color={palette.text} /></GlassPressable>
        <GlassPressable style={[styles.tool, offline && { opacity: .45 }]} disabled={offline} accessibilityLabel={t('Download episodes')}
          onPress={() => { if (current()) setDownloadTarget({ channel: ch, owner: auth, profile }); }}>
          <Icon name="arrow-down-circle-outline" size={23} color={palette.text} />
        </GlassPressable>
        <GlassPressable style={styles.tool} onPress={() => { if (current()) openPodcastMenu(ch); }} accessibilityLabel={t('More')}>
          <Icon name="ellipsis-horizontal" size={23} color={palette.text} />
        </GlassPressable>
      </>}
      filters={(palette) => <View style={styles.filters}>
        {ch.error ? <Text style={{ color: palette.textSecondary, fontSize: 13 }}>{t("This podcast's feed could not be read, so these episodes may be out of date.")}</Text> : null}
        <Text style={{ color: palette.text, fontSize: 20, fontWeight: '700' }}>{t('Episodes')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {([['all', 'All episodes'], ['unplayed', 'Unplayed'], ['progress', 'In progress'], ['downloaded', 'Downloaded']] as const)
            .map(([value, label]) => chip(t(label), filter === value, () => setFilter(value), palette))}
        </ScrollView>
        {seasons.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {chip(t('All seasons'), season === undefined, () => setSeason(undefined), palette)}
          {seasons.map((value) => chip(t('Season {n}', { n: value }), season === value, () => setSeason(value), palette))}
          {sorted.some((episode) => (episode as PodcastEpisode & { season?: number }).season === undefined)
            ? chip(t('Other episodes'), season === 'other', () => setSeason('other'), palette) : null}
        </ScrollView> : null}
      </View>}
      renderEpisode={(episode, index, palette) => <PodcastEpisodeRow episode={episode} palette={palette} saved={savedProgress.get(episode.id)}
        downloaded={!!files[episode.id]} favorite={favorites.has(episode.id)} fresh={!!ch.newSinceAt && (episode.firstSeenAt ?? 0) >= ch.newSinceAt}
        unavailable={isManualOffline() && !files[episode.id]} first={index === 0} last={index === shown.length - 1} language={lang}
        onPlay={() => play(shown, index)} onMenu={() => { if (current()) openPodcastEpisodeMenu(ch, episode); }}
        onDetails={() => { if (current()) router.push({ pathname: '/podcast-episode/[id]', params: { id: episode.id, channelId: ch.id } }); }} />}
      empty={<Text style={styles.empty}>{t('No episodes match this filter.')}</Text>} />
    {sortSheet}
    <PodcastDownloadDialog channel={downloadTarget?.owner === auth && downloadTarget.profile === profile ? downloadTarget.channel : null} onClose={() => setDownloadTarget(null)} />
  </>;
}

const styles = themed((palette) => ({
  center: { flex: 1, justifyContent: 'center', backgroundColor: palette.background },
  action: { flex: 1, minHeight: 48, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  actionText: { fontSize: 16, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  tool: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 12, paddingBottom: 16 }, chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  empty: { color: '#FFFFFFCC', paddingVertical: 28, fontSize: 14, textAlign: 'center' },
}));
