import { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsGroup, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useLyricToolSong } from '@/hooks/useLyricToolSong';
import { useDisplaySong } from '@/hooks/useLocalMetadata';
import { useT } from '@/i18n';
import { METADATA_FIELDS, type MetadataField, type SongMetadataPatch } from '@/lib/localCustomizationModels';
import { captureCustomizationOwner, customizationScope, writeLocalCustomization } from '@/lib/localCustomizations';
import { applySongDisplay, metadataFields, sourceSong } from '@/lib/localMetadata';
import { scopeKey, useLocalMetadata } from '@/store/localMetadata';
import { useToast } from '@/store/toast';
import { fontSize, spacing, themed, useTheme } from '@/theme';

const LABEL: Record<MetadataField, string> = { title: 'Title', artist: 'Artist', album: 'Album', year: 'Year', genre: 'Genre', track: 'Track number', discNumber: 'Disc number' };
const numeric = (field: MetadataField) => ['year', 'track', 'discNumber'].includes(field);
export default function SongMetadataEditor() {
  useTheme(); const t = useT(), { song } = useLyricToolSong(), raw = song ? sourceSong(song) : null;
  const displayed = useDisplaySong(raw), state = useLocalMetadata(), scope = customizationScope();
  const ready = state.ready && state.scope === scopeKey(scope);
  const saved = raw ? state.songs[raw.id] : undefined;
  const [draft, setDraft] = useState<{ song: typeof raw; saved: typeof saved; fields: Partial<Record<MetadataField, string>> }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const defaults = useMemo(() => raw && ready ? Object.fromEntries(METADATA_FIELDS.map((field) => [field, String(saved?.patch[field] ?? raw[field] ?? '')])) : undefined, [raw, ready, saved]);
  const fields = draft?.song === raw && draft.saved === saved ? draft.fields : defaults;
  const patch = useMemo(() => {
    if (!raw || !fields) return undefined;
    const value: SongMetadataPatch = {};
    for (const field of METADATA_FIELDS) {
      const text = fields[field]?.trim() ?? '';
      if (numeric(field)) {
        if (!text && raw[field] === undefined) continue;
        const number = text ? Number(text) : 0;
        if (!Number.isInteger(number) || number < 0 || number > 99999) return undefined;
        if (number !== raw[field]) Object.assign(value, { [field]: number });
      } else if (text !== (raw[field] ?? '')) Object.assign(value, { [field]: text });
    }
    return value;
  }, [fields, raw]);
  const preview = raw && patch ? applySongDisplay(raw, { [raw.id]: { version: 1, original: metadataFields(raw), patch } }, state.aliases) : displayed;
  const save = async (restore = false) => {
    if (!raw || !ready || busy || !restore && !patch) return;
    const current = captureCustomizationOwner(scope); setBusy(true); setError(false);
    try { await writeLocalCustomization(scope, 'song-metadata', raw.id, restore || !Object.keys(patch!).length ? undefined : {
      version: 1, patch, original: metadataFields(raw), ...(raw.albumId ? { albumId: raw.albumId } : {}), ...(raw.artistId ? { artistId: raw.artistId } : {}),
    }, current); if (current()) { await useLocalMetadata.getState().hydrate(scope, true); useToast.getState().show(t(restore ? 'Original metadata restored' : 'Local metadata saved')); } }
    catch { if (current()) setError(true); } finally { if (current()) setBusy(false); }
  };
  return <SettingsPage title={t('Local song corrections')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <Text style={styles.note}>{t('These display corrections stay on this device. Song IDs, audio files, server tags and download identities stay unchanged.')}</Text>
    {raw ? <>
      <SettingsGroup><SettingRow label={t('Original')} description={[raw.title, raw.artist, raw.album].filter(Boolean).join(' · ')} />
        <SettingRow label={t('Preview')} description={[preview?.title, preview?.artist, preview?.album].filter(Boolean).join(' · ')} /></SettingsGroup>
      {METADATA_FIELDS.map((field) => <View key={field} style={styles.field}><Text style={styles.label}>{t(LABEL[field])}</Text>
        <TextInput value={fields?.[field] ?? ''} editable={ready && !busy} keyboardType={numeric(field) ? 'numeric' : 'default'} maxLength={numeric(field) ? 5 : 1024}
          onChangeText={(value) => setDraft({ song: raw, saved, fields: { ...fields, [field]: value } })} style={styles.input} /></View>)}
      <SettingsGroup><SettingRow label={t('Save local corrections')} onPress={ready && !busy && !!patch ? () => { void save(); } : undefined} />
        <SettingRow label={t('Restore original metadata')} onPress={ready && !busy && state.songs[raw.id] ? () => { void save(true); } : undefined} /></SettingsGroup>
      {!patch && fields ? <Text style={styles.note}>{t('Use whole non-negative numbers for year, track and disc.')}</Text> : null}
      {error || state.error ? <SettingRow label={t('Retry')} description={t('Could not save local corrections. Existing values were kept.')} onPress={() => { void state.hydrate(scope, true); }} /> : null}
    </> : <Text style={styles.note}>{t('Choose a song first to use lyrics tools.')}</Text>}
  </DockScrollView></SettingsPage>;
}
const styles = themed((palette) => ({ note: { color: palette.textSecondary, fontSize: fontSize.sm, lineHeight: 21 },
  label: { color: palette.text, fontSize: fontSize.md }, field: { gap: 6, marginVertical: spacing.sm },
  input: { color: palette.text, fontSize: fontSize.md, backgroundColor: palette.surfaceHighlight, borderRadius: 12, padding: 12 } }));
