/** No AI and no claimed audio classification: every intention explains its metadata rule. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SettingsPage, SettingRow, SettingsGroup, settingsStyles } from '@/components/SettingsUI';
import { DockScrollView } from '@/components/DockScrollView';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { TrackRow } from '@/components/TrackRow';
import { useT } from '@/i18n';
import { useDiscoveryPreferences } from '@/store/discoveryPreferences';
import { usePlayerStore } from '@/store/player';
import { useAuthStore } from '@/store/auth';
import { useLibraries } from '@/store/libraries';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { LISTENING_INTENTS, musicIndexIdentity, musicIndexStatus, readListeningIntent, type ListeningIntentKey } from '@/lib/musicDiscoveryIndex';
import type { Song } from '@/api/subsonic';
import { colors, radius, spacing } from '@/theme';
export default function ListeningIntentScreen() {
  useAuthStore((s) => s.auth); useAuthStore((s) => s.offline); useAuthStore((s) => s.offlineSource); useLibraries((s) => s.disabled);
  const identity = musicIndexIdentity();
  return <ListeningIntentScreenContent key={`${identity.profile}|${identity.source}`} />;
}
function ListeningIntentScreenContent() {
  useAuthStore((s) => s.auth); useAuthStore((s) => s.offline); useAuthStore((s) => s.offlineSource); useLibraries((s) => s.disabled);
  const prefs = useDiscoveryPreferences(), t = useT(), identity = musicIndexIdentity(), controller = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<ListeningIntentKey>(), [songs, setSongs] = useState<Song[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const accepted = useRef<{ source: string; owns: () => boolean; songs: Song[] } | null>(null);
  const status = useQuery({ queryKey: ['musicDiscoveryIndex', identity.profile, identity.source], queryFn: () => musicIndexStatus(identity) });
  useEffect(() => () => { controller.current?.abort(); controller.current = null; accepted.current = null; }, [identity.profile, identity.source]);
  const hour = new Date().getHours();
  const ordered = useMemo(() => LISTENING_INTENTS.filter((item) => !prefs.data.intent.hidden.includes(item.key)).map((item, index) => ({ item, index,
    rank: (prefs.data.intent.pinned.includes(item.key) ? 100 : 0) + (hour >= item.hours[0] && hour < item.hours[1] ? 10 : 0) })).sort((a, b) => b.rank - a.rank || a.index - b.index).map((x) => x.item), [prefs.data.intent, hour]);
  async function choose(key: ListeningIntentKey) {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const owns = captureLyricOwner(identity.profile); setSelected(key); setSongs([]); accepted.current = null; setBusy(true); setError(false);
    try { const result = await readListeningIntent(key, identity, request.signal);
      if (controller.current === request && owns()) { setSongs(result); accepted.current = { source: identity.source, owns, songs: result }; }
    } catch { if (controller.current === request && owns() && !request.signal.aborted) setError(true); }
    finally { if (controller.current === request) { controller.current = null; setBusy(false); } }
  }
  const play = (id?: string) => { const value = accepted.current; if (!value?.owns() || value.source !== musicIndexIdentity().source || !value.songs.length) return;
    const index = id ? value.songs.findIndex((song) => song.id === id) : 0; if (index >= 0) usePlayerStore.getState().playQueue(value.songs, index, t('Listening intentions'), '/listening-intents'); };
  return <SettingsPage title={t('Listening intentions')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <Text style={settingsStyles.sectionDescription}>{t('Choose a moment, preview the matches, then play. Rules use library tags and durations, not AI or an analysis of vocals.')}</Text>
    <SettingsGroup><SettingRow label={t('Music search index')} right={String(status.data?.count ?? 0)} onPress={() => router.push('/settings/music-search')} /></SettingsGroup>
    {ordered.map((item) => <View key={item.key} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><GlassPressable disabled={!status.data?.count} style={{ flex: 1 }} onPress={() => void choose(item.key)}><Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>{t(item.label)}</Text><Text style={{ color: colors.textSecondary, marginTop: 6 }}>{t(item.explanation)}</Text></GlassPressable>
      <GlassPressable accessibilityLabel={t('Pin intention')} onPress={() => void prefs.change((data) => ({ ...data, intent: { ...data.intent, pinned: data.intent.pinned.includes(item.key) ? data.intent.pinned.filter((key) => key !== item.key) : [...data.intent.pinned, item.key] } }))}><Icon name={prefs.data.intent.pinned.includes(item.key) ? 'pin' : 'pin-outline'} size={22} color={colors.accent} /></GlassPressable>
      <GlassPressable accessibilityLabel={t('Hide intention')} onPress={() => void prefs.change((data) => ({ ...data, intent: { ...data.intent, hidden: [...data.intent.hidden, item.key] } }))}><Icon name="eye-off-outline" size={22} color={colors.textSecondary} /></GlassPressable></View>
      {selected === item.key ? <View style={{ marginTop: 12 }}>{busy ? <ActivityIndicator color={colors.accent} /> : <>
        <Text style={{ color: colors.textSecondary }}>{error ? t('Could not read the index. Try again.') : t('{n} matching songs', { n: songs.length })}</Text>
        {songs.length ? <GlassPressable style={{ alignSelf: 'flex-start', backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, marginVertical: 12 }} onPress={() => play()}><Text style={{ color: colors.onAccent, fontWeight: '600' }}>{t('Play')}</Text></GlassPressable> : null}
        {songs.slice(0, 7).map((song) => <TrackRow key={song.id} song={song} showArtwork onPress={() => play(song.id)} />)}
      </>}</View> : null}
    </View>)}
    <SettingRow label={t('Restore hidden intentions')} onPress={() => void prefs.change((data) => ({ ...data, intent: { ...data.intent, hidden: [] } }))} />
  </DockScrollView></SettingsPage>;
}
