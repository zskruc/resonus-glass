/** Settings › Downloads › Bulk artwork & lyrics. Opening only reads a saved task. */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsGroup, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useBulkMediaCache, type MediaCacheKind } from '@/store/bulkMediaCache';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';

const KINDS: MediaCacheKind[] = ['lyrics', 'albumCovers', 'artistCovers'];

export default function MediaCacheSettings() {
  useTheme();
  const t = useT();
  const owner = useAuthStore((state) => state.auth);
  const offline = useAuthStore((state) => state.offline);
  const lang = useSettings((state) => state.language);
  const task = useBulkMediaCache(useShallow((state) => ({ status: state.status, reason: state.reason,
    phase: state.phase, stats: state.stats, selected: state.selected, error: state.error, hydrated: state.hydrated,
    load: state.load, start: state.start, pause: state.pause, resume: state.resume,
    cancel: state.cancel, retryFailed: state.retryFailed })));
  const [draft, setDraft] = useState<{ owner: typeof owner; kinds: MediaCacheKind[] }>();
  const [actionError, setActionError] = useState<{ owner: typeof owner }>();
  const [actionNotice, setActionNotice] = useState<{ owner: typeof owner; message: string }>();
  const [preparation, setPreparation] = useState<{ owner: typeof owner }>();
  const preparingAction = useRef<typeof preparation>(undefined);
  const load = task.load;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    // No discovery, metadata request or download until an explicit Start tap.
    void load().catch(() => { if (active) setActionError({ owner }); });
    return () => { active = false; };
  }, [load, owner]);

  const selected = draft && draft.owner === owner ? draft.kinds : task.selected;
  const busy = task.status === 'discovering' || task.status === 'running';
  const preparing = preparation?.owner === owner && !busy;
  useEffect(() => {
    // start/resume resolve only when the whole worker finishes. Once the store
    // owns the operation, its Pause/Continue controls must remain available.
    if (busy && preparingAction.current?.owner === owner) {
      preparingAction.current = undefined;
      setPreparation(undefined);
    }
  }, [busy, owner]);
  const failures = KINDS.reduce((sum, kind) => sum + task.stats[kind].failed, 0);
  const label = (kind: MediaCacheKind) => kind === 'lyrics' ? t('Lyrics')
    : kind === 'albumCovers' ? t('Album covers') : t('Artist portraits');
  const count = (value: number) => value.toLocaleString(lang);
  function run(action: () => Promise<void>, needsSelection = false) {
    const current = useAuthStore.getState();
    if (current.auth !== owner) return;
    const unavailable = !owner ? t('Connect to a server to start.')
      : current.offline ? t('Return online to start or continue this task.')
      : !task.hydrated ? t('Loading…')
      : needsSelection && selected.length === 0 ? t('Choose at least one item type.') : undefined;
    if (unavailable) { setActionNotice({ owner, message: unavailable }); return; }
    if (preparingAction.current?.owner === owner) return;
    const intent = { owner };
    preparingAction.current = intent;
    setPreparation(intent); setActionError(undefined); setActionNotice(undefined);
    void (async () => {
      try { await action(); }
      catch {
        if (mounted.current && preparingAction.current === intent && useAuthStore.getState().auth === owner) {
          setActionError({ owner });
        }
      } finally {
        if (preparingAction.current === intent) {
          preparingAction.current = undefined;
          if (mounted.current && useAuthStore.getState().auth === owner) setPreparation(undefined);
        }
      }
    })();
  }
  const statusText = task.status === 'discovering' ? t('Scanning the entire library…')
    : task.status === 'running' ? task.phase ? t('Caching {type}…', { type: label(task.phase) }) : t('Caching…')
    : task.status === 'paused' ? t('Paused')
    : task.status === 'cancelled' ? t('Task cancelled. Cached files have been kept.')
    : task.status === 'completed' ? t('Finished. Missing items and failed requests are listed below.')
    : task.status === 'error' ? t("Couldn't finish this task. Cached files have been kept.")
    : t('Ready to scan');
  const pauseDescription = task.reason === 'offline'
    ? t('Paused while the server is unavailable or offline mode is on. Restore the connection, then continue.')
    : task.reason === 'wifi' ? t('Paused by Wi-Fi only. Connect to Wi-Fi, then continue.')
    : task.reason === 'profile' ? t('Paused after switching accounts. Return to the original account to continue its task.')
    : task.reason === 'background' ? Platform.OS === 'android'
      ? t('Background caching was interrupted. Open the app and tap Continue to resume.')
      : t('Paused while the app was in the background. Tap Continue when you are ready.')
    : task.reason === 'user' ? t('Continue to resume this saved task.') : undefined;
  const protectionError = task.error === 'Background cache protection could not start'
    || task.error === 'Background cache protection stopped';

  return (
    <SettingsPage title={t('Bulk artwork & lyrics')}>
      <DockScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={[settingsStyles.sectionDescription, { marginTop: 0 }]}>
          {t('Cache lyrics, album covers and artist portraits from your entire server library for offline use. This does not download audio or delete existing files.')}
        </Text>
        {Platform.OS === 'android' ? <Text style={settingsStyles.sectionDescription}>
          {t('Caching continues with the screen locked or while you use other apps. Track or pause it from the download notification.')}
        </Text> : null}
        <Text style={settingsStyles.sectionTitle}>{t('What to cache')}</Text>
        <SettingsGroup>
          <SwitchList options={KINDS.map((kind) => ({
            label: label(kind), value: selected.includes(kind), disabled: busy || preparing || !task.hydrated,
            onChange: (enabled) => setDraft({ owner, kinds: enabled
              ? KINDS.filter((value) => value === kind || selected.includes(value))
              : selected.filter((value) => value !== kind) }),
          }))} />
        </SettingsGroup>
        <Text style={settingsStyles.sectionDescription}>
          {t('Lyrics follow your current source settings and keep word-by-word timing when available. Existing cached items are skipped; each scan adds only what is missing.')}
        </Text>
        <Text style={settingsStyles.sectionTitle}>{t('Current task')}</Text>
        <SettingsGroup>
          <SettingRow label={task.hydrated && !preparing ? statusText : t('Loading…')}
            description={task.status === 'paused' ? pauseDescription : undefined} />
          {busy || preparing ? <View style={styles.working}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.secondary}>{preparing ? t('Loading…') : t('You can pause this task at any time.')}</Text>
          </View> : null}
          {task.status === 'paused' ? <SettingRow label={t('Continue')}
            icon="play-outline" onPress={preparing ? undefined : () => run(task.resume)} /> : null}
          {busy ? <SettingRow label={t('Pause')} icon="pause-outline" onPress={task.pause} /> : null}
          {!busy ? <SettingRow label={t('Scan selected items')}
            icon="download-outline" description={!owner ? t('Connect to a server to start.')
              : offline ? t('Return online to start or continue this task.')
              : selected.length === 0 ? t('Choose at least one item type.')
              : t('Starts an incremental scan of the entire library.')}
            onPress={preparing ? undefined : () => run(() => task.start(selected), true)} /> : null}
          {!busy && failures > 0 ? <SettingRow label={t('Retry failed items only')}
            icon="refresh-outline" right={count(failures)}
            onPress={preparing ? undefined : () => run(task.retryFailed)} /> : null}
          {busy || task.status === 'paused' ? <SettingRow label={t('Cancel task')}
            description={t('Stops the remaining work and keeps files already cached.')}
            icon="close-circle-outline" destructive onPress={task.cancel} /> : null}
        </SettingsGroup>
        {task.status === 'paused' ? <Text style={settingsStyles.sectionDescription}>
          {t('Continue keeps the current task selection. Changing the switches affects only your next scan.')}
        </Text> : null}
        {actionNotice?.owner === owner ? <Text accessibilityRole="alert" style={styles.secondary}>
          {actionNotice.message}
        </Text> : null}
        {task.error || actionError?.owner === owner ? <Text accessibilityRole="alert" style={styles.error}>
          {protectionError
            ? t('Background caching could not continue. Open the app and tap Continue to retry; cached files are kept.')
            : t("Couldn't complete the action. Check your connection and try again.")}
        </Text> : null}

        <Text style={settingsStyles.sectionTitle}>{t('Progress by type')}</Text>
        {KINDS.map((kind) => {
          const stats = task.stats[kind];
          const completed = Math.max(0, Math.min(stats.total, stats.total - stats.pending));
          const percent = stats.total > 0 ? Math.round(completed / stats.total * 100) : 0;
          const metrics = [
            { key: 'total', label: t('Total'), value: stats.total },
            { key: 'success', label: t('Newly cached'), value: stats.success },
            { key: 'cached', label: t('Already cached'), value: stats.cached },
            { key: 'missing', label: t('Unavailable at source'), value: stats.missing },
            { key: 'failed', label: t('Failed'), value: stats.failed },
            { key: 'pending', label: t('Remaining'), value: stats.pending },
          ];
          return <View key={kind} style={styles.progressSection}>
            <SettingsGroup>
              <View style={styles.progressCard}>
                <View style={styles.progressHeading}>
                  <Text style={styles.heading}>{label(kind)}</Text>
                  <Text style={styles.secondary}>{task.selected.includes(kind) ? `${percent}%` : t('Not selected')}</Text>
                </View>
                <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={label(kind)}
                  accessibilityValue={{ min: 0, max: Math.max(1, stats.total), now: completed,
                    text: t('{done} of {total}', { done: count(completed), total: count(stats.total) }) }}>
                  <View style={[styles.fill, { width: `${percent}%` }]} />
                </View>
                <View style={styles.metrics}>
                  {metrics.map((metric) => <View key={metric.key} style={styles.metric}>
                    <Text style={styles.secondary}>{metric.label}</Text>
                    <Text style={[styles.number, metric.key === 'failed' && metric.value > 0 && { color: colors.danger }]}>
                      {count(metric.value)}
                    </Text>
                  </View>)}
                </View>
              </View>
            </SettingsGroup>
          </View>;
        })}
        <Text style={settingsStyles.sectionDescription}>
          {t('Unavailable at source means no matching artwork or lyrics were found. It is counted separately from failed requests and is not retried automatically.')}
        </Text>
      </DockScrollView>
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  progressSection: { marginBottom: spacing.md },
  progressCard: { padding: spacing.lg, gap: spacing.md },
  progressHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  heading: { color: colors.text, fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 },
  secondary: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.control, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.lg },
  metric: { minWidth: '40%', flexGrow: 1, flexBasis: '40%', gap: 2 },
  number: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  working: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  error: { color: colors.danger, fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing.md },
}));
