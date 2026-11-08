/** Browse the directory first; keeping a show is an explicit action on its page. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { directoryCharts, directoryLookup, directorySearch, getStoredChannel, refreshChannel,
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
  const [openingRequest, setOpeningRequest] = useState<{ context: object; id: number; controller: AbortController } | null>(null);
  const operation = useRef(0), previewRequest = useRef<AbortController | null>(null), mounted = useRef(true);
  const finishPreview = useCallback((controller: AbortController | null) => {
    if (!controller || previewRequest.current !== controller) return;
    previewRequest.current = null;
    // Cancellation rejects ownership, but still owns cleanup of this spinner.
    // A late completion must never clear a replacement request's busy state.
    if (mounted.current) setOpeningRequest((before) => before?.controller === controller ? null : before);
  }, []);
  const context = useMemo(() => ({ auth, profile, country, genreId, query, offline, automaticOffline }),
    [auth, profile, country, genreId, query, offline, automaticOffline]);
  const opening = openingRequest?.context === context ? openingRequest.id : null;
  const liveContext = useRef(context);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  useLayoutEffect(() => {
    liveContext.current = context;
    operation.current++;
    previewRequest.current?.abort();
  }, [context]);
  useEffect(() => {
    mounted.current = true;
    // Invalidate even an A → B → A switch between two React renders.
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.auth !== previous.auth || next.offline !== previous.offline || next.autoOffline !== previous.autoOffline) {
        operation.current++;
        const canceled = previewRequest.current; canceled?.abort(); finishPreview(canceled);
      }
    });
    return () => { mounted.current = false; const canceled = previewRequest.current; canceled?.abort(); finishPreview(canceled); unsubscribe(); };
  }, [finishPreview]);
  const directory = useQuery({
    queryKey: ['podcastDirectory', profile, country, genreId ?? 'all', term],
    queryFn: async ({ signal }) => {
      const owns = () => !signal.aborted && profileScopeId() === profile && useAuthStore.getState().auth === auth && !isManualOffline();
      if (!owns()) throw new Error('Podcast directory owner changed');
      const rows = term ? await directorySearch(term, { country, signal }) : await directoryCharts({ country, genreId, signal });
      if (!owns()) throw new Error('Podcast directory owner changed');
      return rows;
    },
    enabled: !manualOffline && query.trim() === term, retry: false, staleTime: 60 * 60 * 1000, gcTime: 60 * 60 * 1000,
  });

  async function preview(show: PodcastDirectoryShow) {
    if (opening !== null || query.trim() !== term || liveContext.current !== context) return;
    const token = ++operation.current, controller = new AbortController();
    previewRequest.current?.abort(); previewRequest.current = controller;
    const current = () => mounted.current && operation.current === token && liveContext.current === context
      && profileScopeId() === profile && useAuthStore.getState().auth === auth && !controller.signal.aborted;
    setOpeningRequest({ context, id: show.id, controller });
    try {
      let feed = show.feedUrl;
      if (!feed) {
        if (isManualOffline()) { toast(t('Not available offline')); return; }
        const detail = await directoryLookup(show.id, { country, signal: controller.signal });
        if (!current()) return;
        feed = detail?.feedUrl;
      }
      if (!feed) { if (current()) toast(t('This podcast has no available RSS feed.')); return; }
      const options = { expectedProfile: profile, signal: controller.signal, current };
      let channel = await getStoredChannel(feed, options);
      if (!current()) return;
      if (!channel) {
        if (isManualOffline()) { toast(t('Not available offline')); return; }
        channel = await refreshChannel(feed, options);
      }
      if (current()) router.push(`/podcast/${channel.id}`);
    } catch {
      if (current()) toast(t("Couldn't preview this podcast. Try again."));
    } finally {
      finishPreview(controller);
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
      contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: bottom, flexGrow: 1 }}
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
        <Cover uri={item.imageUrl} size={62} placeholderIcon="headset-outline" />
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
  heading: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '700' },
  region: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 8 }, regionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.pill, minHeight: 46, marginBottom: spacing.sm }, searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
  chipScroll: { flexGrow: 0, flexShrink: 0 }, chips: { gap: spacing.sm, paddingVertical: spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' }, resultsHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: spacing.md },
  section: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  offline: { width: '100%', color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: .5, borderBottomColor: colors.border },
  rank: { width: 24, textAlign: 'center', color: colors.textSecondary, fontSize: 16, fontWeight: '500' }, details: { flex: 1, gap: 3 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '600' }, subtitle: { color: colors.textSecondary, fontSize: 13 },
  genre: { color: colors.textMuted, fontSize: 12 },
}));
