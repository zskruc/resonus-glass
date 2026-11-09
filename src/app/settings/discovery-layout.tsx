/** Account-specific presentation controls; untouched defaults retain both existing themes. */
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { DockScrollView } from '@/components/DockScrollView';
import { GlassPressable, GlassSwitch } from '@/components/glass';
import { SettingsPage, SettingsGroup, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useDiscoveryPreferences } from '@/store/discoveryPreferences';
import type { SearchSectionKey } from '@/lib/discoveryPreferences';
import { colors, spacing } from '@/theme';
const LABEL: Record<SearchSectionKey, string> = { songs: 'Songs', artists: 'Artists', albums: 'Albums', playlists: 'Playlists', lyrics: 'Lyrics', radio: 'Radio' };
export default function DiscoveryLayoutSettings() {
  const t = useT(), prefs = useDiscoveryPreferences();
  const sections = prefs.data.search.sections;
  const preset = (kind: 'default' | 'music' | 'reading') => prefs.change((data) => ({ ...data, search: {
    density: kind === 'music' ? 'compact' : 'comfortable', sections: (kind === 'music' ? ['songs', 'albums', 'artists', 'playlists', 'lyrics', 'radio'] :
      kind === 'reading' ? ['lyrics', 'songs', 'artists', 'albums', 'playlists', 'radio'] : ['lyrics', 'artists', 'albums', 'songs', 'playlists', 'radio']).map((key) => ({ key: key as SearchSectionKey, enabled: true })) } }));
  return <SettingsPage title={t('Home and search layout')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <SettingsGroup><SettingRow label={t('Home sections')} onPress={() => router.push('/settings/home-sections')} />
      <SettingRow label={t('Music search index')} onPress={() => router.push('/settings/music-search')} />
      <SettingRow label={t('Listening intentions')} onPress={() => router.push('/listening-intents')} /></SettingsGroup>
    <Text style={settingsStyles.sectionDescription}>{t('Search presets change section order and density. Individual changes are saved for this account.')}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>{(['default', 'music', 'reading'] as const).map((kind) => <GlassPressable key={kind} onPress={() => void preset(kind)} style={{ padding: 12, borderRadius: 14, backgroundColor: colors.surfaceHighlight }}><Text style={{ color: colors.text }}>{t(kind === 'default' ? 'Default layout' : kind === 'music' ? 'Compact music' : 'Lyrics first')}</Text></GlassPressable>)}</View>
    <SettingsGroup><View style={settingsStyles.row}><Text style={settingsStyles.rowLabel}>{t('Compact search results')}</Text><GlassSwitch value={prefs.data.search.density === 'compact'} onValueChange={(value) => void prefs.change((data) => ({ ...data, search: { ...data.search, density: value ? 'compact' : 'comfortable' } }))} /></View></SettingsGroup>
    <SettingsGroup>{sections.map((section, index) => <View key={section.key} style={settingsStyles.row}><Text style={[settingsStyles.rowLabel, { flex: 1 }]}>{t(LABEL[section.key])}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <GlassPressable disabled={!index} accessibilityLabel={t('Move up')} onPress={() => void prefs.change((data) => { const rows = data.search.sections.slice(); [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; return { ...data, search: { ...data.search, sections: rows } }; })}><Text style={{ color: index ? colors.accent : colors.textMuted, fontSize: 23 }}>↑</Text></GlassPressable>
      <GlassSwitch value={section.enabled} onValueChange={(enabled) => { if (!enabled && sections.filter((row) => row.enabled).length <= 1) return; void prefs.change((data) => ({ ...data, search: { ...data.search, sections: data.search.sections.map((row) => row.key === section.key ? { ...row, enabled } : row) } })); }} /></View></View>)}</SettingsGroup>
    {prefs.error ? <Text style={{ color: colors.text }}>{t('Could not save changes. Please try again.')}</Text> : null}
  </DockScrollView></SettingsPage>;
}
