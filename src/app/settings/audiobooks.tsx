/** Local listening positions; uses the existing Glass settings controls. */
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Dialog } from '@/components/Dialog';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsGroup, SettingsPage, settingsStyles, SliderRow, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { AUDIOBOOK_CONTINUE_REWIND_STEPS } from '@/lib/audiobook';
import { useAlbumProgress } from '@/store/albumProgress';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme';

export default function AudiobooksSettings() {
  useTheme();
  const router = useRouter();
  const t = useT(), [confirmClear, setConfirmClear] = useState(false);
  const enabled = useSettings((state) => state.saveAudiobookProgress);
  const setEnabled = useSettings((state) => state.setSaveAudiobookProgress);
  const rewind = useSettings((state) => state.audiobookContinueRewindSec);
  const setRewind = useSettings((state) => state.setAudiobookContinueRewindSec);
  const error = useAlbumProgress((state) => state.error);
  useEffect(() => { void useAlbumProgress.getState().hydrate().catch(() => {}); }, []);
  const rung = AUDIOBOOK_CONTINUE_REWIND_STEPS.reduce<number>((nearest, value, index) =>
    Math.abs(value - rewind) < Math.abs(AUDIOBOOK_CONTINUE_REWIND_STEPS[nearest] - rewind) ? index : nearest, 0);
  return <SettingsPage title={t('Audiobooks')}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      <SettingRow icon="book-outline" label={t('Browse audiobooks')} onPress={() => router.push('/audiobooks')} />
      <SettingsGroup>
        <SwitchList options={[{ label: t('Save audiobook progress'), description: t('Remember where you stopped in audiobooks. Saved on this device for each profile.'),
          value: enabled, onChange: setEnabled }]} />
        <SliderRow label={t('Rewind on resume')}
          description={t('Continue can rewind through earlier chapters. Chapters of unknown length are not skipped.')}
          value={rung} max={AUDIOBOOK_CONTINUE_REWIND_STEPS.length - 1} step={1} disabled={!enabled}
          formatValue={(index) => { const seconds = AUDIOBOOK_CONTINUE_REWIND_STEPS[Math.round(index)] ?? 0;
            return seconds === 0 ? t('Off') : formatDuration(seconds); }}
          fineTune={{ step: 1, doneLabel: t('Done') }}
          onChange={(index) => setRewind(AUDIOBOOK_CONTINUE_REWIND_STEPS[Math.round(index)] ?? 0)} />
      </SettingsGroup>
      {error ? <Text style={settingsStyles.sectionDescription}>{t('Audiobook progress could not be saved. Existing positions are retained.')}</Text> : null}
      <SettingRow icon="trash-outline" label={t('Delete audiobook progress')} destructive onPress={() => setConfirmClear(true)} />
    </DockScrollView>
    <Dialog visible={confirmClear} title={t('Delete audiobook progress')} message={t('Delete saved audiobook positions for all profiles on this device?')}
      confirmLabel={t('Delete')} destructive onCancel={() => setConfirmClear(false)} onConfirm={() => {
        setConfirmClear(false);
        void useAlbumProgress.getState().clearAll().then(() => useToast.getState().show(t('Audiobook progress deleted')))
          .catch(() => useToast.getState().show(t('Audiobook progress could not be saved. Existing positions are retained.')));
      }} />
  </SettingsPage>;
}
