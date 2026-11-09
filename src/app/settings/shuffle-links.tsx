import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native';
import { getSong } from '@/api/data';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingsPage, SettingsGroup, SettingRow, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useListeningToolsSource } from '@/hooks/useListeningTools';
import { setSongShuffleLink } from '@/lib/shuffleLinks';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { mutateListeningSource } from '@/store/listeningTools';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, useTheme } from '@/theme';

export default function ShuffleLinksScreen() {
  useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>(), playing = usePlayerStore(currentSong), t = useT();
  useAuthStore((state) => state.auth); const profile = profileScopeId();
  const target = id ?? playing?.id, { source, pending } = useListeningToolsSource();
  const { data } = useQuery({ queryKey: ['shuffleLinkSong', profile, target], enabled: !!target && target !== playing?.id,
    queryFn: async () => { const owns = captureLyricOwner(profile), song = await getSong(target!); if (!owns()) throw new Error('Profile changed'); return song; } });
  const song = target === playing?.id ? playing : data, [busy, setBusy] = useState(false), active = useRef(false), toast = useToast((state) => state.show);
  const [page, setPage] = useState(0), links = source?.links ?? [], lastPage = Math.max(0, Math.ceil(links.length / 30) - 1), actualPage = Math.min(page, lastPage);
  const viewOwns = captureLyricOwner(profile);
  const change = async (direction: 'next' | 'previous', enabled: boolean) => {
    if (!song || active.current || !viewOwns()) return; active.current = true; setBusy(true);
    try { if (!await setSongShuffleLink(song, direction, enabled)) toast(t('No neighbouring album track is available.')); }
    catch { toast(t("Couldn't save listening settings.")); } finally { active.current = false; setBusy(false); }
  };
  return <SettingsPage title={t('Linked songs in shuffle')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    {pending ? <ActivityIndicator color={colors.accent} /> : null}
    <Text style={settingsStyles.groupTitle}>{song?.title ?? t('Play a song to configure its album links.')}</Text>
    <SwitchList options={(['previous', 'next'] as const).map((direction) => ({
      label: t(direction === 'next' ? 'Always follow with the next album track' : 'Always lead with the previous album track'),
      value: !!song && !!source?.links.some((edge) => edge.direction === direction && (direction === 'next' ? edge.from.id === song.id : edge.to.id === song.id)),
      disabled: !song?.albumId || !!song.url || !!song.podcastChannelId || pending || busy,
      // eslint-disable-next-line react-hooks/refs -- SwitchList invokes this event callback on user input, never while mapping options.
      onChange: (value) => void change(direction, value),
    }))} />
    <Text style={settingsStyles.sectionDescription}>{t('Shuffle moves linked tracks as a group. Ordered podcasts and audiobooks keep their existing order.')}</Text>
    <Text style={settingsStyles.groupTitle}>{t('Saved album links')}</Text>
    <SettingsGroup>{links.slice(actualPage * 30, actualPage * 30 + 30).map((edge) => <SettingRow key={`${edge.from.id}:${edge.to.id}:${edge.direction}`} label={`${edge.from.title} → ${edge.to.title}`}
      right={t('Remove')} onPress={busy ? undefined : () => { if (active.current) return; active.current = true; setBusy(true);
        void mutateListeningSource((value) => ({ ...value, links: value.links.filter((item) => item.from.id !== edge.from.id || item.to.id !== edge.to.id || item.direction !== edge.direction) })).catch(() => toast(t("Couldn't save listening settings.")))
          .finally(() => { active.current = false; setBusy(false); }); }} />)}</SettingsGroup>
    {actualPage ? <SettingRow label={t('Previous')} onPress={() => setPage(actualPage - 1)} /> : null}
    {actualPage < lastPage ? <SettingRow label={t('Next')} onPress={() => setPage(actualPage + 1)} /> : null}
  </DockScrollView></SettingsPage>;
}
