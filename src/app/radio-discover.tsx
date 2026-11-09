import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Text, TextInput, View, ScrollView } from 'react-native';
import Animated from 'react-native-reanimated';
import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { GlassPressable } from '@/components/glass';
import { Cover } from '@/components/Cover';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/useDebounce';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useDiscoveryPreferences } from '@/store/discoveryPreferences';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { isManualOffline } from '@/api/netGate';
import { readRadioDirectory, RADIO_DIRECTORY_PAGE, RADIO_REGIONS } from '@/lib/radioDirectory';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { colors, radius, spacing } from '@/theme';
import { listPerf } from '@/lib/listPerf';
export default function RadioDiscoverScreen() {
  const prefs = useDiscoveryPreferences(), t = useT(), dock = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const auth = useAuthStore((s) => s.auth); useAuthStore((s) => s.offline); useAuthStore((s) => s.autoOffline);
  const [query, setQuery] = useState(''), [country, setCountry] = useState(''), term = useDebounce(query.trim(), 350);
  const owns = captureLyricOwner(prefs.profile), online = !isManualOffline();
  const result = useInfiniteQuery({ queryKey: ['radioDirectory', country, term], queryFn: ({ pageParam, signal }) => readRadioDirectory({ query: term, country, offset: pageParam, signal }), initialPageParam: 0,
    getNextPageParam: (last, pages) => last.length === RADIO_DIRECTORY_PAGE ? pages.length * RADIO_DIRECTORY_PAGE : undefined,
    enabled: online && query.trim() === term, retry: false, staleTime: 3600000 });
  const rows = query.trim() === term ? [...new Map((result.data?.pages.flat() ?? []).map((row) => [row.id, row])).values()] : [];
  return <SettingsPage title={t('Discover radio')}><View style={{ paddingHorizontal: spacing.lg }}>
    <Text style={settingsStyles.sectionDescription}>{t('Browse Radio Browser. Preview starts only when you tap Listen; Save keeps the station on this phone without requiring server administrator access.')}</Text>
    {prefs.error ? <Text style={settingsStyles.sectionDescription}>{t('Could not save changes. Please try again.')}</Text> : null}
    <TextInput value={query} onChangeText={setQuery} placeholder={t('Search radio stations')} placeholderTextColor={colors.textMuted} style={{ color: colors.text, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surfaceHighlight }} autoCapitalize="none" />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>{RADIO_REGIONS.map((region) => <GlassPressable key={region.code} onPress={() => setCountry(region.code)} style={{ padding: 10, borderRadius: 18, backgroundColor: country === region.code ? colors.surfaceHighlight : 'transparent' }}><Text style={{ color: country === region.code ? colors.accent : colors.textSecondary }}>{t(region.label)}</Text></GlassPressable>)}</ScrollView>
    {!online ? <Text style={settingsStyles.sectionDescription}>{t('Radio discovery needs a connection. Saved local stations remain in Radio.')}</Text> : null}
  </View><Animated.FlatList {...listPerf} data={rows} keyExtractor={(row) => row.id} onScroll={dock} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottom }}
    keyboardShouldPersistTaps="handled" onEndReached={() => { if (online && query.trim() === term && result.hasNextPage && !result.isFetchingNextPage) void result.fetchNextPage(); }}
    renderItem={({ item }) => { const saved = prefs.data.stations.some((row) => row.id === item.id); return <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><Cover uri={online ? item.imageUrl : undefined} size={52} placeholderIcon="radio" /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{item.name}</Text><Text style={{ color: colors.textSecondary, marginTop: 4 }}>{[item.country, item.codec, item.bitrate ? `${item.bitrate} kbps` : ''].filter(Boolean).join(' · ')}</Text></View></View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}><GlassPressable disabled={!online} style={{ padding: 10, borderRadius: 18, backgroundColor: colors.surfaceHighlight }} onPress={() => {
        if (!owns() || profileScopeId() !== prefs.profile || useAuthStore.getState().auth !== auth || isManualOffline()) return;
        usePlayerStore.getState().playQueue([{ id: item.id, title: item.name, url: item.streamUrl, artist: t('Radio'), coverArt: item.imageUrl }], 0, item.name, '/radio');
      }}><Text style={{ color: colors.accent }}>{t('Listen')}</Text></GlassPressable>
      <GlassPressable disabled={saved || !prefs.loaded} style={{ padding: 10, borderRadius: 18, backgroundColor: colors.surfaceHighlight }} onPress={() => { if (owns()) void prefs.change((data) => ({ ...data, stations: data.stations.some((row) => row.id === item.id) ? data.stations : [...data.stations, item] })); }}><Text style={{ color: saved ? colors.textSecondary : colors.accent }}>{t(saved ? 'Saved on this phone' : 'Save on this phone')}</Text></GlassPressable></View>
    </View>; }}
    ListEmptyComponent={result.isFetching ? <ActivityIndicator color={colors.accent} /> : result.isError ? <Message text={t('Could not load the radio directory. Try again.')} onRetry={() => void result.refetch()} /> : <Text style={settingsStyles.sectionDescription}>{t('No stations found')}</Text>}
    ListFooterComponent={result.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : null} />
  </SettingsPage>;
}
