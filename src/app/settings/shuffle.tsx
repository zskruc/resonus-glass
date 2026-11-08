import { useState } from 'react';
import { Text } from 'react-native';

import { DockScrollView } from '@/components/DockScrollView';
import { SelectList, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useShufflePreferences } from '@/store/shufflePreferences';
import { SHUFFLE_MODES, type ShuffleMode } from '@/lib/weightedShuffle';
import { useTheme } from '@/theme';

export const SHUFFLE_MODE_LABELS: Record<ShuffleMode, string> = {
  uniform: 'Equal chance', frequentSongs: 'Favor frequently played songs', rareSongs: 'Favor rarely played songs',
  frequentArtists: 'Favor frequently played artists', rareArtists: 'Favor rarely played artists',
};
export default function ShuffleSettings() {
  useTheme();
  const t = useT(), mode = useShufflePreferences((state) => state.mode);
  const hydrated = useShufflePreferences((state) => state.hydrated), error = useShufflePreferences((state) => state.error);
  const [saving, setSaving] = useState(false);
  return <SettingsPage title={t('Shuffle preferences')}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      <Text style={settingsStyles.sectionDescription}>{t('Choose how shuffle orders music. Every song stays eligible; your current queue changes only when you start or reshuffle it.')}</Text>
      <SelectList<ShuffleMode> collapsible={false} value={mode} disabled={!hydrated || saving}
        options={SHUFFLE_MODES.map((value) => ({ value, label: t(SHUFFLE_MODE_LABELS[value]) }))}
        onChange={(value) => {
          setSaving(true);
          void useShufflePreferences.getState().setMode(value).catch(() => {}).finally(() => setSaving(false));
        }} />
      <Text style={settingsStyles.sectionDescription}>{t('Listening counts combine this profile’s local history with the counts provided by your music server. Artist weighting uses the songs being shuffled.')}</Text>
      {error ? <SettingRow label={t('Could not save shuffle preferences. Retry reading saved settings.')} onPress={() => {
        void useShufflePreferences.getState().hydrate();
      }} /> : null}
    </DockScrollView>
  </SettingsPage>;
}
