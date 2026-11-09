import { useRef, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingsPage, SettingsGroup, SettingRow, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useListeningToolsSource } from '@/hooks/useListeningTools';
import { LISTENING_SPACES, type ListeningSpace } from '@/lib/listeningTools';
import { mutateListeningSource } from '@/store/listeningTools';
import { rememberCurrentListeningSession, resumeListeningSpace } from '@/store/player';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, useTheme } from '@/theme';

const titles: Record<ListeningSpace, string> = { music: 'Music', podcast: 'Podcasts', radio: 'Radio', audiobook: 'Audiobooks' };
export default function ListeningToolsScreen() {
  useTheme();
  const t = useT(), router = useRouter(), { source, pending, error, retry } = useListeningToolsSource();
  const active = useRef(false), [busy, setBusy] = useState(false), toast = useToast((state) => state.show);
  const run = async (action: () => Promise<unknown>) => {
    if (active.current) return; active.current = true; setBusy(true);
    try { if (await action() === false) toast(t('This item is no longer available.')); }
    catch { toast(t("Couldn't save listening settings.")); }
    finally { active.current = false; setBusy(false); }
  };
  return <SettingsPage title={t('Listening tools')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    {pending && !error ? <ActivityIndicator color={colors.accent} /> : null}
    {error ? <SettingsGroup><SettingRow label={t('Retry')} description={t("Couldn't load listening settings.")} onPress={() => void run(retry)} /></SettingsGroup> : null}
    <SwitchList options={[{ label: t('Separate listening sessions'), description: t('Keep music, podcasts, radio and audiobooks ready to continue.'),
      value: !!source?.separateSessions, disabled: busy || pending,
      onChange: (value) => void run(async () => { const saved = await mutateListeningSource((data) => ({ ...data, separateSessions: value }));
        if (saved && value) await rememberCurrentListeningSession(); return saved; }) }]} />
    <Text style={settingsStyles.groupTitle}>{t('Continue listening')}</Text>
    <SettingsGroup>{LISTENING_SPACES.map((space) => { const session = source?.sessions[space], song = session?.songs[session.index];
      return <SettingRow key={space} label={t(titles[space])} description={song?.title ?? t('No saved session')}
        right={session && space !== 'radio' ? `${Math.floor(session.position / 60)}:${String(Math.floor(session.position % 60)).padStart(2, '0')}` : undefined}
        onPress={!busy && session ? () => void run(() => resumeListeningSpace(space)) : undefined} />; })}</SettingsGroup>
    <Text style={settingsStyles.sectionDescription}>{t('Restoring starts only when you tap a session. Up to 500 queue items are retained around the selected track.')}</Text>
    <SettingsGroup>
      <SettingRow label={t('Linked songs in shuffle')} description={t('Keep neighbouring album tracks together.')} chevron onPress={() => router.push('/settings/shuffle-links')} />
      <SettingRow label={t('Local chapters')} description={t('Import chapters or stop after a selected chapter.')} chevron onPress={() => router.push('/settings/chapters')} />
      <SettingRow label={t('Home screen widgets')} chevron onPress={() => router.push('/settings/home-widgets')} />
      <SettingRow label={t('Wi-Fi music transfer')} chevron onPress={() => router.push('/settings/wifi-transfer')} />
    </SettingsGroup>
  </DockScrollView></SettingsPage>;
}
