/** Local radio/podcast folders and many-to-many tags. Batch edits do not touch subscriptions. */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { getRadioStations } from '@/api/backend';
import { listAddedChannels } from '@/api/podcasts';
import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { useDiscoveryPreferences } from '@/store/discoveryPreferences';
import { useAuthStore } from '@/store/auth';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { useT } from '@/i18n';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { colors, spacing } from '@/theme';
import { listPerf } from '@/lib/listPerf';
export default function MediaCollectionsScreen() {
  const { profile } = useDiscoveryPreferences();
  return <MediaCollectionsContent key={profile} />;
}
function MediaCollectionsContent() {
  const { kind: initial } = useLocalSearchParams<{ kind?: string }>(), [kind, setKind] = useState<'radio' | 'podcast'>(initial === 'podcast' ? 'podcast' : 'radio');
  const prefs = useDiscoveryPreferences(), t = useT(), dock = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const auth = useAuthStore((s) => s.auth), offline = useAuthStore((s) => s.offline), owner = captureLyricOwner(prefs.profile);
  const [selection, setSelection] = useState<{ profile: string; ids: string[] }>({ profile: prefs.profile, ids: [] });
  const [name, setName] = useState(''), [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const ids = selection.profile === prefs.profile ? selection.ids : [];
  const shows = useQuery({ queryKey: ['podcastChannels', prefs.profile], queryFn: async () => { const owns = captureLyricOwner(prefs.profile); const values = await listAddedChannels(); if (!owns()) throw new Error('Profile changed'); return values; } });
  const radios = useQuery({ queryKey: ['radioStations', prefs.profile], enabled: !!auth && !offline && auth.serverType !== 'jellyfin', queryFn: async () => { const owns = captureLyricOwner(prefs.profile); const values = await getRadioStations(auth!); if (!owns()) throw new Error('Profile changed'); return values; } });
  const rows = useMemo(() => (kind === 'radio' ? [...prefs.data.stations, ...(radios.data ?? [])].map((row) => ({ id: `radio:${row.id}`, name: row.name })) : (shows.data ?? []).map((row) => ({ id: `podcast:${row.id}`, name: row.title })))
    .filter((row) => row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [kind, prefs.data.stations, radios.data, shows.data, query]);
  const act = (folder: string | null | undefined, tag?: string, remove = false) => {
    if (!owner()) return;
    const selected = ids.filter((id) => rows.some((row) => row.id === id));
    void prefs.change((data) => { const assignments = { ...data.assignments };
      for (const id of selected) { const old = Object.hasOwn(assignments, id) ? assignments[id] : { tags: [] };
        assignments[id] = { folder: folder === undefined ? old.folder : folder ?? undefined, tags: tag ? remove ? old.tags.filter((value) => value !== tag) : [...new Set([...old.tags, tag])] : old.tags }; }
      return { ...data, assignments }; });
  };
  const add = (tag: boolean) => { const value = name.trim().slice(0, 80); if (!value || !owner()) return;
    void prefs.change((data) => tag ? { ...data, tags: [...new Set([...data.tags, value])] } : { ...data, folders: data.folders.some((row) => row.name === value) ? data.folders : [...data.folders, { id: `folder:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, name: value }] }); setName(''); };
  const button = (key: string, label: string, action: () => void, active = false) => <GlassPressable key={key} onPress={action} style={{ padding: 10, borderRadius: 14, backgroundColor: active ? colors.surfaceHighlight : 'transparent' }}><Text style={{ color: active ? colors.accent : colors.text }}>{label}</Text></GlassPressable>;
  return <SettingsPage title={t('Folders and tags')}><View style={{ paddingHorizontal: spacing.lg }}>
    <Text style={settingsStyles.sectionDescription}>{t('Folders and tags are stored for this account on this phone. A show or station can have one folder and several tags. Removing a folder does not unsubscribe or delete anything.')}</Text>
    {prefs.error ? <Text style={settingsStyles.sectionDescription}>{t('Could not save changes. Please try again.')}</Text> : null}
    <View style={{ flexDirection: 'row' }}>{button('radio', t('Radio'), () => { setKind('radio'); setSelection({ profile: prefs.profile, ids: [] }); }, kind === 'radio')}{button('podcast', t('Podcasts'), () => { setKind('podcast'); setSelection({ profile: prefs.profile, ids: [] }); }, kind === 'podcast')}</View>
    <TextInput value={name} onChangeText={setName} placeholder={t('New folder or tag name')} placeholderTextColor={colors.textMuted} style={{ color: colors.text, backgroundColor: colors.surfaceHighlight, borderRadius: 14, padding: 12 }} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{button('newfolder', t('Create folder'), () => add(false))}{button('newtag', t('Create tag'), () => add(true))}{renaming ? button('rename', t('Rename folder'), () => { const value = name.trim().slice(0, 80); if (value && owner()) { void prefs.change((data) => ({ ...data, folders: data.folders.map((folder) => folder.id === renaming ? { ...folder, name: value } : folder) })); setRenaming(undefined); setName(''); } }) : null}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 5 }}>
      {button('none', t('Remove from folder'), () => act(null))}
      {prefs.data.folders.map((folder) => <View key={folder.id} style={{ flexDirection: 'row', alignItems: 'center' }}>{button(folder.id, `${t('Move to')}: ${folder.name}`, () => act(folder.id))}<GlassPressable accessibilityLabel={`${t('Rename folder')}: ${folder.name}`} onPress={() => { setRenaming(folder.id); setName(folder.name); }}><Icon name="create-outline" size={20} color={colors.textMuted} /></GlassPressable><GlassPressable accessibilityLabel={`${t('Delete folder')}: ${folder.name}`} onPress={() => { if (owner()) void prefs.change((data) => ({ ...data, folders: data.folders.filter((row) => row.id !== folder.id), assignments: Object.fromEntries(Object.entries(data.assignments).map(([id, row]) => [id, row.folder === folder.id ? { ...row, folder: undefined } : row])) })); }}><Icon name="close-circle-outline" size={20} color={colors.textMuted} /></GlassPressable></View>)}
    </ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 5 }}>{prefs.data.tags.map((tag) => <View key={tag} style={{ flexDirection: 'row', alignItems: 'center' }}>{button(tag, `+ #${tag}`, () => act(undefined, tag))}{button(`remove:${tag}`, `− #${tag}`, () => act(undefined, tag, true))}<GlassPressable accessibilityLabel={`${t('Delete tag')}: ${tag}`} onPress={() => { if (owner()) void prefs.change((data) => ({ ...data, tags: data.tags.filter((row) => row !== tag), assignments: Object.fromEntries(Object.entries(data.assignments).map(([id, row]) => [id, { ...row, tags: row.tags.filter((value) => value !== tag) }])) })); }}><Icon name="close-circle-outline" size={20} color={colors.textMuted} /></GlassPressable></View>)}</ScrollView>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>{button('all', t('Select all'), () => setSelection({ profile: prefs.profile, ids: rows.map((row) => row.id) }))}{button('clear', t('Clear selection'), () => setSelection({ profile: prefs.profile, ids: [] }))}<Text style={{ color: colors.textSecondary }}>{ids.length}</Text></View>
    <TextInput value={query} onChangeText={setQuery} placeholder={t('Filter list')} placeholderTextColor={colors.textMuted} style={{ color: colors.text, padding: 12 }} />
  </View><Animated.FlatList {...listPerf} data={rows} keyExtractor={(row) => row.id} onScroll={dock} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottom }}
    renderItem={({ item }) => { const assignment = prefs.data.assignments[item.id]; return <GlassPressable onPress={() => { if (owner()) setSelection({ profile: prefs.profile, ids: ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id] }); }} style={{ flexDirection: 'row', paddingVertical: 14, alignItems: 'center', gap: 12 }}><Icon name={ids.includes(item.id) ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={ids.includes(item.id) ? colors.accent : colors.textMuted} /><View style={{ flex: 1 }}><Text style={{ color: colors.text }}>{item.name}</Text><Text style={{ color: colors.textSecondary }}>{[prefs.data.folders.find((row) => row.id === assignment?.folder)?.name, ...(assignment?.tags ?? []).map((tag) => `#${tag}`)].filter(Boolean).join(' · ')}</Text></View></GlassPressable>; }}
    ListEmptyComponent={shows.isLoading || radios.isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={settingsStyles.sectionDescription}>{t('No items to organise')}</Text>} />
  </SettingsPage>;
}
