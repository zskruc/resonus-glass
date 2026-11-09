import { useIsFocused } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Dialog } from '@/components/Dialog';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsGroup, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { captureLyricOwner } from '@/lib/lyricOwner';
import {
  clearPodcastStorage, getPodcastStorageLastMaintenance, getPodcastStorageUsage,
  type PodcastStorageCategory, type PodcastStorageClearResult, type PodcastStorageUsage,
} from '@/lib/podcastStorage';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors, spacing, useTheme } from '@/theme';

const CLEAR_TITLES = {
  audio: 'Clear podcast audio downloads',
  covers: 'Clear offline podcast covers',
  catalog: 'Clear rebuildable podcast catalog',
} as const;
const CLEAR_MESSAGES = {
  audio: 'Remove downloaded podcast audio for this profile. Files currently playing or downloading are skipped. Your subscriptions, favorites and listening progress are kept.',
  covers: 'Remove managed offline podcast covers for this profile, keeping files currently in use. This does not clear the app-wide image cache. Your subscriptions, favorites and listening progress are kept.',
  catalog: 'Remove rebuildable catalog data from unsubscribed shows in this profile. Keep subscribed shows and metadata needed for favorites, listening progress and downloads. Items currently in use are skipped.',
} as const;

/** Local, profile-owned storage. A confirmed clear belongs to the account,
 * rather than the lifetime of this screen; only its UI read is cancelled. */
