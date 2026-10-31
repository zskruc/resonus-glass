/** Manual audio downloads, backed by the same queue as album/song actions. */
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';

import { SettingRow, SettingsGroup, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { useDownloads, type DownloadQueueItem } from '@/store/downloads';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

const AnimatedList = Animated.createAnimatedComponent(FlashList<DownloadQueueItem>);
const NO_SCROLL_ANCHOR = { disabled: true };
const keyExtractor = (item: DownloadQueueItem) => item.key;

function itemFraction(item: DownloadQueueItem): number {
  if (item.status === 'completed') return 1;
  if (item.status === 'failed' || item.status === 'cancelled' || item.bytesTotal <= 0) return 0;
  return Math.max(0, Math.min(1, item.bytesWritten / item.bytesTotal));
}

/** One pass over the in-memory queue, never a file-system scan. Unknown file
 * lengths contribute no invented percentage; successful completion is exact. */
function summaryOf(queue: DownloadQueueItem[]) {
  const summary = { total: queue.length, completed: 0, active: 0, waiting: 0, paused: 0,
    failed: 0, cancelled: 0, bytesWritten: 0, fraction: 0 };
  for (const item of queue) {
    if (item.status === 'completed') summary.completed++;
    else if (item.status === 'downloading') summary.active++;
    else if (item.status === 'queued') summary.waiting++;
    else if (item.status === 'paused') summary.paused++;
    else if (item.status === 'failed') summary.failed++;
    else if (item.status === 'cancelled') summary.cancelled++;
    summary.bytesWritten += Math.max(0, item.bytesWritten);
    summary.fraction += itemFraction(item);
  }
  summary.fraction = summary.total ? summary.fraction / summary.total : 0;
  return summary;
}

const DownloadRow = memo(function DownloadRow({ item }: { item: DownloadQueueItem }) {
  useTheme();
  const t = useT();
  const percent = Math.floor(itemFraction(item) * 100);
  const status = item.status === 'completed' ? t('Downloaded')
    : item.status === 'downloading' ? t('Downloading…')
    : item.status === 'paused' ? t('Paused')
    : item.status === 'failed' ? t('Failed')
    : item.status === 'cancelled' ? t('Cancelled') : t('Waiting');
  const size = item.bytesTotal > 0
    ? t('{written} of {total}', { written: formatBytes(item.bytesWritten), total: formatBytes(item.bytesTotal) })
    : t('{bytes} received', { bytes: formatBytes(item.bytesWritten) });
  const progressText = item.status === 'completed' ? '100%'
    : item.bytesTotal > 0 && item.status !== 'cancelled' && item.status !== 'failed' ? `${percent}%` : undefined;

  return <View style={styles.row}>
    <View style={styles.rowHeading}>
      <View style={styles.songInfo}>
        <Text style={styles.songTitle} numberOfLines={2}>{item.song.title || t('Unknown title')}</Text>
        {item.song.artist ? <Text style={styles.secondary} numberOfLines={1}>{item.song.artist}</Text> : null}
      </View>
      <Text style={[styles.status, item.status === 'failed' && styles.error]}>{status}</Text>
    </View>
    <View style={styles.progressLine}>
      <Text style={styles.secondary}>{size}</Text>
      {progressText ? <Text style={styles.secondary}>{progressText}</Text> : null}
    </View>
    <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={item.song.title}
      accessibilityValue={progressText ? { min: 0, max: 100, now: percent, text: `${status} · ${size} · ${progressText}` }
        : { text: `${status} · ${size}` }}>
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
    {item.status === 'failed' ? <Text style={styles.failureHint}>
      {t('Tap Start all to retry this song.')}
    </Text> : null}
  </View>;
});

export default function DownloadManager() {
  useTheme();
  const t = useT();
  const lang = useSettings((state) => state.language);
  const owner = useAuthStore((state) => state.auth);
  const offline = useAuthStore((state) => state.offline);
  const task = useDownloads(useShallow((state) => ({ queue: state.queue, queuePaused: state.queuePaused,
    pauseAll: state.pauseAll, resumeAll: state.resumeAll, cancelAll: state.cancelAll })));
  const scrollHandler = useLiquidDockScrollHandler();
  const bottomPadding = useScreenBottomPadding();
  const summary = useMemo(() => summaryOf(task.queue), [task.queue]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const actionPending = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  function run(action: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true; setBusy(true); setActionError(false);
    void action().catch(() => { if (alive.current) setActionError(true); }).finally(() => {
      actionPending.current = false;
      if (alive.current) setBusy(false);
    });
  }
  const renderItem = useCallback(({ item }: { item: DownloadQueueItem }) => <DownloadRow item={item} />, []);
  const remaining = summary.active + summary.waiting + summary.paused;
  const canResume = !!owner && !offline && (remaining > 0 || summary.failed > 0)
    && (task.queuePaused || summary.paused > 0 || summary.failed > 0 || summary.active === 0);
  const canPause = remaining > 0 && !task.queuePaused && (summary.active > 0 || summary.waiting > 0);
  const percent = Math.floor(summary.fraction * 100);
  const count = (value: number) => value.toLocaleString(lang);
  const completedText = t('{done} of {total} songs downloaded', { done: count(summary.completed), total: count(summary.total) });

  return <SettingsPage title={t('Download manager')}>
    <AnimatedList
      data={task.queue}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      maxItemsInRecyclePool={32}
      maintainVisibleContentPosition={NO_SCROLL_ANCHOR}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      contentContainerStyle={[settingsStyles.content, { paddingBottom: bottomPadding }]}
      ListHeaderComponent={<View>
        <Text style={[settingsStyles.sectionDescription, { marginTop: 0 }]}>
          {t('Downloads added from songs, albums, playlists and artists appear here. These are audio files kept for offline playback.')}
        </Text>
        <Text style={settingsStyles.sectionTitle}>{t('Overall progress')}</Text>
        <SettingsGroup>
          <View style={styles.summaryCard}>
            <View style={styles.rowHeading}>
              <Text style={styles.heading}>{completedText}</Text>
              <Text style={styles.status}>{percent}%</Text>
            </View>
            <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={t('Overall progress')}
              accessibilityValue={{ min: 0, max: 100, now: percent, text: completedText }}>
              <View style={[styles.fill, { width: `${percent}%` }]} />
            </View>
            <Text style={styles.secondary}>{t('{bytes} received', { bytes: formatBytes(summary.bytesWritten) })}</Text>
            <View style={styles.metrics}>
              {[
                [t('Downloading'), summary.active], [t('Waiting'), summary.waiting],
                [t('Paused'), summary.paused], [t('Failed'), summary.failed], [t('Cancelled'), summary.cancelled],
              ].map(([label, value]) => <Text key={label} style={styles.secondary}>{label} · {count(value as number)}</Text>)}
            </View>
          </View>
          <SettingRow label={t('Start all')} icon="play-outline"
            description={offline && (remaining > 0 || summary.failed > 0) ? t('Return online to start or continue this task.')
              : summary.failed > 0 ? t('Resumes waiting downloads and retries failed songs. Cancelled tasks stay cancelled.') : undefined}
            onPress={canResume && !busy ? () => run(task.resumeAll) : undefined} />
          <SettingRow label={t('Pause all')} icon="pause-outline"
            onPress={canPause && !busy ? () => run(task.pauseAll) : undefined} />
          <SettingRow label={t('Cancel all')} icon="close-circle-outline" destructive
            description={t('Stops unfinished downloads. Downloaded songs are kept.')}
            onPress={remaining > 0 && !busy ? () => run(task.cancelAll) : undefined} />
        </SettingsGroup>
        {busy ? <View style={styles.working}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.secondary}>{t('Updating download queue…')}</Text>
        </View> : null}
        {actionError ? <Text accessibilityRole="alert" style={styles.error}>
          {t("Couldn't complete the action. Check your connection and try again.")}
        </Text> : null}
        <Text style={settingsStyles.sectionDescription}>
          {t('Downloaded songs stay on your phone after restarting the app. Add unfinished downloads again.')}
        </Text>
        <Text style={settingsStyles.sectionDescription}>
          {t('Overall progress is based on songs. When a file size is unknown, only the received data is shown.')}
        </Text>
        {summary.total > 0 ? <Text style={settingsStyles.sectionTitle}>{t('Songs in queue')}</Text> : null}
      </View>}
      ListEmptyComponent={<View style={styles.empty}>
        <Text style={styles.heading}>{t('No download tasks yet')}</Text>
        <Text style={styles.secondary}>{t('Choose Download from a song, album or playlist menu to add it here.')}</Text>
      </View>}
    />
  </SettingsPage>;
}

const styles = themed((colors) => ({
  summaryCard: { padding: spacing.lg, gap: spacing.sm },
  heading: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  songInfo: { flex: 1, minWidth: 0, gap: 3 },
  songTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  secondary: { color: colors.textSecondary, fontSize: fontSize.xs },
  status: { color: colors.textSecondary, fontSize: fontSize.xs, flexShrink: 0 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs },
  row: { paddingVertical: spacing.md, paddingHorizontal: spacing.xs, gap: spacing.sm,
    borderBottomWidth: 0.5, borderBottomColor: colors.border },
  progressLine: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
  track: { height: 4, backgroundColor: colors.surfaceHighlight, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
  failureHint: { color: colors.danger, fontSize: fontSize.xs },
  error: { color: colors.danger, fontSize: fontSize.sm },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  empty: { paddingVertical: spacing.xl, gap: spacing.sm },
}));
