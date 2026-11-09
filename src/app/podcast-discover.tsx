/** Browse the directory first; keeping a show is an explicit action on its page. */
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { directoryCharts, directorySearch,
  type PodcastDirectoryShow } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame } from '@/components/BrowseFrame';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { PODCAST_DIRECTORY_GENRES } from '@/lib/podcastDirectory';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { beginPodcastPreview, disposePodcastPreview } from '@/lib/podcastPreview';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
import { fontSize, radius, spacing, themed, useTheme } from '@/theme';

const REGIONS = [
  { code: 'us', key: 'United States' }, { code: 'cn', key: 'China' }, { code: 'jp', key: 'Japan' },
  { code: 'gb', key: 'United Kingdom' }, { code: 'ca', key: 'Canada' }, { code: 'au', key: 'Australia' },
  { code: 'de', key: 'Germany' },
] as const;

export default function PodcastDiscoverScreen() {
  const colors = useTheme(), t = useT(), router = useRouter();
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const automaticOffline = useAuthStore((state) => state.autoOffline), profile = profileScopeId();
  const manualOffline = offline && !automaticOffline;
  const toast = useToast((state) => state.show), dock = useLiquidDockScrollHandler();
  const bottom = useScreenBottomPadding(), padding = useListPadding(spacing.lg);
  const [country, setCountry] = useState('us'), [genreId, setGenreId] = useState<number | undefined>();
  const [regionsOpen, setRegionsOpen] = useState(false), [query, setQuery] = useState(''), [term, setTerm] = useState('');
  const [openingRequest, setOpeningRequest] = useState<{ context: object; id: number; token: string } | null>(null);
  const navigation = useRef<typeof openingRequest>(null), focused = useRef(false);
  const context = useMemo(() => ({ auth, profile, country, genreId, query, offline, automaticOffline }),
    [auth, profile, country, genreId, query, offline, automaticOffline]);
  const opening = openingRequest?.context === context ? openingRequest.id : null;
  const liveContext = useRef(context);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    navigation.current = null;
    setOpeningRequest(null);
    return () => { focused.current = false; };
  }, []));
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  useLayoutEffect(() => {
    liveContext.current = context;
  }, [context]);
  const directory = useQuery({
    queryKey: ['podcastDirectory', profile, country, genreId ?? 'all', term],
    queryFn: async ({ signal }) => {
      const captured = captureLyricOwner(profile);
      const owns = () => captured() && !signal.aborted && profileScopeId() === profile && useAuthStore.getState().auth === auth && !isManualOffline();
      if (!owns()) throw new Error('Podcast directory owner changed');
      const rows = term ? await directorySearch(term, { country, signal }) : await directoryCharts({ country, genreId, signal });
      if (!owns()) throw new Error('Podcast directory owner changed');
      return rows;
    },
    enabled: !manualOffline && query.trim() === term, retry: false, staleTime: 60 * 60 * 1000, gcTime: 60 * 60 * 1000,
  });

  function preview(show: PodcastDirectoryShow) {
    if (!focused.current || navigation.current?.context === context || query.trim() !== term || liveContext.current !== context
      || profileScopeId() !== profile || useAuthStore.getState().auth !== auth) return;
    let handle: ReturnType<typeof beginPodcastPreview> | undefined;
    try {
      handle = beginPodcastPreview(show, country);
      const request = { context, id: show.id, token: handle.token };
      navigation.current = request;
      setOpeningRequest(request);
      router.push({ pathname: '/podcast/[id]', params: { id: handle.id, preview: handle.token } });
    } catch {
      if (handle) disposePodcastPreview(handle.token);
      navigation.current = null;
      setOpeningRequest(null);
      toast(t("Couldn't preview this podcast. Try again."));
    }
  }

  const genre = PODCAST_DIRECTORY_GENRES.find((item) => item.id === genreId);
  const debouncing = query.trim() !== term;
  const chip = (key: string, label: string, selected: boolean, onPress: () => void) => <GlassPressable key={key}
    accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={[styles.chip, { backgroundColor: selected ? colors.accent : colors.surfaceHighlight }]}>
    <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.text }]}>{label}</Text>
  </GlassPressable>;
  return <BrowseFrame>
    <View style={[styles.header, { paddingHorizontal: padding }]}>
      <BackChevron /><Text style={styles.heading}>{t('Discover podcasts')}</Text>
      <GlassPressable accessibilityLabel={t('Podcast region')} accessibilityRole="button" accessibilityState={{ expanded: regionsOpen }}
        onPress={() => setRegionsOpen((value) => !value)} style={styles.region}>
        <Icon name="globe-outline" size={20} color={colors.text} /><Text style={styles.regionText}>{country.toUpperCase()}</Text>
      </GlassPressable>
    </View>
    {regionsOpen ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={[styles.chips, { paddingHorizontal: padding }]}>
      {REGIONS.map((region) => chip(region.code, t(region.key), country === region.code, () => { setCountry(region.code); setRegionsOpen(false); }))}
    </ScrollView> : null}
    <View style={[styles.search, { marginHorizontal: padding }]}>
      <Icon name="search" size={20} color={colors.textMuted} />
      <TextInput value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" returnKeyType="search"
        placeholder={t('Search podcasts or paste an Apple Podcasts link')} placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('Search podcasts or paste an Apple Podcasts link')} style={styles.searchInput} />
      {query ? <GlassPressable accessibilityLabel={t('Clear')} hitSlop={10} onPress={() => { setQuery(''); setTerm(''); }}>
        <Icon name="close-circle" size={20} color={colors.textMuted} /></GlassPressable> : null}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={[styles.chips, { paddingHorizontal: padding }]}>
      {chip('all', t('Top podcasts'), genreId === undefined, () => { setGenreId(undefined); setQuery(''); setTerm(''); })}
      {PODCAST_DIRECTORY_GENRES.map((item) => chip(String(item.id), t(item.key), genreId === item.id, () => { setGenreId(item.id); setQuery(''); setTerm(''); }))}
    </ScrollView>
    <Animated.FlatList {...listPerf} onScroll={dock} scrollEventThrottle={16} keyboardShouldPersistTaps="handled"
      data={debouncing ? [] : directory.data ?? []} keyExtractor={(show) => String(show.id)}
      contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: bottom, flexGrow: 1, gap: 10 }}
      ListHeaderComponent={<View style={styles.resultsHeader}>
        <Text style={styles.section}>{term ? t('Search results') : genre ? t(genre.key) : t('Top podcasts')}</Text>
        {directory.isFetching || debouncing ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        {manualOffline ? <Text style={styles.offline}>{t("You're offline")}</Text> : null}
      </View>}
      ListEmptyComponent={debouncing ? null : manualOffline ? <Message text={t('Go online to discover podcasts. Your subscribed shows are still available.')} />
        : directory.isError ? <Message text={t("Couldn't load podcast discovery.")} onRetry={() => { void directory.refetch(); }} />
          : !directory.isPending ? <EmptyState icon="headset-outline" title={t('No podcasts found')} subtitle={t('Try another search or region.')} /> : null}
      renderItem={({ item, index }) => <GlassPressable accessibilityRole="button" accessibilityLabel={t('Preview {name}', { name: item.title })}
        disabled={opening !== null || debouncing} onPress={() => { void preview(item); }} style={({ pressed }) => [styles.row, pressed && { opacity: .6 }]}>
        <Text style={styles.rank}>{item.rank ?? index + 1}</Text>
        <Cover uri={item.imageUrl} size={70} placeholderIcon="headset-outline" />
        <View style={styles.details}><Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
          {item.author ? <Text style={styles.subtitle} numberOfLines={1}>{item.author}</Text> : null}
          {item.genre ? <Text style={styles.genre} numberOfLines={1}>{t(item.genre)}</Text> : null}
        </View>
        {opening === item.id ? <ActivityIndicator color={colors.accent} /> : <Icon name="chevron-forward" size={19} color={colors.textMuted} />}
      </GlassPressable>} />
  </BrowseFrame>;
}

const styles = themed((colors) => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  heading: { flex: 1, color: colors.text, fontSize: 25, fontWeight: '700' },
  region: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 10, borderRadius: 20, backgroundColor: colors.surfaceHighlight }, regionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.pill, minHeight: 46, marginBottom: spacing.sm }, searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
  chipScroll: { flexGrow: 0, flexShrink: 0 }, chips: { gap: spacing.sm, paddingVertical: spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' }, resultsHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: spacing.md },
  section: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  offline: { width: '100%', color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: colors.surfaceHighlight },
  rank: { width: 24, textAlign: 'center', color: colors.textSecondary, fontSize: 16, fontWeight: '500' }, details: { flex: 1, gap: 3 },
  rowTitle: { color: colors.text, fontSize: 17, fontWeight: '600' }, subtitle: { color: colors.textSecondary, fontSize: 13 },
  genre: { color: colors.textMuted, fontSize: 12 },
}));
