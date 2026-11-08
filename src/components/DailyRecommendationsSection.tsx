import { useEffect } from 'react';
import { AppState, ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { COVER, songCoverUrl } from '@/api/data';
import { Cover } from '@/components/Cover';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { useScreenSize } from '@/hooks/useScreenSize';
import { songsLabel, useT } from '@/i18n';
import { localRecommendationDay, RECOMMENDATION_KINDS, type RecommendationKind } from '@/lib/dailyRecommendations';
import { useAuthStore } from '@/store/auth';
import { useDailyRecommendations } from '@/store/dailyRecommendations';
import { useSettings } from '@/store/settings';
import { recommendationProfileScope } from '@/store/shufflePreferences';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

export const RECOMMENDATION_TITLES: Record<RecommendationKind, string> = {
  daily: 'Daily mix', rewind: 'From the archives', releases: 'New releases',
};
export const RECOMMENDATION_DESCRIPTIONS: Record<RecommendationKind, string> = {
  daily: 'A mix of favorites and discoveries', rewind: 'Older music worth revisiting', releases: 'Recent releases in your library',
};

export function DailyRecommendationsSection({ appleMusic }: { appleMusic: boolean }) {
  useTheme();
  const { width } = useScreenSize(), t = useT(), language = useSettings((state) => state.language);
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const source = useAuthStore((state) => state.offlineSource);
  const saved = useDailyRecommendations((state) => state.snapshot), loading = useDailyRecommendations((state) => state.loading);
  const error = useDailyRecommendations((state) => state.error), owner = useDailyRecommendations((state) => state.profile);
  const current = recommendationProfileScope();
  const snapshot = owner === current ? saved : null;
  useEffect(() => {
    if (!auth && !offline) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => { if (live) void useDailyRecommendations.getState().ensure(); };
    const arm = () => {
      const now = new Date(), next = new Date(now);
      next.setDate(next.getDate() + 1); next.setHours(0, 0, 1, 0);
      timer = setTimeout(() => { check(); arm(); }, Math.max(1000, next.getTime() - now.getTime()));
    };
    check(); arm();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { live = false; if (timer) clearTimeout(timer); subscription.remove(); };
  }, [auth, offline, source]);
  const cardWidth = Math.min(appleMusic ? 210 : 190, Math.round(width * 0.46));
  return <View style={[styles.section, appleMusic && { marginBottom: 30 }]}>
    <View style={styles.heading}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, appleMusic && { fontSize: 24, lineHeight: 30, fontWeight: '700' }]}>{t('Made for you')}</Text>
        <Text style={styles.subtitle}>{t(snapshot?.day === localRecommendationDay(new Date()) ? 'Saved for today' : 'Your saved recommendations')}</Text>
      </View>
      <GlassPressable buttonMaterial={false} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Refresh recommendations')}
        disabled={loading} onPress={() => { void useDailyRecommendations.getState().refresh(); }}>
        {loading ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name="refresh" size={22} color={colors.accent} />}
      </GlassPressable>
    </View>
    {error ? <Text style={styles.error}>{t('Could not refresh recommendations. Your saved picks are kept.')}</Text> : null}
    <FlatList horizontal data={RECOMMENDATION_KINDS} initialNumToRender={3} maxToRenderPerBatch={3} windowSize={3}
      keyExtractor={(kind) => kind} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}
      renderItem={({ item: kind }) => {
        const songs = snapshot?.lists[kind] ?? [];
        const cover = songs[0] ? songCoverUrl(songs[0], COVER.card) : undefined;
        return <Pressable style={[styles.card, { width: cardWidth }]} accessibilityRole="button"
          accessibilityLabel={`${t(RECOMMENDATION_TITLES[kind])} · ${songsLabel(songs.length, language)}`}
          disabled={!songs.length} onPress={() => router.push(`/recommendations?kind=${kind}`)}>
          <Cover uri={cover} size={cardWidth} placeholderIcon="musical-notes-outline" />
          <Text style={styles.cardTitle} numberOfLines={1}>{t(RECOMMENDATION_TITLES[kind])}</Text>
          <Text style={styles.cardDescription} numberOfLines={2}>{t(songs.length ? RECOMMENDATION_DESCRIPTIONS[kind] : 'Not enough music yet')}</Text>
          <Text style={styles.subtitle}>{songsLabel(songs.length, language)}</Text>
        </Pressable>;
      }} />
  </View>;
}

const styles = themed((palette) => ({
  section: { marginBottom: spacing.xl },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md },
  title: { color: palette.text, fontSize: fontSize.lg, fontWeight: '600' },
  subtitle: { color: palette.textSecondary, fontSize: fontSize.xs, marginTop: 4 },
  cards: { paddingHorizontal: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.md, gap: 4 },
  cardTitle: { color: palette.text, fontSize: fontSize.sm, fontWeight: '600', marginTop: spacing.xs },
  cardDescription: { color: palette.textSecondary, fontSize: fontSize.xs, minHeight: 32 },
  error: { color: palette.textSecondary, marginHorizontal: spacing.lg, marginBottom: spacing.sm, fontSize: fontSize.xs },
}));
