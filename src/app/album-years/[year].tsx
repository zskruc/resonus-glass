import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AlbumCard } from '@/components/AlbumCard';
import { AlbumRow } from '@/components/AlbumRow';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame } from '@/components/BrowseFrame';
import { EmptyState } from '@/components/EmptyState';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { useAlbumEras } from '@/hooks/useAlbumEras';
import { useGridColumns } from '@/hooks/useGridColumns';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { albumsInEra, parseAlbumEra } from '@/lib/albumEras';
import { listPerf } from '@/lib/listPerf';
import { useSettings } from '@/store/settings';
import { spacing, themed, useTheme } from '@/theme';

export default function AlbumYearScreen() {
  const colors = useTheme(), t = useT(), params = useLocalSearchParams<{ year?: string; downloaded?: string }>();
  const selection = parseAlbumEra(params.year), data = useAlbumEras(params.downloaded === '1');
  const [pickedYear, setPickedYear] = useState<number>();
  const selected = pickedYear !== undefined && selection?.kind === 'decade' ? { kind: 'year' as const, year: pickedYear } : selection;
  const albums = selected ? albumsInEra(data.index, selected) : [];
  const dock = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding(), { width } = useScreenSize();
  const layout = useSettings((state) => state.browseAlbumsLayout), setLayout = useSettings((state) => state.setBrowseAlbumsLayout);
  const { columns, openGridMenu, gridSheet } = useGridColumns('browseAlbums', { value: layout, set: setLayout });
  const padding = useListPadding(spacing.lg), grid = layout === 'grid', gap = spacing.sm;
  const cardWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const title = selection?.kind === 'unknown' ? t('Unknown year') : selection?.kind === 'decade' ? t('{year}s', { year: selection.year }) : String(selection?.year ?? '');
  const years = selection?.kind === 'decade' ? [...data.index.byYear.keys()].filter((year) => year >= selection.year && year < selection.year + 10).sort((a, b) => b - a) : [];
  if (!selection) return <BrowseFrame><BackChevron /><EmptyState icon="albums-outline" title={t('Invalid release year')} /></BrowseFrame>;
  return <BrowseFrame>
    <View style={[styles.header, { paddingHorizontal: padding }]}><BackChevron />
      <View style={{ flex: 1 }}><Text style={styles.title}>{title}</Text><Text style={styles.note}>{t('{n} albums', { n: albums.length })}</Text></View>
      <GlassPressable variant="subtle" accessibilityLabel={t('View')} onPress={openGridMenu}><Icon name={grid ? 'grid-outline' : 'list'} size={22} color={colors.textSecondary} /></GlassPressable>
    </View>
    {years.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: padding, gap: 8, paddingBottom: 14 }}>
      <GlassPressable variant={pickedYear === undefined ? 'prominent' : 'regular'} style={styles.chip} onPress={() => setPickedYear(undefined)}><Text style={{ color: colors.text }}>{t('All')}</Text></GlassPressable>
      {years.map((year) => <GlassPressable key={year} variant={pickedYear === year ? 'prominent' : 'regular'} style={styles.chip} onPress={() => setPickedYear(year)}>
        <Text style={{ color: colors.text }}>{year} · {data.index.byYear.get(year)?.length ?? 0}</Text>
      </GlassPressable>)}
    </ScrollView> : null}
    {!data.complete ? <View style={{ paddingHorizontal: padding, paddingBottom: 10, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      {!data.isError && !data.issue ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      <Text style={[styles.note, { flex: 1 }]}>{data.isError || data.issue ? t('The release-year index is incomplete. Retry to finish counting.') : t('Reading release years. Counts update as pages arrive.')}</Text>
      {data.isError || data.issue ? <Pressable onPress={() => { void data.restart(); }}><Text style={{ color: colors.accent }}>{t('Retry')}</Text></Pressable> : null}
    </View> : null}
    <Animated.FlatList {...listPerf} onScroll={dock} scrollEventThrottle={16} key={`${layout}-${columns}`} data={albums}
      keyExtractor={(album) => album.id} numColumns={grid ? columns : 1}
      columnWrapperStyle={grid ? { gap } : undefined}
      contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: bottom, gap: 12 }}
      ListEmptyComponent={data.complete ? <EmptyState icon="albums-outline" title={t('No albums in this year')} /> : null}
      renderItem={({ item }) => grid ? <AlbumCard album={item} width={cardWidth} /> : <AlbumRow album={item} />} />
    {gridSheet}
  </BrowseFrame>;
}
const styles = themed((colors) => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  title: { color: colors.text, fontSize: 27, fontWeight: '700' }, note: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  chip: { minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 18 },
}));
