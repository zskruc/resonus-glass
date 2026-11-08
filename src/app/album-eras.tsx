import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useMemo } from 'react';
import { COVER, coverArtUrl } from '@/api/data';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame } from '@/components/BrowseFrame';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { GlassPressable, GlassSurface } from '@/components/glass';
import Icon from '@/components/Icon';
import { useAlbumEras } from '@/hooks/useAlbumEras';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { spacing, themed, useTheme } from '@/theme';

export default function AlbumErasScreen() {
  const colors = useTheme(), t = useT();
  const params = useLocalSearchParams<{ downloaded?: string }>(), downloaded = params.downloaded === '1';
  const data = useAlbumEras(downloaded), dock = useLiquidDockScrollHandler();
  const bottom = useScreenBottomPadding(), padding = useListPadding(spacing.lg);
  const decades = useMemo(() => [...data.index.byDecade.entries()].sort((a, b) => b[0] - a[0])
    .map(([year, albums]) => ({ key: `${year}s`, year, albums })), [data.index]);
  const rows = [...decades, ...(data.index.unknown.length ? [{ key: 'unknown', year: undefined, albums: data.index.unknown }] : [])];
  const largest = Math.max(1, ...rows.map((row) => row.albums.length));
  return <BrowseFrame>
    <View style={[styles.header, { paddingHorizontal: padding }]}>
      <BackChevron /><Text style={styles.heading}>{t('Albums by era')}</Text>
      <GlassPressable variant="subtle" accessibilityLabel={t('Refresh')} onPress={() => { void data.restart(); }}>
        <Icon name="refresh" size={22} color={colors.textSecondary} />
      </GlassPressable>
    </View>
    <Animated.FlatList {...listPerf} onScroll={dock} scrollEventThrottle={16} data={rows} keyExtractor={(row) => row.key}
      contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: bottom, gap: 14 }}
      ListHeaderComponent={<View style={styles.summary}>
        <Text style={styles.note}>{downloaded ? t('Downloaded albums') : t('Your album library')}</Text>
        <Text style={styles.total}>{t('{n} albums indexed', { n: data.index.count })}</Text>
        {!data.complete && !data.isError && !data.issue ? <View style={styles.inline}><ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.note}>{t('Reading release years. Counts update as pages arrive.')}</Text></View> : null}
        {data.isError || data.issue ? <View style={{ gap: 8 }}>
          <Text style={styles.note}>{t('The release-year index is incomplete. Retry to finish counting.')}</Text>
          <GlassPressable variant="regular" onPress={() => { void data.restart(); }}><Text style={{ color: colors.accent }}>{t('Retry')}</Text></GlassPressable>
        </View> : null}
      </View>}
      ListEmptyComponent={data.complete ? <EmptyState icon="albums-outline" title={t('No albums yet')} /> : null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: `/album-years/${item.key}`, params: downloaded ? { downloaded: '1' } : undefined })}>
        <GlassSurface radius={22} style={styles.card}>
          <View style={styles.cardHeading}><Text style={styles.decade}>{item.year === undefined ? t('Unknown year') : t('{year}s', { year: item.year })}</Text>
            <Text style={styles.note}>{t('{n} albums', { n: item.albums.length })}</Text><Icon name="chevron-forward" size={20} color={colors.textMuted} /></View>
          <View style={styles.barTrack}><View style={[styles.bar, { width: `${item.albums.length / largest * 100}%`, backgroundColor: colors.accent }]} /></View>
          <View style={styles.covers}>{item.albums.slice(0, 4).map((album) => <Cover key={album.id} uri={coverArtUrl(album.coverArt ?? album.id, COVER.thumb)} size={52} />)}
            <View style={{ flex: 1 }} />
            {item.year !== undefined ? <Text style={styles.note}>{item.year}–{item.year + 9}</Text> : null}
          </View>
        </GlassSurface>
      </Pressable>} />
  </BrowseFrame>;
}
const styles = themed((colors) => ({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, gap: 10 },
  heading: { flex: 1, color: colors.text, fontSize: 23, fontWeight: '700' },
  summary: { gap: 9, paddingVertical: 12 }, total: { color: colors.text, fontSize: 29, fontWeight: '700' },
  note: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 }, inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 12 }, cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  decade: { flex: 1, color: colors.text, fontSize: 24, fontWeight: '700' },
  barTrack: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceHighlight }, bar: { height: 5, borderRadius: 3 },
  covers: { flexDirection: 'row', alignItems: 'center', gap: 8 },
}));
