/** A filtered search owns one vertical, virtualized scroll surface. */
import { Link } from 'expo-router';
import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { COVER, coverArtUrl } from '@/api/data';
import type { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import type { SearchGridItem } from '@/lib/searchGrid';
import type { RecentItem } from '@/store/recentSearches';
import { appleMusicStyles } from '@/theme/appleMusic';
import { fontSize, spacing, themed, useTheme } from '@/theme';
import { AlbumCard } from './AlbumCard';
import { Cover } from './Cover';

const AnimatedGrid = Animated.createAnimatedComponent(FlatList<SearchGridItem>);
const keyExtractor = (item: SearchGridItem) => item.key;
// FlatList counts multi-column rows, not cards: three rows start at <=9 photos.
const VIRTUAL_WINDOW = { initialNumToRender: 3, maxToRenderPerBatch: 2, windowSize: 5, removeClippedSubviews: true };

interface Props {
  identity: string;
  items: SearchGridItem[];
  columns: number;
  cardWidth: number;
  pagePadding: number;
  bottomPadding: number;
  title: string;
  feedback: ReactElement | null;
  appleMusic: boolean;
  onScroll: ReturnType<typeof useLiquidDockScrollHandler>;
  addRecent: (item: RecentItem) => void;
}

export const SearchResultGrid = memo(function SearchResultGrid({ identity, items, columns, cardWidth,
  pagePadding, bottomPadding, title, feedback, appleMusic, onScroll, addRecent }: Props) {
  useTheme();
  return <AnimatedGrid
    key={`${identity}:${columns}`}
    style={styles.list}
    data={items}
    numColumns={columns}
    keyExtractor={keyExtractor}
    {...VIRTUAL_WINDOW}
    columnWrapperStyle={columns > 1 ? styles.columns : undefined}
    contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: bottomPadding }}
    onScroll={onScroll}
    scrollEventThrottle={16}
    keyboardShouldPersistTaps="handled"
    keyboardDismissMode="on-drag"
    ListHeaderComponent={items.length ? <>
      {feedback}
      <Text style={[styles.title, appleMusic && appleMusicStyles.sectionTitle]}>{title}</Text>
    </> : null}
    ListEmptyComponent={feedback}
    renderItem={({ item }) => <View style={styles.cell}>
      {item.kind === 'album' ? <AlbumCard album={item.album} width={cardWidth} onPress={() => addRecent({
        kind: 'album', id: item.album.id, title: item.album.name, artist: item.album.artist,
        coverArt: item.album.coverArt ?? item.album.id, href: `/album/${item.album.id}`,
      })} /> : <Link href={`/artist/${item.artist.id}`} asChild>
        <Pressable style={StyleSheet.flatten([styles.artist, { width: cardWidth }])}
          onPress={() => addRecent({ kind: 'artist', id: item.artist.id, title: item.artist.name,
            coverArt: item.artist.coverArt ?? item.artist.id, href: `/artist/${item.artist.id}` })}>
          <Cover uri={coverArtUrl(item.artist.coverArt ?? item.artist.id, COVER.card)} size={cardWidth} rounded />
          <Text style={[styles.name, appleMusic && appleMusicStyles.cardTitle]} numberOfLines={appleMusic ? 2 : 1}>
            {item.artist.name}
          </Text>
        </Pressable>
      </Link>}
    </View>}
  />;
});

const styles = themed((colors) => ({
  list: { flex: 1 },
  columns: { gap: spacing.md },
  cell: { paddingBottom: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '500', marginBottom: spacing.md },
  artist: { alignItems: 'center', gap: spacing.xs },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500', textAlign: 'center' },
}));
