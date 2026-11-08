/** Publisher-provided notes/chapters; no media is fetched until Play is tapped. */
import { fetch } from 'expo/fetch';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { episodeToSong, podcastCover } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import type { PodcastChapter, PodcastTranscript } from '@/api/subsonic';
import { BackChevron } from '@/components/BackChevron';
import { Cover } from '@/components/Cover';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { PodcastShowNote } from '@/components/PodcastShowNotes';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { hashKey } from '@/lib/localLibrary';
import { fetchPodcastChapters, normalizePodcastChapters } from '@/lib/podcastChapters';
import * as Db from '@/lib/podcastDb';
import { playPodcastEpisodeAt } from '@/lib/podcastEpisodePlayback';
import { podcastShowNotes, safePodcastUrl } from '@/lib/podcastShowNotes';
import { queryClient } from '@/lib/query';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { currentSong, playbackUserSeekVersion, usePlayerStore } from '@/store/player';
import { podcastFile } from '@/store/podcastDownloads';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

type DetailRow = { kind: 'note'; block: ReturnType<typeof podcastShowNotes>[number] }
  | { kind: 'chapter'; chapter: PodcastChapter } | { kind: 'transcript'; transcript: PodcastTranscript };
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds)), hours = Math.floor(whole / 3600), minutes = Math.floor(whole % 3600 / 60), rest = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}
export default function PodcastEpisodeScreen() {
  useTheme();
  const t = useT(), router = useRouter(), focused = useIsFocused(), insets = useSafeAreaInsets(), bottom = useScreenBottomPadding();
  const scroll = useLiquidDockScrollHandler(), params = useLocalSearchParams<{ id: string; channelId?: string }>();
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const automaticOffline = useAuthStore((state) => state.autoOffline);
  const profile = profileScopeId(), id = params.id, expectedChannel = params.channelId;
  const lang = useSettings((state) => state.language), toast = useToast((state) => state.show);
  const playing = usePlayerStore((state) => currentSong(state)?.id === id && state.isPlaying);
  const [tab, setTab] = useState<'notes' | 'chapters'>('notes'), [busy, setBusy] = useState(false);
  const mounted = useRef(true), active = useRef(focused), playBusy = useRef(false);
  useLayoutEffect(() => { active.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useCallback(() => mounted.current && active.current && profileScopeId() === profile && useAuthStore.getState().auth === auth, [profile, auth]);
  const detailsKey = useMemo(() => ['podcastEpisodeDetail', profile, id, expectedChannel], [profile, id, expectedChannel]);
  const details = useQuery({ queryKey: detailsKey, enabled: !!id && focused, staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const owns = captureLyricOwner(profile), valid = () => current() && owns() && !signal.aborted;
      if (!valid()) throw new Error('Podcast profile changed');
      const episode = await Db.getEpisode(hashKey(profile), id);
      if (!valid()) throw new Error('Podcast profile changed');
      if (!episode || expectedChannel && episode.channelId !== expectedChannel) return null;
      const channel = await Db.getChannel(hashKey(profile), episode.channelId);
      if (!valid()) throw new Error('Podcast profile changed');
      return channel && channel.id === episode.channelId ? { episode, channel } : null;
    } });
  const episode = details.data?.episode, channel = details.data?.channel;
  const chapterUrl = safePodcastUrl(episode?.chaptersUrl);
  const chaptersKey = useMemo(() => ['podcastEpisodeChapters', profile, id, chapterUrl], [profile, id, chapterUrl]);
  const remote = useQuery({ queryKey: chaptersKey, enabled: false, retry: false, staleTime: Infinity, gcTime: 5 * 60_000,
    queryFn: ({ signal }) => {
      const owns = captureLyricOwner(profile);
      return fetchPodcastChapters(chapterUrl!, { fetch, signal, offline: isManualOffline, current: () => current() && owns() });
    } });
  useEffect(() => {
    if (!focused) {
      void queryClient.cancelQueries({ queryKey: detailsKey, exact: true });
      void queryClient.cancelQueries({ queryKey: chaptersKey, exact: true });
    }
    return () => { void queryClient.cancelQueries({ queryKey: detailsKey, exact: true }); void queryClient.cancelQueries({ queryKey: chaptersKey, exact: true }); };
  }, [focused, detailsKey, chaptersKey, auth, offline, automaticOffline]);
  const chapters = useMemo(() => remote.data ?? normalizePodcastChapters(episode?.chapters ?? []), [remote.data, episode?.chapters]);
  const notes = useMemo(() => podcastShowNotes(episode?.descriptionHtml ?? episode?.description, channel?.siteUrl ?? channel?.feedUrl), [episode?.descriptionHtml, episode?.description, channel?.siteUrl, channel?.feedUrl]);
  const transcripts = useMemo(() => (episode?.transcripts ?? []).filter((item) => safePodcastUrl(item.url)).slice(0, 10), [episode?.transcripts]);
  const rows = useMemo<DetailRow[]>(() => tab === 'chapters' ? chapters.map((chapter) => ({ kind: 'chapter', chapter }))
    : [...notes.map((block): DetailRow => ({ kind: 'note', block })), ...transcripts.map((transcript): DetailRow => ({ kind: 'transcript', transcript }))], [tab, notes, chapters, transcripts]);
  const openLink = useCallback((url: string) => {
    const safe = safePodcastUrl(url);
    if (safe && current()) void Linking.openURL(safe).catch(() => { if (current()) toast(t('Could not open this link.')); });
  }, [current, toast, t]);
  const play = useCallback(async (seconds?: number) => {
    if (!episode || !channel || !current() || playBusy.current) return;
    const owns = captureLyricOwner(profile); playBusy.current = true; setBusy(true);
    try {
      const result = await playPodcastEpisodeAt(episode, channel, seconds, {
        current: () => current() && owns(),
        available: () => !!podcastFile(episodeToSong(episode, channel)) || !!episode.url && !isManualOffline(),
        toSong: episodeToSong,
        read: () => { const state = usePlayerStore.getState(), song = currentSong(state); return {
          songId: song?.id, channelId: song?.podcastChannelId, queue: state.queue, index: state.index,
          playing: state.isPlaying, loading: state.isBuffering, seekVersion: playbackUserSeekVersion() }; },
        play: (song, show) => usePlayerStore.getState().playQueue([song], 0, show.title, `/podcast/${show.id}`, { ordered: true }),
        seek: (at) => usePlayerStore.getState().seekTo(at), toggle: () => { void usePlayerStore.getState().toggle(); },
      });
      if (current() && owns() && result === 'unavailable') toast(t('Not available offline'));
    } catch { if (current() && owns()) toast(t('Could not play this episode.')); }
    finally { playBusy.current = false; if (mounted.current) setBusy(false); }
  }, [episode, channel, current, profile, toast, t]);
  const date = episode?.publishedAt ? new Date(episode.publishedAt).toLocaleDateString(lang) : '';
  const header = details.isPending ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : !episode || !channel ?
    <Message text={t('Could not load this episode.')} onRetry={() => { void details.refetch(); }} /> : <View style={styles.header}>
      <Cover uri={episode.imageUrl ?? podcastCover(channel)} size={220} />
      <Text style={styles.show} onPress={() => { if (current()) router.push(`/podcast/${channel.id}`); }}>{channel.title}</Text>
      <Text style={styles.title}>{episode.title || t('Episode')}</Text>
      <Text style={styles.metadata}>{[date, episode.season ? t('Season {n}', { n: episode.season }) : '',
        episode.episode ? t('Episode {n}', { n: episode.episode }) : '', episode.episodeType && episode.episodeType !== 'full' ? t(episode.episodeType === 'trailer' ? 'Trailer' : 'Bonus') : '',
        episode.duration ? clock(episode.duration) : ''].filter(Boolean).join(' · ')}</Text>
      <GlassPressable variant="prominent" tint={colors.accent} disabled={busy} style={styles.play} onPress={() => { void play(); }}
        accessibilityRole="button" accessibilityLabel={playing ? t('Pause') : t('Play')}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : <Icon name={playing ? 'pause' : 'play'} size={22} color={colors.onAccent} />}
        <Text style={styles.playText}>{playing ? t('Pause') : t('Play')}</Text>
      </GlassPressable>
      <View style={styles.tabs}>
        {(['notes', ...(chapters.length || chapterUrl ? ['chapters'] : [])] as ('notes' | 'chapters')[]).map((item) =>
          <GlassPressable key={item} variant={tab === item ? 'regular' : 'subtle'} style={styles.tab} onPress={() => setTab(item)} accessibilityState={{ selected: tab === item }}>
            <Text style={[styles.tabText, tab === item && { color: colors.accent }]}>{t(item === 'notes' ? 'Show notes' : 'Chapters')}</Text>
          </GlassPressable>)}
      </View>
      {tab === 'chapters' && chapterUrl ? <View style={styles.remote}>
        <GlassPressable variant="regular" disabled={remote.isFetching || isManualOffline()} style={styles.load} accessibilityRole="button"
          onPress={() => { if (current() && !isManualOffline()) void remote.refetch(); }}>
          {remote.isFetching ? <ActivityIndicator color={colors.accent} /> : <Icon name="list-outline" size={20} color={colors.accent} />}
          <Text style={styles.link}>{t(remote.data ? 'Refresh chapters' : 'Load chapters')}</Text>
        </GlassPressable>
        {remote.isError ? <Text style={styles.metadata}>{t('Could not load chapters. Try again.')}</Text> : null}
        {offline && isManualOffline() && !remote.data ? <Text style={styles.metadata}>{t('Online chapters are unavailable offline.')}</Text> : null}
      </View> : null}
    </View>;
  return <View style={[styles.safe, { paddingTop: insets.top }]}>
    <View style={styles.top}><BackChevron /><Text style={styles.topTitle}>{t('Episode details')}</Text><View style={{ width: 26 }} /></View>
    <Animated.FlatList data={rows} keyExtractor={(_, index) => `${tab}:${index}`} contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5} ListHeaderComponent={header} onScroll={scroll} scrollEventThrottle={16}
      ListEmptyComponent={!details.isPending && episode ? <Text style={styles.empty}>{t(tab === 'notes' ? 'No show notes available.' : 'No chapters supplied for this episode.')}</Text> : null}
      renderItem={({ item }) => item.kind === 'note' ? <PodcastShowNote block={item.block} onLink={openLink} onTimestamp={(at) => { void play(at); }} disabled={busy} />
        : item.kind === 'transcript' ? <GlassPressable variant="subtle" style={styles.chapter} onPress={() => openLink(item.transcript.url)} accessibilityRole="link">
          <Icon name="document-text-outline" size={22} color={colors.accent} /><View style={styles.rowText}>
            <Text style={styles.link}>{t('Open transcript')}</Text><Text style={styles.metadata}>{[item.transcript.language, item.transcript.type].filter(Boolean).join(' · ')}</Text>
          </View><Icon name="open-outline" size={18} color={colors.textMuted} />
        </GlassPressable> : <View style={styles.chapter}>
          <GlassPressable variant="subtle" disabled={busy} style={styles.chapterMain} onPress={() => { void play(item.chapter.startSec); }} accessibilityRole="button">
            <Text style={styles.chapterTime}>{clock(item.chapter.startSec)}</Text><Text style={styles.chapterTitle}>{item.chapter.title}</Text>
          </GlassPressable>
          {item.chapter.url ? <GlassPressable variant="subtle" hitSlop={10} accessibilityRole="link" accessibilityLabel={t('Open website')}
            onPress={() => openLink(item.chapter.url!)}><Icon name="open-outline" size={20} color={colors.textMuted} /></GlassPressable> : null}
        </View>} />
  </View>;
}
const styles = themed((palette) => ({
  safe: { flex: 1, backgroundColor: palette.background }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  topTitle: { color: palette.text, fontSize: fontSize.md, fontWeight: '600' }, content: { paddingHorizontal: spacing.lg, maxWidth: 720, width: '100%', alignSelf: 'center' },
  loading: { padding: spacing.xl }, header: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
  show: { color: palette.accent, fontSize: fontSize.md, fontWeight: '500', textAlign: 'center' }, title: { color: palette.text, fontSize: 26, fontWeight: '700', textAlign: 'center', lineHeight: 33 },
  metadata: { color: palette.textSecondary, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'center' },
  play: { backgroundColor: palette.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill, minWidth: 148 },
  playText: { color: palette.onAccent, fontSize: fontSize.md, fontWeight: '600' }, tabs: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill }, tabText: { color: palette.textSecondary, fontSize: fontSize.md, fontWeight: '600' },
  remote: { gap: spacing.sm, width: '100%', alignItems: 'center' }, load: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.pill },
  link: { color: palette.accent, fontSize: fontSize.md, fontWeight: '500' }, empty: { color: palette.textMuted, fontSize: fontSize.md, textAlign: 'center', padding: spacing.xl },
  chapter: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: .5, borderBottomColor: palette.surfaceHighlight },
  chapterMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  chapterTime: { color: palette.accent, fontSize: fontSize.sm, fontVariant: ['tabular-nums'], minWidth: 58 }, chapterTitle: { color: palette.text, fontSize: fontSize.md, flex: 1, lineHeight: 23 }, rowText: { flex: 1, gap: 4 },
}));
