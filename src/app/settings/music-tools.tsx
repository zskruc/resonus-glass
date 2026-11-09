/** One discoverable entry for the optional local-library tools. */
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
export default function MusicToolsSettings() {
  useTheme(); const t = useT(), router = useRouter();
  return <SettingsPage title={t('Music tools and customization')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <Text style={settingsStyles.sectionTitle}>{t('Discovery and organization')}</Text>
    <SettingRow label={t('Home and search layouts')} onPress={() => router.push('/settings/discovery-layout')} />
    <SettingRow label={t('Pinyin library search')} onPress={() => router.push('/settings/music-search')} />
    <SettingRow label={t('Listening scenes')} onPress={() => router.push('/listening-intents')} />
    <SettingRow label={t('Discover internet radio')} onPress={() => router.push('/radio-discover')} />
    <SettingRow label={t('Media folders and tags')} onPress={() => router.push('/media-collections')} />
    <Text style={settingsStyles.sectionTitle}>{t('Playback and lyrics')}</Text>
    <SettingRow label={t('Listening sessions, groups and chapters')} onPress={() => router.push('/settings/listening-tools')} />
    <SettingRow label={t('Local edits and artist aliases')} onPress={() => router.push('/settings/local-customizations')} />
    <SettingRow label={t('Lyric language fonts')} onPress={() => router.push('/settings/lyric-fonts')} />
    <Text style={settingsStyles.sectionDescription}>{t('Edit song metadata and export or edit lyrics from a song’s menu.')}</Text>
    <SettingRow label={t('Home screen widgets')} onPress={() => router.push('/settings/home-widgets')} />
    <Text style={settingsStyles.sectionTitle}>{t('Backup and transfer')}</Text>
    <SettingRow label={t('Personal backup and restore')} onPress={() => router.push('/settings/personal-backup')} />
    <SettingRow label={t('Wi-Fi music transfer')} onPress={() => router.push('/settings/wifi-transfer')} />
    <SettingRow label={t('Pending favorites and ratings')} onPress={() => router.push('/settings/pending-marks')} />
    <SettingRow label={t('Playlist recovery')} onPress={() => router.push('/settings/playlist-recovery')} />
    <SettingRow label={t('Playlist import and export')} onPress={() => router.push('/settings/playlist-exchange')} />
  </DockScrollView></SettingsPage>;
}
