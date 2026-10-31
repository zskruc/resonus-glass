/**
 * Volta-inspired classified library and artwork shelves (GPL-3.0 reference).
 * The browsing routes and media data are Resonus's own; switching appearance
 * neither copies the library nor changes any of its saved presentation choices.
 */
import Icon from '@/components/Icon';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { getAlbumList, type Album } from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { Message } from '@/components/Message';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { columnsFor, useListPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors, spacing, themed, useTheme } from '@/theme';

interface Category {
  label: string;
  icon: keyof typeof Icon.glyphMap;
  href?: string;
  onPress?: () => void;
}

function CategoryRow({ item }: { item: Category }) {
  const t = useT();
  const body = (
    <Pressable style={styles.category} onPress={item.onPress} accessibilityRole="button">
      <Icon name={item.icon} size={26} color={colors.accent} />
      <View style={styles.categoryContent}>
        <Text style={styles.categoryText}>{t(item.label)}</Text>
        <Icon name="chevron-forward" size={20} color={colors.textMuted} />
      </View>
    </Pressable>
  );
  return item.href ? <Link href={item.href} asChild>{body}</Link> : body;
}

export function VoltaLibraryOverview({
  onPlaylists,
  onFavorites,
}: {
  onPlaylists: () => void;
  onFavorites: () => void;
}) {
  useTheme();
  const t = useT();
  const dockScroll = useLiquidDockScrollHandler();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const listPad = useListPadding(spacing.lg);
  const columns = columnsFor(width, 210, 2, 4);
  const cardWidth = (width - listPad * 2 - 16 * (columns - 1)) / columns;
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const showFolders = useSettings((s) => s.showFolderBrowser
    && s.exploreSections.some((section) => section.key === 'folders' && section.enabled));
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    // Shared with Home; this appearance does not start another full-library scan.
    queryKey: ['albumList', 'newest'],
    queryFn: () => getAlbumList('newest'),
    enabled: !!auth || offline,
  });
  const categories: Category[] = [
    { label: 'Playlists', icon: 'list-outline', onPress: onPlaylists },
    { label: 'Artists', icon: 'person-outline', href: '/browse/artists' },
    { label: 'Albums', icon: 'albums-outline', href: '/browse/albums' },
    { label: 'Songs', icon: 'musical-notes-outline', href: '/browse/songs' },
    { label: 'Favorites', icon: 'star-outline', onPress: onFavorites },
    ...(auth ? [{ label: 'Downloads & offline', icon: 'download-outline' as const, href: '/settings/downloads' }] : []),
    ...(auth && !offline && auth.serverType !== 'jellyfin' && showFolders
      ? [{ label: 'Folders', icon: 'folder-outline' as const, href: '/explore?section=folders' }]
      : []),
    { label: 'History', icon: 'time-outline', href: '/history' },
  ];

  return (
    <Animated.FlatList
      key={`apple-library-${columns}`}
      {...listPerf}
      onScroll={dockScroll}
      scrollEventThrottle={16}
      data={data ?? []}
      keyExtractor={(item: Album) => item.id}
      numColumns={columns}
      columnWrapperStyle={styles.albumColumns}
      contentContainerStyle={{ paddingHorizontal: listPad, paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />}
      ListHeaderComponent={
        <>
          <View style={styles.categories}>
            {categories.map((item) => <CategoryRow key={item.label} item={item} />)}
          </View>
          <Link href="/browse/albums?sort=newest" asChild>
            <Pressable style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>{t('Recently added')}</Text>
              <Icon name="chevron-forward" size={20} color={colors.textMuted} />
            </Pressable>
          </Link>
        </>
      }
      ListEmptyComponent={isLoading ? <ActivityIndicator style={styles.empty} color={colors.accent} /> : isError ? (
        <Message text={t("Couldn't load albums.")} onRetry={() => refetch()} />
      ) : null}
      renderItem={({ item }: { item: Album }) => <View style={styles.albumCell}><AlbumCard album={item} width={cardWidth} /></View>}
    />
  );
}

const styles = themed((colors) => ({
  categories: { marginBottom: 28 },
  category: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 16 },
  categoryContent: { flex: 1, minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  categoryText: { flexShrink: 1, color: colors.text, fontSize: 20, lineHeight: 26 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 16 },
  sectionTitle: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4, flexShrink: 1 },
  albumColumns: { gap: 16 },
  albumCell: { marginBottom: 22 },
  empty: { paddingVertical: 28 },
}));
