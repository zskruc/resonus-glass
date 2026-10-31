/** Optional, conservative local-file edge trimming; original files/timestamps are retained. */
import { useEffect } from 'react';
import { Text } from 'react-native';

import { DockScrollView } from '@/components/DockScrollView';
import { SelectList, SettingRow, SettingsGroup, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { inspectCurrentSilence, usePlayerStore } from '@/store/player';
import { useSilenceTrim } from '@/store/silenceTrim';
import { useTheme } from '@/theme';

export default function SilenceTrimSettings() {
  useTheme();
  const t = useT();
  const state = useSilenceTrim();
  const song = usePlayerStore((player) => player.queue[player.index]);
  useEffect(() => { void useSilenceTrim.getState().hydrate(); }, []);
  const status = !state.enabled ? t('Off') : state.status === 'analyzing' ? t('Analyzing audio edges…')
    : state.status === 'ready' ? t('Audio edges analyzed') : state.status === 'head-only' ? t('Only the leading edge could be analyzed')
      : state.status === 'not-local' ? t('This song has no local audio file')
        : state.status === 'unavailable' ? t('This audio file could not be analyzed') : t('Not analyzed');
  const bounds = state.songId === song?.id ? state.bounds : null;
  const seconds = (value: number) => t('{n} seconds', { n: value.toFixed(2) });
  return <SettingsPage title={t('Skip song-edge silence')}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      <Text style={settingsStyles.sectionDescription}>
        {t('For downloaded and local audio only. Online streams are not downloaded for analysis.')}
      </Text>
      {!state.supported ? <Text style={settingsStyles.sectionDescription}>{t('Audio edge analysis is not supported on this device.')}</Text> : <>
        <SettingsGroup>
          <SwitchList options={[{ label: t('Skip song-edge silence'), value: state.enabled,
            onChange: (enabled) => state.setPreferences({ enabled }) }]} />
          <SelectList label={t('Silence threshold')} value={state.thresholdDb}
            onChange={(thresholdDb) => state.setPreferences({ thresholdDb })}
            options={[-70, -60, -50, -40].map((value) => ({ value, label: `${value} dBFS` }))} />
          <SelectList label={t('Minimum detected silence')} value={state.minimumSilenceMs}
            onChange={(minimumSilenceMs) => state.setPreferences({ minimumSilenceMs })}
            options={[250, 500, 1000, 2000].map((value) => ({ value, label: seconds(value / 1000) }))} />
          <SelectList label={t('Maximum scan per edge')} value={state.scanSeconds}
            onChange={(scanSeconds) => state.setPreferences({ scanSeconds })}
            options={[3, 6, 12, 20].map((value) => ({ value, label: seconds(value) }))} />
        </SettingsGroup>
        <Text style={settingsStyles.sectionDescription}>
          {t('Only song edges are inspected; quiet sections inside songs are preserved. Seeking takes priority, and lyrics keep the original timeline.')}
        </Text>
        <SettingsGroup>
          <SettingRow label={t('Current song')} right={song?.title ?? '—'} />
          <SettingRow label={t('Analysis status')} description={status} />
          {bounds ? <SettingRow label={t('Leading silence trimmed')} right={seconds(bounds.startSec)} /> : null}
          {bounds?.complete ? <SettingRow label={t('Trailing silence trimmed')} right={seconds(bounds.durationSec - bounds.endSec)} /> : null}
          {state.enabled && song && state.status !== 'analyzing' ? <SettingRow label={t('Analyze current song')}
            icon="scan-outline" onPress={() => inspectCurrentSilence()} /> : null}
          <SettingRow label={t('Restore default silence settings')} icon="refresh-outline" onPress={state.reset} />
        </SettingsGroup>
      </>}
    </DockScrollView>
  </SettingsPage>;
}