export default function PodcastStorageSettings() {
  useTheme();
  const t = useT(), focused = useIsFocused(), language = useSettings((state) => state.language);
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const [scopeEpoch, setScopeEpoch] = useState(0);
  // Count transitions, not just the final profile string: A → B → A in one
  // React batch must invalidate A's original dialog and pending measurement.
  useEffect(() => useAuthStore.subscribe((next, before) => {
    if (next.auth !== before.auth || next.offlineSource !== before.offlineSource
      || next.offline !== before.offline || next.autoOffline !== before.autoOffline)
      setScopeEpoch((before) => before + 1);
  }), []);
  const owner = useMemo(() => ({ profile, auth, scopeEpoch, current: captureLyricOwner(profile) }), [profile, auth, scopeEpoch]);
  const visibleOwner = useRef(owner), mounted = useRef(false);
  useLayoutEffect(() => { visibleOwner.current = owner; }, [owner]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  type State = {
    owner: typeof owner; reading: boolean; usage?: PodcastStorageUsage;
    lastCompletedAt?: number; busy?: PodcastStorageCategory;
    result?: PodcastStorageClearResult; error?: 'read' | 'clear';
  };
  const [state, setState] = useState<State>();
  const [confirmation, setConfirmation] = useState<{ owner: typeof owner; category: PodcastStorageCategory }>();
  const [refresh, setRefresh] = useState(0);
  const operation = useRef<{ owner: typeof owner; category: PodcastStorageCategory } | undefined>(undefined);
  const shown = state?.owner === owner && owner.current() ? state : undefined;
  const confirming = confirmation?.owner === owner && owner.current() ? confirmation : undefined;
  const busy = !!shown?.busy, reading = shown?.reading ?? true;

  useEffect(() => {
    if (!focused) return;
    let active = true;
    const controller = new AbortController();
    const current = () => active && !controller.signal.aborted && owner.current();
    const options = { expectedProfile: owner.profile, signal: controller.signal, current };
    void Promise.resolve().then(async () => {
        if (!current()) return;
        setState((before) => ({ ...(before?.owner === owner ? before : undefined), owner, reading: true,
          error: before?.owner === owner && before.error === 'clear' ? before.error : undefined }));
        const [usage, maintenance] = await Promise.all([getPodcastStorageUsage(options), getPodcastStorageLastMaintenance(options)]);
        if (!current()) return;
        setState((before) => ({ ...(before?.owner === owner ? before : undefined), owner, reading: false, usage,
          lastCompletedAt: maintenance?.lastCompletedAt ?? undefined, error: before?.owner === owner && before.error === 'clear' ? before.error : undefined }));
      }).catch(() => {
        if (current()) setState((before) => ({ ...(before?.owner === owner ? before : undefined), owner, reading: false, error: 'read' }));
      });
    return () => { active = false; controller.abort(); };
  }, [owner, focused, refresh]);

  function confirm(category: PodcastStorageCategory) {
    if (!owner.current() || busy || reading || operation.current?.owner === owner) return;
    setConfirmation({ owner, category });
  }
  function clear() {
    const target = confirmation;
    if (!target || target.owner !== owner || visibleOwner.current !== owner || !owner.current()
      || operation.current?.owner === owner) return;
    const ticket = { owner, category: target.category };
    operation.current = ticket;
    setConfirmation(undefined);
    setState((before) => ({ ...(before?.owner === owner ? before : undefined), owner, reading: false,
      busy: target.category, result: undefined, error: undefined }));
    // No route-bound AbortSignal here. Leaving settings must not interrupt a
    // user-confirmed local clear halfway through its catalog/file transaction.
    const options = { expectedProfile: owner.profile, current: owner.current };
    const canPublish = () => mounted.current && visibleOwner.current === owner && owner.current();
    void clearPodcastStorage(target.category, options).then((result) => {
      if (canPublish()) setState((before) => ({ ...(before?.owner === owner ? before : undefined), owner,
        reading: false, busy: undefined, result }));
    }).catch(() => {
      if (canPublish()) setState((before) => ({ ...(before?.owner === owner ? before : undefined), owner,
        reading: false, busy: undefined, error: 'clear' }));
    }).finally(() => {
      if (operation.current === ticket) operation.current = undefined;
      if (canPublish()) setRefresh((before) => before + 1);
    });
  }

  const size = (value: number | undefined) => value === undefined ? '…' : formatBytes(value);
  const date = shown?.lastCompletedAt && shown.lastCompletedAt > 0
    ? new Date(shown.lastCompletedAt).toLocaleString(language) : t('Not yet');
  return <SettingsPage title={t('Podcast storage')}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      <Text style={settingsStyles.sectionDescription}>{t('Only the current profile is measured and cleared. Other profiles are not changed.')}</Text>
      <SettingsGroup>
        <SettingRow label={t('Total podcast storage')} right={size(shown?.usage?.totalBytes)} />
        <SettingRow label={t('Downloaded podcast audio')} right={size(shown?.usage?.audioBytes)} />
        <SettingRow label={t('Offline podcast covers')} right={size(shown?.usage?.coverBytes)} />
        <SettingRow label={t('Cached podcast catalog')} right={size(shown?.usage?.catalogBytes)} />
        <SettingRow label={t('Reusable catalog space')} right={size(shown?.usage?.databaseFreeBytes)}
          description={t('Included in catalog size. The app can reuse this space; it is released on disk only when the catalog can safely shrink.')} />
        <SettingRow label={t('Refresh storage usage')} icon="refresh-outline"
          onPress={!busy && !reading ? () => setRefresh((before) => before + 1) : undefined} />
      </SettingsGroup>
      {reading || busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <ActivityIndicator color={colors.accent} />
        <Text accessibilityLiveRegion="polite" style={settingsStyles.sectionDescription}>
          {busy ? t('Clearing podcast storage…') : t('Measuring podcast storage…')}
        </Text>
      </View> : null}
      {shown?.error ? <Text accessibilityRole="alert" style={{ color: colors.text }}>
        {shown.error === 'read' ? t("Couldn't measure podcast storage. Try again.")
          : t("Couldn't finish clearing podcast storage. Refresh the usage and try again; some items may already have been removed.")}
      </Text> : null}
      {shown?.result ? <Text accessibilityRole={shown.result.failedFiles > 0 ? 'alert' : undefined}
        accessibilityLiveRegion="polite" style={{ color: colors.text }}>
        {t('Deleted files: {files}. Database records: {records}. Freed: {size}. In-use items kept: {skipped}. Failed files: {failed}.', {
          files: shown.result.removedFiles, records: shown.result.removedRecords, size: formatBytes(shown.result.removedBytes),
          skipped: shown.result.skippedInUse, failed: shown.result.failedFiles,
        })}
      </Text> : null}

      <Text style={settingsStyles.sectionTitle}>{t('Clear podcast storage')}</Text>
      <SettingsGroup>
        <SettingRow label={t('Clear podcast audio downloads')} destructive icon="trash-outline"
          description={t('Keep subscriptions, favorites and listening progress.')}
          onPress={!busy && !reading ? () => confirm('audio') : undefined} />
        <SettingRow label={t('Clear offline podcast covers')} destructive icon="trash-outline"
          description={t('Managed offline covers only; keep the app-wide image cache.')}
          onPress={!busy && !reading ? () => confirm('covers') : undefined} />
        <SettingRow label={t('Clear rebuildable podcast catalog')} destructive icon="trash-outline"
          description={t('Unsubscribed catalog only; keep metadata needed for your saved data.')}
          onPress={!busy && !reading ? () => confirm('catalog') : undefined} />
      </SettingsGroup>
      <Text style={settingsStyles.sectionDescription}>{t('Items currently in use are skipped. Downloads that are playing or still transferring are kept.')}</Text>

      <Text style={settingsStyles.sectionTitle}>{t('Automatic podcast cleanup')}</Text>
      <SettingsGroup>
        <SettingRow label={t('Finished automatic downloads')}
          description={t('Automatically downloaded episodes can be removed 24 hours after they are marked played. Manual and existing downloads are kept.')} />
        <SettingRow label={t('Unsubscribed cached catalog')}
          description={t('Rebuildable data from unsubscribed shows can be removed after 3 days. Metadata needed for favorites, listening progress and downloads is kept.')} />
        <SettingRow label={t('Cleanup schedule')}
          description={t('Checked on app startup or return to the foreground, at most once every 24 hours.')} />
        <SettingRow label={t('Last automatic cleanup')} right={date} />
      </SettingsGroup>
    </DockScrollView>
    <Dialog visible={!!confirming} title={confirming ? t(CLEAR_TITLES[confirming.category]) : ''}
      message={confirming ? t(CLEAR_MESSAGES[confirming.category]) : ''} confirmLabel={t('Clear')} destructive
      onCancel={() => setConfirmation(undefined)} onConfirm={clear} />
  </SettingsPage>;
}
