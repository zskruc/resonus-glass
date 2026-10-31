/** On-device daily/monthly/yearly listening reports, starting with real recorded samples. */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { getSong } from '@/api/data';
import { GlassPressable } from '@/components/glass';
import { SelectList, SettingRow, SettingsGroup, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { TrackRow } from '@/components/TrackRow';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { listeningPreferences, listeningSummary, type ListeningSummary } from '@/lib/listeningDb';
import { listeningBars, listeningRange, type ListeningPeriod } from '@/lib/listeningMath';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useListeningStats } from '@/store/listeningStats';
import { currentSong, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

const StatsList = Animated.createAnimatedComponent(FlatList<ListeningSummary['top'][number]>);

export default function ListeningStatsPage() {
  useTheme();
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offline);
  const profile = profileScopeId();
  const t = useT(), dockScroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const toast = useToast((state) => state.show);
  const language = useSettings((state) => state.language);
  const prefs = useListeningStats();
  const [period, setPeriod] = useState<ListeningPeriod>('week');
  const [year, setYear] = useState(new Date().getFullYear());
  const [refresh, setRefresh] = useState(0);
  const [switching, setSwitching] = useState(false);
  const playing = usePlayerStore(currentSong);
  useEffect(() => { void useListeningStats.getState().load(); }, [profile]);
  const range = listeningRange(period, year);
  const query = useQuery({
    queryKey: ['listening-stats', profile, period, year, refresh],
    queryFn: async () => {
      const summary = await listeningSummary(profile, range.from, range.until);
      const preferences = await listeningPreferences(profile);
      return { summary, preferences, profile };
    },
  });
  const result = query.data?.profile === profile ? query.data : undefined;
  const data = result?.summary;
  const first = result?.preferences.startedAt;
  const currentYear = new Date().getFullYear();
  const startYear = first ? new Date(first).getFullYear() : currentYear;
  const years = Array.from({ length: Math.max(1, currentYear - startYear + 1) }, (_, index) => ({ value: currentYear - index, label: String(currentYear - index) }));
  const bars = listeningBars(data?.days ?? [], period, year);
  const peak = Math.max(1, ...bars.map((bar) => bar.seconds));
  const duration = (seconds: number) => seconds < 60 ? t('{n} seconds', { n: Math.round(seconds) })
    : seconds < 3600 ? t('{n} minutes', { n: Math.round(seconds / 60) }) : t('{n} hours', { n: (seconds / 3600).toFixed(1) });

  async function toggle(enabled: boolean) {
    if (switching) return;
    setSwitching(true);
    try { await useListeningStats.getState().setEnabled(enabled); }
    catch { toast(t('Listening statistics are unavailable')); }
    finally { setSwitching(false); }
  }

  async function play(id: string) {
    const owner = profileScopeId();
    try {
      const song = await getSong(id);
      if (!song) throw new Error('Song not found');
      if (profileScopeId() === owner) await usePlayerStore.getState().playQueue([song], 0, 'listening-stats', '/settings/listening-stats');
    } catch { if (profileScopeId() === owner) toast(t("Couldn't play")); }
  }

  return <SettingsPage title={t('Listening statistics')}>
    <StatsList data={data?.top ?? []} keyExtractor={(item) => item.song.id}
      initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5}
      onScroll={dockScroll} scrollEventThrottle={16}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottom }}
      ListHeaderComponent={<>
        <SettingsGroup><SwitchList options={[{ label: t('Record listening on this device'),
          description: t('Only actual advancing playback is counted. Seeking and buffering are excluded.'),
          value: prefs.profile === profile && prefs.hydrated && prefs.enabled,
          onChange: (value) => { void toggle(value); } }]} /></SettingsGroup>
        <Text style={settingsStyles.sectionDescription}>{first
          ? t('Recording since {date}. Older listening time is not reconstructed.', { date: new Date(first).toLocaleDateString(language) })
          : t('Reports start when music plays in this version. No past listening time is invented.')}</Text>
        <SelectList<ListeningPeriod> label={t('Report period')} value={period} onChange={setPeriod} options={[
          { value: 'week', label: t('Last 7 days') }, { value: 'month', label: t('Last 30 days') }, { value: 'year', label: t('Yearly review') },
        ]} />
        {period === 'year' ? <SelectList label={t('Year')} value={year} onChange={setYear} options={years} /> : null}
        <View style={styles.metrics}>
          <View style={styles.metric}><Text style={styles.big}>{duration(data?.seconds ?? 0)}</Text><Text style={styles.muted}>{t('Listening time')}</Text></View>
          <View style={styles.metric}><Text style={styles.big}>{data?.songs ?? 0}</Text><Text style={styles.muted}>{t('Different songs')}</Text></View>
          <View style={styles.metric}><Text style={styles.big}>{data?.plays ?? 0}</Text><Text style={styles.muted}>{t('Qualified listening sessions')}</Text></View>
        </View>
        <Text style={styles.note}>{t('A session counts after 30 seconds, or half of a shorter song.')}</Text>
        <Text style={styles.note}>{t('Seeking does not add a session. Continuous repeats of the same song count as one session.')}</Text>
        <View style={styles.chart} accessibilityLabel={t('Listening time chart')}>
          {bars.map((bar) => <View key={bar.key} style={styles.chartColumn}>
            <View style={[styles.bar, { height: 2 + 86 * bar.seconds / peak }]} />
            {(period === 'year' || period === 'week') ? <Text style={styles.barLabel}>{bar.label}</Text> : null}
          </View>)}
        </View>
        {data?.artists.length ? <>
          <Text style={settingsStyles.sectionTitle}>{t('Most listened artists')}</Text>
          {data.artists.slice(0, 5).map((artist) => <View key={artist.name} style={styles.artist}>
            <Text style={styles.artistName} numberOfLines={1}>{artist.name || t('Unknown artist')}</Text><Text style={styles.muted}>{duration(artist.seconds)}</Text>
          </View>)}
        </> : null}
        <SettingRow icon="stats-chart-outline" label={t('All-time most played')} description={t('Uses the existing server or local play counter.')} chevron onPress={() => router.push('/browse/songs?sort=frequent')} />
        <GlassPressable buttonMaterial={false} style={styles.refresh} onPress={() => {
          setRefresh((value) => value + 1);
          if (useListeningStats.getState().error) void useListeningStats.getState().load(true);
        }}>
          <Text style={styles.action}>{t('Refresh report')}</Text>
        </GlassPressable>
        {query.isFetching ? <ActivityIndicator color={colors.accent} style={{ padding: spacing.md }} /> : null}
        {(query.error || prefs.error) ? <Text style={styles.error}>{t('Listening statistics are unavailable')}</Text> : null}
        <Text style={settingsStyles.sectionTitle}>{t('Most listened songs')}</Text>
      </>}
      ListEmptyComponent={!query.isFetching ? <Text style={styles.empty}>{t('No listening recorded in this period')}</Text> : null}
      renderItem={({ item }) => <View>
        <TrackRow song={item.song} isCurrent={playing?.id === item.song.id} onPress={() => { void play(item.song.id); }} />
        <Text style={styles.songTime}>{duration(item.seconds)}</Text>
      </View>} />
  </SettingsPage>;
}

const styles = themed((theme) => ({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.lg },
  metric: { flexGrow: 1, flexBasis: 95, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md },
  big: { color: theme.text, fontSize: fontSize.lg, fontWeight: '600' },
  muted: { color: theme.textSecondary, fontSize: fontSize.xs },
  note: { color: theme.textMuted, fontSize: fontSize.xs, marginTop: spacing.sm },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 125, gap: 3, marginTop: spacing.md },
  chartColumn: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '80%', minWidth: 2, borderRadius: 3, backgroundColor: theme.accent },
  barLabel: { color: theme.textMuted, fontSize: 9, marginTop: 4 },
  artist: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', minHeight: 44 },
  artistName: { color: theme.text, fontSize: fontSize.sm, flex: 1 },
  refresh: { alignItems: 'center', padding: spacing.md, minHeight: 44 },
  action: { color: theme.accent, fontWeight: '600' },
  error: { color: theme.danger, paddingVertical: spacing.sm },
  empty: { color: theme.textSecondary, paddingVertical: spacing.lg },
  songTime: { color: theme.textMuted, fontSize: fontSize.xs, marginLeft: 68, marginBottom: spacing.sm },
}));
