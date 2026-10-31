/** Read-only metadata suggestions; no removal, download or metadata-edit actions. */
/* eslint-disable react-hooks/set-state-in-effect -- Discard the previous source's result before starting explicit asynchronous analysis. */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Song } from '@/api/subsonic';
import { GlassPressable } from '@/components/glass';
import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { TrackRow } from '@/components/TrackRow';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useMusicToolsCatalog } from '@/hooks/useMusicToolsCatalog';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { findDuplicateCandidates, type DuplicateGroup } from '@/lib/smartRules';
import { profileScopeId } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

type CandidateRow = { key: string; group: DuplicateGroup; song?: Song; index: number };
const CandidateList = Animated.createAnimatedComponent(FlatList<CandidateRow>);
function quality(song: Song): string {
  return [song.album, song.suffix?.toUpperCase(), song.bitDepth ? `${song.bitDepth} bit` : '',
    song.samplingRate ? `${(song.samplingRate / 1000).toFixed(1)} kHz` : '',
    song.bitRate ? `${song.bitRate} kbps` : '', song.duration ? formatDuration(song.duration) : ''].filter(Boolean).join(' · ');
}

export default function DuplicateSongsPage() {
  useTheme();
  const t = useT(), catalog = useMusicToolsCatalog(), dockScroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const playing = usePlayerStore(currentSong);
  const generation = useRef(0);
  const [result, setResult] = useState<{ catalog: typeof catalog.catalog; rows: CandidateRow[]; groups: number }>();
  const [analyzing, setAnalyzing] = useState(false);
  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    const current = () => active && generation.current === token && profileScopeId() === catalog.scope;
    if (!catalog.catalog) { setResult(undefined); setAnalyzing(false); return; }
    setAnalyzing(true);
    void (async () => {
      const groups = await findDuplicateCandidates(catalog.catalog!.songs, current);
      const rows: CandidateRow[] = [];
      for (const group of groups) {
        rows.push({ key: `header:${group.id}`, group, index: -1 });
        for (let index = 0; index < group.songs.length; index++) {
          rows.push({ key: `song:${group.id}:${group.songs[index].id}`, group, song: group.songs[index], index });
          if (rows.length % 300 === 0) { if (!current()) return; await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
        }
      }
      if (current()) { setResult({ catalog: catalog.catalog, rows, groups: groups.length }); setAnalyzing(false); }
    })().catch(() => { if (current()) { setResult(undefined); setAnalyzing(false); } });
    return () => { active = false; };
  }, [catalog.catalog, catalog.scope]);
  const data = result?.catalog === catalog.catalog ? result : undefined;

  return <SettingsPage title={t('Duplicates and versions')}>
    <CandidateList data={data?.rows ?? []} keyExtractor={(row) => row.key}
      initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5} onScroll={dockScroll} scrollEventThrottle={16}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottom }}
      ListHeaderComponent={<>
        <Text style={settingsStyles.sectionDescription}>{t('Read-only suggestions based on title, artist and duration. Different releases may be intentional. No files are deleted or changed.')}</Text>
        <GlassPressable buttonMaterial={false} style={styles.button} onPress={catalog.refresh}><Text style={styles.action}>{t('Scan again')}</Text></GlassPressable>
        {catalog.loading || analyzing ? <View style={styles.progress}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{t('Reading library: {n} songs', { n: catalog.count })}</Text></View> : null}
        {catalog.error ? <Text style={styles.error}>{t('Could not read the music catalogue. Try refreshing.')}</Text> : null}
        {catalog.catalog?.offline ? <Text style={styles.muted}>{t('Offline analysis checks only the music available in this profile.')}</Text> : null}
        {data ? <Text style={settingsStyles.sectionTitle}>{t('Candidate groups: {n}', { n: data.groups })}</Text> : null}
      </>}
      ListEmptyComponent={!catalog.loading && !analyzing && !catalog.error ? <Text style={styles.empty}>{t('No duplicate candidates found')}</Text> : null}
      renderItem={({ item }) => item.song ? <View>
        <TrackRow song={item.song} showMenu={false} showFavorite={false} swipeable={false} isCurrent={playing?.id === item.song.id}
          onPress={() => { void usePlayerStore.getState().playQueue(item.group.songs, item.index, 'duplicates', '/settings/duplicates'); }} />
        <Text style={styles.quality}>{quality(item.song)}</Text>
      </View> : <View style={styles.group}>
        <Text style={styles.groupTitle}>{item.group.title}</Text>
        <Text style={styles.muted}>{item.group.artist} · {t(item.group.versions ? 'Possible alternate versions' : 'Similar copies')}</Text>
      </View>} />
  </SettingsPage>;
}

const styles = themed((theme) => ({
  button: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: theme.surface, borderRadius: radius.pill, marginBottom: spacing.md },
  action: { color: theme.accent, fontWeight: '600' },
  muted: { color: theme.textSecondary, fontSize: fontSize.xs }, error: { color: theme.danger },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  empty: { color: theme.textSecondary, paddingVertical: spacing.lg },
  group: { paddingTop: spacing.lg, paddingBottom: spacing.sm },
  groupTitle: { color: theme.text, fontSize: fontSize.md, fontWeight: '600' },
  quality: { color: theme.textMuted, fontSize: fontSize.xs, marginLeft: 68, marginBottom: spacing.sm },
}));
