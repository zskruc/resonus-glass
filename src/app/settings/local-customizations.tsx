import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsGroup, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { captureCustomizationOwner, customizationScope, writeLocalCustomization } from '@/lib/localCustomizations';
import { aliasImpactPreview, validateAliasOverlap } from '@/lib/localMetadata';
import { queryClient } from '@/lib/query';
import { scopeKey, useLocalMetadata } from '@/store/localMetadata';
import { useLyricToolTarget } from '@/store/lyricToolTarget';
import { currentSong, usePlayerStore } from '@/store/player';
import { fontSize, spacing, themed, useTheme } from '@/theme';

export default function LocalCustomizations() {
  useTheme(); const t = useT(), router = useRouter(), params = useLocalSearchParams<{ artistId?: string; artistName?: string }>();
  const scope = customizationScope(), state = useLocalMetadata(), ready = state.ready && state.scope === scopeKey(scope);
  const [artistId, setArtistId] = useState(params.artistId ?? ''), [canonical, setCanonical] = useState(params.artistName ?? ''), [aliases, setAliases] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [impact, setImpact] = useState<ReturnType<typeof aliasImpactPreview>>();
  const hydrate = state.hydrate, profile = scope.profile, sourceKey = scope.source;
  useEffect(() => { void hydrate({ profile, source: sourceKey }); }, [profile, sourceKey, hydrate]);
  const saved = state.aliases.find((entry) => entry.artistId === artistId);
  const saveAlias = async (restore = false) => {
    if (!ready || busy || !artistId.trim() || !restore && !canonical.trim()) return;
    const current = captureCustomizationOwner(scope); setBusy(true); setError('');
    try {
      const entry = { version: 1 as const, artistId: artistId.trim(), canonical: canonical.trim(), aliases: [...new Set(aliases.split('\n').map((value) => value.trim()).filter(Boolean))] };
      if (!restore) validateAliasOverlap(state.aliases, entry);
      await writeLocalCustomization(scope, 'artist-alias', entry.artistId, restore ? undefined : entry, current);
      if (current()) { await state.hydrate(scope, true); if (restore) { setCanonical(''); setAliases(''); } }
    } catch { if (current()) setError(t('Could not save aliases. Check exact names and avoid aliases already assigned to another artist.')); }
    finally { if (current()) setBusy(false); }
  };
  const pick = (id: string) => { const entry = state.aliases.find((item) => item.artistId === id); if (entry) { setArtistId(id); setCanonical(entry.canonical); setAliases(entry.aliases.join('\n')); } };
  return <SettingsPage title={t('Local corrections')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <SettingsGroup><SettingRow label={t('Correct current song metadata')} chevron onPress={() => { const song = currentSong(usePlayerStore.getState()); if (song) { useLyricToolTarget.getState().open(song); router.push('/song-metadata'); } }} />
      <SettingRow label={t('Lyric fonts')} chevron onPress={() => router.push('/settings/lyric-fonts')} /></SettingsGroup>
    <Text style={styles.heading}>{t('Exact artist aliases')}</Text>
    <Text style={styles.note}>{t('Map explicitly entered full names to one display name. This never merges artist IDs, moves music or matches similar names automatically.')}</Text>
    <Text style={styles.label}>{t('Artist ID')}</Text><TextInput value={artistId} onChangeText={setArtistId} style={styles.input} maxLength={1024} editable={!busy} />
    <Text style={styles.label}>{t('Canonical display name')}</Text><TextInput value={canonical} onChangeText={setCanonical} style={styles.input} maxLength={1024} editable={!busy} />
    <Text style={styles.label}>{t('Exact aliases, one full name per line')}</Text><TextInput value={aliases} onChangeText={setAliases} style={[styles.input, { minHeight: 100 }]} multiline maxLength={20000} editable={!busy} />
    <SettingsGroup><SettingRow label={t('Alias preview')} description={canonical.trim() ? `${[artistId, ...aliases.split('\n').filter(Boolean)].join(' / ')} → ${canonical.trim()}` : t('Enter a display name to preview.')} />
      <SettingRow label={t('Apply exact aliases')} onPress={ready && !busy ? () => { void saveAlias(); } : undefined} />
      <SettingRow label={t('Undo this alias mapping')} onPress={ready && !busy && saved ? () => { void saveAlias(true); } : undefined} /></SettingsGroup>
    <SettingRow label={t('Preview affected loaded items')} onPress={() => {
      const candidate = { version: 1 as const, artistId: artistId.trim(), canonical: canonical.trim(), aliases: aliases.split('\n').map((value) => value.trim()).filter(Boolean) };
      function* loaded() { for (const query of queryClient.getQueryCache().getAll()) yield query.state.data; }
      setImpact(aliasImpactPreview(loaded(), candidate));
    }} />
    {impact ? <View><Text style={styles.note}>{t('Preview uses already loaded items only. No full-library scan is started.')}</Text>
      {impact.samples.length ? impact.samples.map((value) => <Text style={styles.label} key={value}>{value}</Text>) : <Text style={styles.note}>{t('No matching loaded items.')}</Text>}</View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Text style={styles.heading}>{t('Saved alias mappings')}</Text>
    <SettingsGroup>{state.aliases.slice(0, 200).map((entry) => <SettingRow key={entry.artistId} label={entry.canonical} description={entry.aliases.join(' / ') || entry.artistId} onPress={() => pick(entry.artistId)} />)}</SettingsGroup>
    <Text style={styles.heading}>{t('Corrected songs')}</Text>
    <SettingsGroup>{Object.entries(state.songs).slice(0, 200).map(([id, value]) => <SettingRow key={id} label={value.patch.title ?? value.original.title ?? id}
      description={t('Local display correction')} onPress={() => { useLyricToolTarget.getState().open({ id, title: value.original.title ?? id, ...value.original, albumId: value.albumId, artistId: value.artistId }); router.push('/song-metadata'); }} />)}</SettingsGroup>
    {state.error ? <SettingRow label={t('Retry')} onPress={() => { void state.hydrate(scope, true); }} /> : null}
  </DockScrollView></SettingsPage>;
}
const styles = themed((palette) => ({ heading: { color: palette.text, fontSize: fontSize.md, fontWeight: '600', marginTop: spacing.lg },
  label: { color: palette.text, fontSize: fontSize.sm }, note: { color: palette.textSecondary, fontSize: fontSize.sm, lineHeight: 21 },
  input: { color: palette.text, backgroundColor: palette.surfaceHighlight, fontSize: fontSize.md, padding: 12, borderRadius: 12 }, error: { color: palette.accent, fontSize: fontSize.sm } }));
