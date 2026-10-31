/** Saved local AND rules; catalogue and results are prepared outside scrolling. */
/* eslint-disable react-hooks/set-state-in-effect -- Source-bound async work must discard stale account/results before it starts. */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { getStarred } from '@/api/data';
import type { Song } from '@/api/subsonic';
import { Dialog } from '@/components/Dialog';
import { GlassPressable, GlassTextInput } from '@/components/glass';
import { SelectList, SettingsGroup, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { TrackRow } from '@/components/TrackRow';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useMusicToolsCatalog } from '@/hooks/useMusicToolsCatalog';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { deleteSmartRule, savedSmartRules, saveSmartRule } from '@/lib/listeningDb';
import { EMPTY_RULE, evaluateSmartRule, normalizeSmartRule, type SmartRule } from '@/lib/smartRules';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { usePlayCounts } from '@/store/playCounts';
import { currentSong, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

const SmartList = Animated.createAnimatedComponent(FlatList<Song>);
const blank = (): SmartRule => ({ ...EMPTY_RULE, id: '', name: '' });

export default function SmartPlaylistsPage() {
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offline);
  return <SmartPlaylistsBody key={profileScopeId()} />;
}

function SmartPlaylistsBody() {
  useTheme();
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const catalog = useMusicToolsCatalog();
  const t = useT(), dockScroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const toast = useToast((state) => state.show);
  const playing = usePlayerStore(currentSong);
  const counts = usePlayCounts((state) => state.counts);
  const [saved, setSaved] = useState<{ profile: string; rules: SmartRule[] }>({ profile: '', rules: [] });
  const [favorite, setFavorite] = useState<{ profile: string; ids: Set<string> }>({ profile: '', ids: new Set() });
  const [draft, setDraft] = useState<SmartRule>(blank);
  const [result, setResult] = useState<{ profile: string; songs: Song[]; draft: SmartRule;
    catalog: typeof catalog.catalog; favorite: typeof favorite; counts: typeof counts }>();
  const [busy, setBusy] = useState(false), [analyzing, setAnalyzing] = useState(false), [remove, setRemove] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const profile = catalog.scope;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setDraft(blank()); setSaved({ profile, rules: [] });
    void savedSmartRules(profile).then((rules) => { if (active && profileScopeId() === profile) setSaved({ profile, rules }); }, () => {
      if (active) toast(t('Could not load smart playlists'));
    });
    return () => { active = false; };
    // Translations do not own account data or reset a form when language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  useEffect(() => {
    let active = true;
    setFavorite({ profile: '', ids: new Set() });
    if (!catalog.catalog) return () => { active = false; };
    void getStarred().then((starred) => {
      if (active && profileScopeId() === profile && useAuthStore.getState().auth === auth) setFavorite({ profile, ids: new Set(starred.songs.map((song) => song.id)) });
    }, () => {});
    return () => { active = false; };
  }, [profile, auth, offline, catalog.catalog]);
  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    const valid = () => active && alive.current && generation.current === token && profileScopeId() === profile;
    const rule = normalizeSmartRule({ ...draft, id: draft.id || 'preview', name: draft.name || 'preview' });
    if (!catalog.catalog || !rule || (rule.favorites && favorite.profile !== profile)) {
      setResult(undefined); setAnalyzing(false); return;
    }
    setAnalyzing(true);
    void evaluateSmartRule(catalog.catalog.songs, rule, { counts: !auth ? counts : undefined,
      favoriteIds: favorite.ids, current: valid }).then((songs) => {
      if (valid()) { setResult({ profile, songs, draft, catalog: catalog.catalog, favorite, counts }); setAnalyzing(false); }
    }, () => { if (valid()) { setResult(undefined); setAnalyzing(false); } });
    return () => { active = false; };
  }, [draft, catalog.catalog, profile, counts, auth, favorite]);
  const rules = saved.profile === profile ? saved.rules : [];
  const songs = result?.profile === profile && catalog.catalog && result.catalog === catalog.catalog
    && result.draft === draft && result.favorite === favorite && result.counts === counts ? result.songs : [];
  const change = <K extends keyof SmartRule>(key: K, value: SmartRule[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const current = () => alive.current && profileScopeId() === profile && useAuthStore.getState().auth === auth;
  async function save() {
    const value = normalizeSmartRule({ ...draft, id: draft.id || `smart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` });
    if (!value) { toast(t('Enter a name and valid year range')); return; }
    if (busy) return;
    setBusy(true);
    try {
      await saveSmartRule(profile, value);
      if (!current()) return;
      setDraft(value); setSaved({ profile, rules: [...rules.filter((rule) => rule.id !== value.id), value] });
      toast(t('Smart playlist saved'));
    } catch { if (current()) toast(t('Could not save smart playlist')); }
    finally { if (alive.current) setBusy(false); }
  }
  async function erase() {
    const previous = rules.find((rule) => rule.id === draft.id);
    setRemove(false);
    if (!previous || busy) return;
    setBusy(true);
    try {
      await deleteSmartRule(profile, previous.id);
      if (!current()) return;
      setSaved({ profile, rules: rules.filter((rule) => rule.id !== previous.id) }); setDraft(blank());
      toast(t('Smart playlist removed'), { label: t('Undo'), run: () => {
        if (!current()) return;
        void saveSmartRule(profile, previous).then(() => {
          if (current()) setSaved((value) => ({ profile, rules: [...value.rules.filter((rule) => rule.id !== previous.id), previous] }));
        }, () => { if (current()) toast(t('Could not save smart playlist')); });
      } });
    } catch { if (current()) toast(t('Could not save smart playlist')); }
    finally { if (alive.current) setBusy(false); }
  }
  return <SettingsPage title={t('Smart playlists')}>
    <SmartList data={songs} keyExtractor={(song) => song.id} onScroll={dockScroll} scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottom }}
      ListHeaderComponent={<>
        <Text style={settingsStyles.sectionDescription}>{t('Rules are combined with AND and saved only for this profile. They do not alter server playlists.')}</Text>
        <SelectList label={t('Saved smart playlists')} value={draft.id} onChange={(id) => setDraft(rules.find((rule) => rule.id === id) ?? blank())}
          options={[{ value: '', label: t('New smart playlist') }, ...rules.map((rule) => ({ value: rule.id, label: rule.name }))]} />
        <Text style={styles.label}>{t('Playlist name')}</Text>
        <GlassTextInput accessibilityLabel={t('Playlist name')} value={draft.name} onChangeText={(value) => change('name', value)} style={styles.input} maxLength={100} />
        <SettingsGroup><SwitchList options={[
          { label: t('Favorites only'), value: draft.favorites, onChange: (value) => change('favorites', value) },
          { label: t('No recorded plays'), value: draft.noPlays, onChange: (value) => change('noPlays', value) },
        ]} /></SettingsGroup>
        <SelectList label={t('Minimum rating')} value={draft.minRating} onChange={(value) => change('minRating', value)}
          options={[{ value: 0, label: t('Any') }, ...[1, 2, 3, 4, 5].map((value) => ({ value, label: `${value} ★` }))]} />
        <View style={styles.years}>
          <View style={styles.year}><Text style={styles.label}>{t('From year')}</Text><GlassTextInput style={styles.input} value={draft.fromYear?.toString() ?? ''} keyboardType="number-pad" maxLength={4}
            onChangeText={(value) => change('fromYear', value ? Number(value.replace(/\D/g, '')) : undefined)} /></View>
          <View style={styles.year}><Text style={styles.label}>{t('Through year')}</Text><GlassTextInput style={styles.input} value={draft.untilYear?.toString() ?? ''} keyboardType="number-pad" maxLength={4}
            onChangeText={(value) => change('untilYear', value ? Number(value.replace(/\D/g, '')) : undefined)} /></View>
        </View>
        <Text style={styles.label}>{t('Genre contains')}</Text><GlassTextInput style={styles.input} value={draft.genre} maxLength={100} onChangeText={(value) => change('genre', value)} />
        <Text style={styles.label}>{t('Artist contains')}</Text><GlassTextInput style={styles.input} value={draft.artist} maxLength={100} onChangeText={(value) => change('artist', value)} />
        <SelectList label={t('Added within')} value={draft.addedDays} onChange={(value) => change('addedDays', value)} options={[
          { value: 0, label: t('Any time') }, { value: 7, label: t('Last 7 days') }, { value: 30, label: t('Last 30 days') }, { value: 90, label: t('Last 90 days') }, { value: 365, label: t('Last 365 days') },
        ]} />
        <SelectList<SmartRule['sort']> label={t('Sort by')} value={draft.sort} onChange={(value) => change('sort', value)} options={[
          { value: 'title', label: t('Title') }, { value: 'newest', label: t('Recently added') }, { value: 'most-played', label: t('Most played') },
        ]} />
        <SelectList label={t('Result limit')} value={draft.limit} onChange={(value) => change('limit', value)} options={[50, 100, 200, 500].map((value) => ({ value, label: String(value) }))} />
        <View style={styles.actions}>
          <GlassPressable buttonMaterial={false} style={styles.button} disabled={busy} onPress={() => { void save(); }}><Text style={styles.action}>{t('Save rule')}</Text></GlassPressable>
          {draft.id ? <GlassPressable buttonMaterial={false} style={styles.button} disabled={busy} onPress={() => setRemove(true)}><Text style={styles.danger}>{t('Delete rule')}</Text></GlassPressable> : null}
          <GlassPressable buttonMaterial={false} style={styles.button} onPress={catalog.refresh}><Text style={styles.action}>{t('Refresh library')}</Text></GlassPressable>
        </View>
        {catalog.loading || analyzing ? <View style={styles.progress}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{t('Reading library: {n} songs', { n: catalog.count })}</Text></View> : null}
        {catalog.error ? <Text style={styles.danger}>{t('Could not read the music catalogue. Try refreshing.')}</Text> : null}
        {draft.favorites && favorite.profile !== profile ? <Text style={styles.muted}>{t('Waiting for favorites')}</Text> : null}
        <Text style={styles.muted}>{catalog.catalog?.offline ? t('Offline rules use the music available in this profile.') : t('Missing year or added-date tags cannot match those filters.')}</Text>
        <Text style={settingsStyles.sectionTitle}>{t('Matching songs: {n}', { n: songs.length })}</Text>
        <View style={styles.actions}>
          <GlassPressable buttonMaterial={false} style={styles.button} disabled={!songs.length || analyzing} onPress={() => { void usePlayerStore.getState().playQueue(songs, 0, draft.name || 'smart-playlist', '/settings/smart-playlists'); }}><Text style={styles.action}>{t('Play')}</Text></GlassPressable>
          <GlassPressable buttonMaterial={false} style={styles.button} disabled={!songs.length || analyzing} onPress={() => { usePlayerStore.getState().queueMany(songs, 'end'); toast(t('Added to queue')); }}><Text style={styles.action}>{t('Add to queue')}</Text></GlassPressable>
        </View>
      </>}
      ListEmptyComponent={!catalog.loading && !analyzing ? <Text style={styles.empty}>{t('No songs match these rules')}</Text> : null}
      renderItem={({ item, index }) => <TrackRow song={item} isCurrent={playing?.id === item.id} onPress={() => { void usePlayerStore.getState().playQueue(songs, index, draft.name || 'smart-playlist', '/settings/smart-playlists'); }} />} />
    <Dialog visible={remove} title={t('Delete rule')} message={draft.name} destructive confirmLabel={t('Delete')} onCancel={() => setRemove(false)} onConfirm={() => { void erase(); }} />
  </SettingsPage>;
}

const styles = themed((theme) => ({
  label: { color: theme.textSecondary, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.md, color: theme.text, backgroundColor: theme.surface, marginBottom: spacing.sm },
  years: { flexDirection: 'row', gap: spacing.md }, year: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm },
  button: { minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center', backgroundColor: theme.surface, borderRadius: radius.pill },
  action: { color: theme.accent, fontWeight: '600' }, danger: { color: theme.danger },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  muted: { color: theme.textSecondary, fontSize: fontSize.xs }, empty: { color: theme.textSecondary, paddingVertical: spacing.lg },
}));
