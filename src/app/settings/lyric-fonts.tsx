import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { DockScrollView } from '@/components/DockScrollView';
import { LyricFontText } from '@/components/LyricsTypography';
import { SelectList, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { captureCustomizationOwner, customizationRevision, customizationScope, readLocalCustomization, subscribeCustomizations, writeLocalCustomization } from '@/lib/localCustomizations';
import { LYRIC_SCRIPTS, type LocalLyricFonts, type LyricFont, type LyricScript } from '@/lib/localCustomizationModels';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, useTheme } from '@/theme';

const LABEL: Record<LyricScript, string> = { chinese: 'Chinese lyric font', latin: 'Latin lyric font', japanese: 'Japanese lyric font', korean: 'Korean lyric font' };
const OPTIONS: { value: LyricFont; label: string }[] = [
  { value: 'inherit', label: 'Follow app font' }, { value: 'sans-serif', label: 'Sans serif' }, { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' }, { value: 'sans-serif-medium', label: 'Medium sans serif' }, { value: 'custom', label: 'Imported app font' },
];
export default function LyricFontsSettings() {
  useTheme(); const t = useT(), router = useRouter(), client = useQueryClient();
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offlineSource); useAuthStore((state) => state.offline);
  const scope = customizationScope(), custom = useSettings((state) => state.customFontFamily);
  const key = useMemo(() => ['localLyricFonts', scope.profile, scope.source], [scope.profile, scope.source]);
  const revision = useSyncExternalStore(subscribeCustomizations, customizationRevision), previous = useRef(revision);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const settings = useQuery({ queryKey: key, queryFn: async () => await readLocalCustomization<LocalLyricFonts>(scope, 'lyric-fonts', 'fonts') ?? null, enabled: scope.profile !== 'default' });
  useEffect(() => { if (revision !== previous.current) { previous.current = revision; void client.invalidateQueries({ queryKey: key, exact: true }); } }, [revision, key, client]);
  const save = async (language?: LyricScript, value?: LyricFont) => {
    if (busy || !settings.isSuccess) return;
    const current = captureCustomizationOwner(scope); setBusy(true); setError(false);
    try { await writeLocalCustomization(scope, 'lyric-fonts', 'fonts', language ? { version: 1, fonts: { ...settings.data?.fonts, [language]: value } } : undefined, current); }
    catch { if (current()) setError(true); } finally { if (current()) setBusy(false); }
  };
  return <SettingsPage title={t('Lyric fonts')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <Text style={{ color: colors.textSecondary, lineHeight: 22 }}>{t('Choose a font for each script. Mixed lines use the whole sentence to distinguish Japanese kanji. Size and weight follow existing lyric settings.')}</Text>
    <Text style={{ color: colors.text, fontSize: 28, marginVertical: spacing.lg }}><LyricFontText text="歌词 Music 日本語 한글" /></Text>
    {LYRIC_SCRIPTS.map((language) => <SelectList<LyricFont> key={language} label={t(LABEL[language])} disabled={busy || !settings.isSuccess}
      value={settings.data?.fonts[language] ?? 'inherit'} onChange={(value) => { void save(language, value); }} options={OPTIONS.filter((option) => option.value !== 'custom' || custom).map((option) => ({ ...option, label: t(option.label) }))} />)}
    <SettingRow label={t('Import app font')} chevron onPress={() => router.push('/settings/font')} />
    <SettingRow label={t('Restore default lyric fonts')} onPress={busy ? undefined : () => { void save(); }} />
    {error || settings.isError ? <SettingRow label={t('Retry')} description={t('Could not save lyric fonts. Previous choices were kept.')} onPress={() => { void settings.refetch(); }} /> : null}
    <Text style={{ color: colors.textSecondary, fontSize: fontSize.sm }}>{t('Apple system fonts are not included. Missing imported fonts fall back to the app font.')}</Text>
  </DockScrollView></SettingsPage>;
}
