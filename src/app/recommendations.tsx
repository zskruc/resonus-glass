import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { COVER, markUnplayableOffline, songCoverUrl } from '@/api/data';
import { EmptyState } from '@/components/EmptyState';
import { RECOMMENDATION_DESCRIPTIONS, RECOMMENDATION_TITLES } from '@/components/DailyRecommendationsSection';
import { TrackListView } from '@/components/TrackListView';
import { songsLabel, useT } from '@/i18n';
import { RECOMMENDATION_KINDS, type RecommendationKind } from '@/lib/dailyRecommendations';
import { resolveRecommendationQueue } from '@/lib/recommendationPlayback';
import { currentRecommendationSongs } from '@/lib/recommendationPlaybackSource';
import { useAuthStore } from '@/store/auth';
import { useDailyRecommendations } from '@/store/dailyRecommendations';
import { useDownloads } from '@/store/downloads';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { recommendationProfileScope } from '@/store/shufflePreferences';
import { useToast } from '@/store/toast';
import { colors, spacing, useTheme } from '@/theme';

const EMPTY: never[] = [];
export default function RecommendationsScreen() {
  useTheme();
  const t = useT(), { kind: requested } = useLocalSearchParams<{ kind?: string }>();
  const kind: RecommendationKind = (RECOMMENDATION_KINDS as readonly string[]).includes(requested ?? '') ? requested as RecommendationKind : 'daily';
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const profile = recommendationProfileScope(), language = useSettings((state) => state.language);
  const files = useDownloads((state) => state.files), hideUnavailable = useSettings((state) => state.hideUnavailableOffline);
  const snapshot = useDailyRecommendations((state) => state.profile === profile ? state.snapshot : null);
  const loading = useDailyRecommendations((state) => state.loading), error = useDailyRecommendations((state) => state.error);
  const preparationIdentity = useMemo(() => ({ profile, kind, generatedAt: snapshot?.generatedAt, auth, offline }), [profile, kind, snapshot?.generatedAt, auth, offline]);
  const [preparation, setPreparation] = useState<object | null>(null), playIntent = useRef(0);
  const preparing = preparation === preparationIdentity;
  const playing = usePlayerStore((state) => currentSong(state)?.id), playQueue = usePlayerStore((state) => state.playQueue);
  const source = snapshot?.lists[kind] ?? EMPTY;
  // File completion, offline mode and the visibility preference all change
  // this annotation even while the saved metadata object remains unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const songs = useMemo(() => markUnplayableOffline(source), [source, offline, files, hideUnavailable]);
  useEffect(() => { void useDailyRecommendations.getState().ensure(); }, [profile, auth, offline]);
  useEffect(() => () => { playIntent.current++; }, [profile, kind, snapshot?.generatedAt]);
  const title = t(RECOMMENDATION_TITLES[kind]);
  if (!snapshot && loading) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;
  return <TrackListView playlistPresentation title={title} subtitle={t(RECOMMENDATION_DESCRIPTIONS[kind])}
    meta={`${songsLabel(songs.length, language)}${preparing ? ` · ${t('Loading songs…')}` : ''}`} coverUri={songs[0] ? songCoverUrl(songs[0], COVER.card) : undefined}
    songs={songs} currentId={playing} showArtwork searchable
    addAction={{ label: t('Refresh recommendations'), icon: 'refresh', onPress: () => { if (!loading) void useDailyRecommendations.getState().refresh(); } }}
    footer={error ? <Text style={{ color: colors.textSecondary, padding: spacing.lg }}>{t('Could not refresh recommendations. Your saved picks are kept.')}</Text> : undefined}
    emptyState={<EmptyState icon="musical-notes-outline" title={t('Not enough music yet')} subtitle={t('Recommendations use music already in your library.')} />}
    onPlay={async (start, options) => {
      const owner = useAuthStore.getState(), intent = ++playIntent.current;
      const current = () => intent === playIntent.current && profile === recommendationProfileScope() && owner === useAuthStore.getState();
      if (!current()) return;
      setPreparation(preparationIdentity);
      try {
        const queue = await resolveRecommendationQueue(songs, start, currentRecommendationSongs, current);
        if (!current()) return;
        if (!queue) { useToast.getState().show(t("Couldn't load songs.")); return; }
        return await playQueue(queue.songs, queue.index, title, `/recommendations?kind=${kind}`, options);
      } catch {
        if (current()) useToast.getState().show(t("Couldn't load songs."));
      } finally { if (current()) setPreparation(null); }
    }} />;
}
