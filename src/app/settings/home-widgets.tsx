import { requireOptionalNativeModule } from 'expo-modules-core';
import { Text } from 'react-native';
import { SettingsPage, SettingsGroup, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { DockScrollView } from '@/components/DockScrollView';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

const native = requireOptionalNativeModule<{ pinExtraWidget(kind: string): boolean }>('HomeWidget');
export default function HomeWidgetsScreen() {
  useTheme();
  const t = useT(), toast = useToast((state) => state.show);
  const pin = (kind: string) => { try { if (!native?.pinExtraWidget(kind)) toast(t('Long press your home screen, choose Widgets, then Resonus Glass.')); }
    catch { toast(t('Long press your home screen, choose Widgets, then Resonus Glass.')); } };
  return <SettingsPage title={t('Home screen widgets')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <Text style={settingsStyles.sectionDescription}>{t('Add a widget to your launcher. These use Android widgets and keep their own readable light and dark appearance.')}</Text>
    <SettingsGroup>
      <SettingRow label={t('Continue podcasts')} description={t('Three unfinished episodes with remaining time. Tap an episode to continue listening.')} chevron onPress={() => pin('podcast')} />
      <SettingRow label={t('Listening statistics')} description={t('Listening time, play count and most listened track over the last 30 days.')} chevron onPress={() => pin('stats')} />
      <SettingRow label={t('Current lyrics')} description={t('Three nearby lines, using your current lyric source, edits and timing offset. Updates when the lyric line changes.')} chevron onPress={() => pin('lyrics')} />
    </SettingsGroup>
    <Text style={settingsStyles.sectionDescription}>{t('Open the app once after adding a widget to refresh it. No new network or catalog work runs for widgets that are not installed.')}</Text>
  </DockScrollView></SettingsPage>;
}
