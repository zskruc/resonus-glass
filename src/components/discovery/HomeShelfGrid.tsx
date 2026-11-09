/** A horizontally virtualised shelf of columns, each containing one to three cards.
 * Only a small window of columns mounts; the metadata cap also protects callers. */
import { useMemo, type ReactNode } from 'react';
import { FlatList, View } from 'react-native';
import { spacing } from '@/theme';
export function homeShelfColumns<T>(items: readonly T[], rows: number): T[][] {
  const count = Number.isFinite(rows) ? Math.max(1, Math.min(3, Math.round(rows))) : 2;
  const columns: T[][] = [];
  for (let offset = 0; offset < Math.min(50, items.length); offset += count) columns.push(items.slice(offset, Math.min(offset + count, 50)));
  return columns;
}
export function HomeShelfGrid<T>({ items, rows = 2, cardWidth, keyFor, renderCard }: {
  items: readonly T[]; rows?: 1 | 2 | 3; cardWidth: number; keyFor(item: T): string; renderCard(item: T): ReactNode;
}) {
  const columns = useMemo(() => homeShelfColumns(items, rows), [items, rows]);
  const gap = spacing.md, stride = cardWidth + gap;
  return <FlatList horizontal data={columns} key={`grid:${rows}:${Math.round(cardWidth)}`}
    keyExtractor={(column) => `${rows}:${keyFor(column[0])}`}
    initialNumToRender={3} maxToRenderPerBatch={3} windowSize={3} updateCellsBatchingPeriod={32}
    showsHorizontalScrollIndicator={false} removeClippedSubviews={false}
    contentContainerStyle={{ paddingHorizontal: spacing.lg, gap }}
    getItemLayout={(_, index) => ({ length: stride, offset: spacing.lg + stride * index, index })}
    renderItem={({ item: column }) => <View style={{ width: cardWidth, gap: spacing.lg }}>{column.map((item) => <View key={keyFor(item)}>{renderCard(item)}</View>)}</View>} />;
}
