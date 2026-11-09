import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SettingsPage, SettingRow, SettingsGroup, settingsStyles } from '@/components/SettingsUI';
import { DockScrollView } from '@/components/DockScrollView';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useLibraries } from '@/store/libraries';
import { musicIndexIdentity, musicIndexStatus, rebuildMusicIndex } from '@/lib/musicDiscoveryIndex';
import { colors } from '@/theme';
export default function MusicSearchSettings() {
  useAuthStore((s) => s.auth); useAuthStore((s) => s.offline); useAuthStore((s) => s.offlineSource); useLibraries((s) => s.disabled);
  const identity = musicIndexIdentity();
  return <MusicSearchSettingsContent key={`${identity.profile}|${identity.source}`} />;
}
function MusicSearchSettingsContent() {
  useAuthStore((s) => s.auth); useAuthStore((s) => s.offline); useAuthStore((s) => s.offlineSource); useLibraries((s) => s.disabled);
  const identity = musicIndexIdentity(), t = useT(), controller = useRef<AbortController | null>(null);
  const [count, setCount] = useState(0), [building, setBuilding] = useState(false), [error, setError] = useState(false);
  const status = useQuery({ queryKey: ['musicDiscoveryIndex', identity.profile, identity.source], queryFn: () => musicIndexStatus(identity) });
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, [identity.profile, identity.source]);
  async function rebuild() {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request; setBuilding(true); setError(false); setCount(0);
    try { await rebuildMusicIndex(identity, request.signal, (value) => { if (controller.current === request) setCount(value); }); await status.refetch(); }
    catch { if (!request.signal.aborted) setError(true); }
    finally { if (controller.current === request) { controller.current = null; setBuilding(false); } }
  }
  return <SettingsPage title={t('Music search index')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <Text style={settingsStyles.sectionDescription}>{t('Build a device-only metadata index for full pinyin, initials, file paths and listening intentions. No audio or artwork is downloaded. Rebuild after changing your library.')}</Text>
    <SettingsGroup><SettingRow label={t('Indexed songs')} right={String(status.data?.count ?? 0)} />
      <SettingRow label={t('Last indexed')} right={status.data?.updatedAt ? new Date(status.data.updatedAt).toLocaleString() : t('Not yet indexed')} />
      <SettingRow label={t(building ? 'Cancel indexing' : 'Build or refresh index')} onPress={() => building ? controller.current?.abort() : void rebuild()} /></SettingsGroup>
    {building ? <View style={{ flexDirection: 'row', gap: 12 }}><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.text }}>{t('Reading library: {n} songs', { n: count })}</Text></View> : null}
    {error ? <Text style={{ color: colors.text }}>{t('Indexing failed. Your previous complete index has been kept.')}</Text> : null}
    <Text style={settingsStyles.sectionDescription}>{t('Examples: zhoujielun or zjl finds 周杰伦. Paths only match metadata exposed by your music source. Searches use the last complete index and never a partial build.')}</Text>
  </DockScrollView></SettingsPage>;
}
