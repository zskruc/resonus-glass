import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useMemo } from 'react';
import { podcastCover, queueEpisode } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { useFavoritePodcasts, type FavoritePodcastItem } from '@/hooks/useFavoritePodcasts';
import { useLibraryPullRefresh } from '@/hooks/useLibraryPullRefresh';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { matches, sortItems } from '@/lib/librarySort';
import { listPerf } from '@/lib/listPerf';
import { useSettings } from '@/store/settings';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';
import { Cover } from './Cover';
import { EmptyState } from './EmptyState';
import { Message } from './Message';
import { openPodcastEpisodeMenu, openPodcastMenu } from './PodcastMenuSheet';

export function PodcastLibrary({ query = '' }: { query?: string }) {
  useTheme(); const t = useT(), scroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const padding = useListPadding(spacing.lg), sort = useSettings((state) => state.librarySort);
  const favorites = useFavoritePodcasts(), pull = useLibraryPullRefresh(favorites.channels, favorites.episodes);
  const files = usePodcastDownloads((state) => state.files);
  const hidden = useSettings((state) => state.hideUnavailableOffline);
  const offline = isManualOffline();
  const rows = useMemo(() => sortItems(favorites.items.filter((item) => matches(query, item.name, item.by)
    && !(hidden && offline && item.episode && !files[item.id])), sort, (item) => item.name,
  (item) => sort === 'recent' ? item.recent : item.added), [favorites.items, query, sort, hidden, offline, files]);
  const row = (item: FavoritePodcastItem) => <Pressable style={[styles.row, offline && !!item.episode && !files[item.id] && { opacity: 0.4 }]}
    onPress={item.episode ? () => {
      if (offline && !files[item.id]) useToast.getState().show(t('Not available offline'));
      else queueEpisode(item.episode!, item.channel);
    } : undefined}
    onLongPress={() => item.episode ? openPodcastEpisodeMenu(item.channel, item.episode) : openPodcastMenu(item.channel)}>
    <Cover uri={podcastCover(item.channel)} size={56} />
    <View style={styles.info}><Text style={styles.title} numberOfLines={1}>{item.name}</Text>
      <Text style={styles.subtitle} numberOfLines={1}>{item.by ?? t('Podcast')}</Text></View>
  </Pressable>;
  return <Animated.FlatList {...listPerf} data={rows} keyExtractor={(item) => `${item.kind}:${item.id}`}
    contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: bottom, gap: spacing.md }}
    onScroll={scroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl {...pull} tintColor={colors.accent} />}
    renderItem={({ item }) => item.episode ? row(item) : <Link href={item.href} asChild>{row(item)}</Link>}
    ListEmptyComponent={favorites.channels.isLoading || favorites.episodes.isLoading
      ? <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.accent} />
      : favorites.channels.isError && favorites.episodes.isError
        ? <Message text={t("Couldn't load your library.")} onRetry={() => void pull.onRefresh()} />
        : <EmptyState icon="headset-outline" title={t('No favorite podcasts')}
          subtitle={t('Favorite shows or episodes to see them here.')} />} />;
}
const styles = themed((color) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64 },
  info: { flex: 1 }, title: { color: color.text, fontSize: fontSize.md, fontWeight: '500' },
  subtitle: { color: color.textSecondary, fontSize: fontSize.xs, marginTop: 3 },
}));
