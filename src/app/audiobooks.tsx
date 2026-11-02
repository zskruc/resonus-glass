/** A virtualized shelf using the existing album cards, menus and dock scroll. */
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Text, View } from 'react-native';
import { FlatList as GHFlatList } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { GlassPressable, GlassScreen } from '@/components/glass';
import Icon from '@/components/Icon';
import { AlbumCard } from '@/components/AlbumCard';
import { AlbumRow } from '@/components/AlbumRow';
import { BackChevron } from '@/components/BackChevron';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { useGridColumns } from '@/hooks/useGridColumns';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { getAudiobookAlbums } from '@/lib/audiobookLibrary';
import { listPerf } from '@/lib/listPerf';
import { audiobookProfileScope } from '@/store/albumProgress';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';

const AnimatedList = Animated.createAnimatedComponent(GHFlatList);
export default function AudiobooksScreen() {
  useTheme();
  const t = useT(), scroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const { width } = useScreenSize(), padding = useListPadding(spacing.lg);
  const offline = useAuthStore((state) => state.offline), auth = useAuthStore((state) => state.auth);
  useAuthStore((state) => state.offlineSource);
  const scope = audiobookProfileScope(auth, offline);
  const layout = useSettings((state) => state.audiobooksLayout), set = useSettings((state) => state.setAudiobooksLayout);
  const { columns, openGridMenu, gridSheet } = useGridColumns('audiobooks', { value: layout, set });
  const card = Math.max(60, (width - padding * 2 - spacing.sm * (columns - 1)) / columns);
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['audiobooks', scope, offline], queryFn: getAudiobookAlbums, enabled: !!auth || offline,
  });
  const grid = layout === 'grid';
  return <GlassScreen style={styles.root} edges={['top']}>
    <View style={styles.bar}>
      <BackChevron size={28} />
      <Text style={styles.title}>{t('Audiobooks')}</Text>
      <GlassPressable variant="subtle" accessibilityRole="button" accessibilityLabel={t('View')} onPress={openGridMenu} hitSlop={10}>
        <Icon name={grid ? 'grid-outline' : 'list'} size={22} color={colors.textSecondary} />
      </GlassPressable>
    </View>
    {isLoading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      : isError ? <Message text={t("Couldn't load albums.")} onRetry={() => void refetch()} />
        : data.length === 0 ? <View style={styles.center}><EmptyState icon="book-outline" title={t('No audiobooks yet')}
          subtitle={t('Albums tagged as audiobooks, spoken word or audio drama appear here.')} /></View>
          : <AnimatedList {...listPerf} key={`${layout}:${columns}`} data={data} numColumns={grid ? columns : 1}
            keyExtractor={(item: unknown) => (item as { id: string }).id} onScroll={scroll} scrollEventThrottle={16}
            contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: bottom, gap: spacing.md }}
            columnWrapperStyle={grid && columns > 1 ? { gap: spacing.sm } : undefined}
            renderItem={({ item }: { item: unknown }) => grid
              ? <AlbumCard album={item as (typeof data)[number]} width={card} /> : <AlbumRow album={item as (typeof data)[number]} />} />}
    {gridSheet}
  </GlassScreen>;
}
const styles = themed((color) => ({
  root: { flex: 1, backgroundColor: color.background },
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  title: { flex: 1, color: color.text, fontSize: fontSize.lg, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
}));
