/**
 * A temporary drag surface over the still-mounted detail/recycled list. Every
 * accepted drop saves itself; closing leaves the mode, it does not undo writes.
 */
import Icon from '@/components/Icon';
import { GlassPressable } from '@/components/glass';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListDragStartEvent,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COVER, songCoverUrl } from '@/api/data';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { applyPlaylistDrag, type PlaylistOrderRow } from '@/lib/playlistReorder';
import { haptic } from '@/lib/haptics';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING, themed, useTheme } from '@/theme';
import { Cover } from './Cover';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';

// ReorderableList needs the cells mounted to animate the drag.
const perf = {
  initialNumToRender: listPerf.initialNumToRender,
  maxToRenderPerBatch: listPerf.maxToRenderPerBatch,
  windowSize: listPerf.windowSize,
};

function ReorderRow({ row, valid }: { row: PlaylistOrderRow; valid: () => boolean }) {
  const song = row.song;
  const drag = useReorderableDrag();
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const t = useT();
  const begin = () => { if (valid()) { haptic('medium'); drag(); } };
  return (
    <Pressable style={styles.row} onLongPress={begin} delayLongPress={150}>
      {showListArtwork ? (
        <Cover uri={songCoverUrl(song, COVER.thumb)} size={44} />
      ) : null}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {song.title}
        </Text>
        {song.artist ? (
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist}
          </Text>
        ) : null}
      </View>
      <Pressable hitSlop={8} onPressIn={begin} accessibilityRole="button" accessibilityLabel={t('Reorder')}>
        <Icon name="reorder-two" size={24} color={colors.textSecondary} />
      </Pressable>
    </Pressable>
  );
}

export function PlaylistReorder({
  rows,
  title,
  busy,
  loading = false,
  valid,
  onClose,
  onOrder,
}: {
  rows: readonly PlaylistOrderRow[];
  title: string;
  busy: boolean;
  loading?: boolean;
  valid: () => boolean;
  onClose: () => void;
  onOrder: (rows: readonly PlaylistOrderRow[]) => boolean;
}) {
  const t = useT();
  const dockScroll = useLiquidDockScrollHandler();
  const bottomPad = useScreenBottomPadding();
  const [list, setList] = useState(() => rows.slice());
  const live = useRef<{ rows: PlaylistOrderRow[]; valid: () => boolean; onOrder: typeof onOrder; onClose: typeof onClose } | null>(null);
  const dragged = useRef<{ rows: PlaylistOrderRow[]; from: number } | null>(null);
  useLayoutEffect(() => {
    live.current = { rows: list, valid, onOrder, onClose };
    return () => { live.current = null; };
  }, [list, valid, onOrder, onClose]);
  const active = () => !!live.current && live.current.valid();
  const close = useCallback(() => {
    const current = live.current;
    live.current = null;
    dragged.current = null;
    current?.onClose();
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => { sub.remove(); dragged.current = null; };
  }, [close]);
  function started(index: number) {
    const current = live.current;
    if (current?.valid() && current.rows[index]) dragged.current = { rows: current.rows, from: index };
  }
  // Repaints on a change of appearance or accent.
  useTheme();

  return (
    <SafeAreaView style={[styles.safe, StyleSheet.absoluteFill]} edges={['top']} accessibilityViewIsModal testID="playlist-reorder-mode">
      <View style={styles.header}>
        <GlassPressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Close')} onPress={close}>
          <Icon name="chevron-back" size={26} color={colors.text} />
        </GlassPressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.hint}>{t('Changes are saved automatically')}</Text>
        </View>
        {busy ? <ActivityIndicator color={colors.accent} accessibilityLabel={t(loading ? 'Loading…' : 'Saving…')} /> : <View style={{ width: 26 }} />}
      </View>

      <ReorderableList
        {...perf}
        onScroll={dockScroll}
        data={list}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <ReorderRow row={item} valid={active} />}
        onDragStart={(event: ReorderableListDragStartEvent) => {
          'worklet';
          scheduleOnRN(started, event.index);
        }}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const current = live.current, hand = dragged.current;
          dragged.current = null;
          // The library answers after its 200ms release animation. A late,
          // duplicated or now-unowned answer must not write a different list.
          if (!current?.valid() || !hand || hand.rows !== current.rows || hand.from !== from) return;
          const next = applyPlaylistDrag(hand.rows, from, to);
          if (next !== hand.rows && current.onOrder(next)) {
            live.current = { ...current, rows: next };
            setList(next);
          }
        }}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
      />
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background, zIndex: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerCopy: { flex: 1, alignItems: 'center', gap: 3 },
  headerTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', textAlign: 'center' },
  hint: { color: colors.textSecondary, fontSize: fontSize.xs, textAlign: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  info: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.md },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
}));
