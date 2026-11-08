/** A song-owned source picker: preview first, then save an offline document. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { getLyricCandidates } from '@/api/lyricSources';
import { GlassPressable } from '@/components/glass';
import { SettingRow, SettingsGroup, SettingsPage } from '@/components/SettingsUI';
import { useLyricToolSong } from '@/hooks/useLyricToolSong';
import { useLyricDisplayMode } from '@/hooks/useLyricDisplay';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { chosenLyricSource, selectLyricCandidate } from '@/lib/lyricLibraryDb';
import { LYRIC_DISPLAY_MODES, lyricCompanions, type LyricCandidate, type LyricCandidateKind, type LyricDisplayMode } from '@/lib/lyricDocuments';
import { queryClient } from '@/lib/query';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLyricDisplay } from '@/store/lyricDisplay';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

const LABELS: Record<LyricCandidateKind, string> = { automatic: 'Cached automatic lyrics', server: 'Server lyrics',
  'sidecar-ttml': 'Local TTML file', 'sidecar-lrc': 'Local LRC file', embedded: 'Embedded lyrics', lrclib: 'LRCLIB' };
const MODES: Record<LyricDisplayMode, string> = { original: 'Original only', translation: 'Original and translation',
  romanization: 'Original and romanization', both: 'Original, translation and romanization' };

export default function LyricSourcesSettings() {
  useTheme();
  const t = useT(), router = useRouter();
  const { song, profile } = useLyricToolSong();
  const offline = useAuthStore((state) => state.offline), automaticOffline = useAuthStore((state) => state.autoOffline);
  const mode = useLyricDisplayMode();
  const ready = useLyricDisplay((state) => state.profile === profile && state.ready);
  const displayError = useLyricDisplay((state) => state.profile === profile && state.error);
  const { data: lyrics } = useLyrics(song ?? undefined);
  const [chosen, setChosen] = useState<string | null>(null), [preview, setPreview] = useState<LyricCandidate | null>(null);
  const [working, setWorking] = useState(false), [error, setError] = useState(false);
  const live = useRef(true), operation = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = useCallback(() => live.current && profileScopeId() === profile, [profile]);
  const candidatesKey = ['lyricCandidates', profile, song?.id];
  const candidates = useQuery({ queryKey: candidatesKey,
    queryFn: ({ signal }) => getLyricCandidates(song!, profile, { signal, current }), enabled: !!song,
    staleTime: Infinity });
  const refetchCandidates = candidates.refetch;
  // The normal lyric hook may finish just after the local picker read. Only
  // re-read when that document changes, not after every candidate-list render.
  useEffect(() => { if (lyrics && song) void refetchCandidates(); }, [lyrics, song, refetchCandidates]);
  useEffect(() => {
    if (!song) return;
    const owns = captureLyricOwner(profile);
    void chosenLyricSource(hashKey(profile), song, () => current() && owns()).then((source) => {
      if (current() && owns()) setChosen(source);
    }).catch(() => { if (current() && owns()) setError(true); });
  }, [song, profile, current]);

  const refresh = async (provider: boolean) => {
    if (!song || working || !current() || (offline && !automaticOffline)) return;
    const token = ++operation.current;
    setWorking(true); setError(false);
    try {
      const values = await getLyricCandidates(song, profile, { server: !provider, provider,
        current: () => current() && token === operation.current });
      if (current() && token === operation.current) queryClient.setQueryData(candidatesKey, values);
    } catch { if (current() && token === operation.current) setError(true); }
    finally { if (current() && token === operation.current) setWorking(false); }
  };
  const choose = async (candidate: LyricCandidate | null) => {
    if (!song || working || !current()) return;
    const token = ++operation.current, owns = captureLyricOwner(profile);
    const valid = () => current() && owns() && operation.current === token;
    setWorking(true); setError(false);
    try {
      await selectLyricCandidate(hashKey(profile), song, candidate, valid);
      if (!valid()) return;
      setChosen(candidate?.id ?? null); setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ['lyrics', song.id] });
      if (valid()) {
        void queryClient.invalidateQueries({ queryKey: ['cachedLyricSearch', profile] });
        useToast.getState().show(t('Lyric source saved for this song'));
      }
    } catch { if (valid()) setError(true); }
    finally { if (valid()) setWorking(false); }
  };
  const saveDisplay = async (next: LyricDisplayMode) => {
    const owns = captureLyricOwner(profile);
    if (!ready || working || !current()) return;
    setWorking(true);
    const saved = await useLyricDisplay.getState().save(profile, next, () => current() && owns());
    if (current() && owns()) { setWorking(false); if (!saved) setError(true); }
  };
  const header = <View style={styles.header}>
    {song ? <>
      <Text style={styles.song}>{song.title}</Text><Text style={styles.note}>{song.artist}</Text>
      <Text style={styles.note}>{t('Preview a source, then use it for this song. Saved choices work offline and do not change lyric files.')}</Text>
      <SettingsGroup>
        <SettingRow label={t('Automatic lyrics')} right={chosen === null ? '✓' : ''}
          description={t('Follow the source preference in Lyrics settings.')} onPress={() => { void choose(null); }} />
        {(candidates.data ?? []).map((candidate) => <SettingRow key={candidate.id}
          label={t(LABELS[candidate.kind])} right={candidate.id === chosen ? '✓' : t('Preview lyrics')}
          description={candidate.label || t(candidate.lyrics.synced ? 'Synchronized lyrics' : 'Plain lyrics')}
          onPress={() => setPreview(candidate)} />)}
      </SettingsGroup>
      {candidates.isFetching || working ? <ActivityIndicator color={colors.text} style={styles.busy} /> : null}
      <SettingsGroup>
        <SettingRow label={t('Refresh local and server sources')} onPress={() => { if (!offline) void refresh(false); else void candidates.refetch(); }} />
        <SettingRow label={t('Find LRCLIB candidates')} description={t('Sends this song’s artist and title to LRCLIB only when you tap.')} onPress={() => { void refresh(true); }} />
      </SettingsGroup>
      {offline && !automaticOffline ? <Text style={styles.note}>{t('Offline: saved and local sources are available. Online lookup is disabled.')}</Text> : null}
      {!candidates.isFetching && !candidates.data?.length ? <Text style={styles.note}>{t('No cached lyric candidates yet. Refresh sources or search LRCLIB.')}</Text> : null}
      <Text style={styles.heading}>{t('Companion lyrics')}</Text>
      <Text style={styles.note}>{t('Show translation and romanization already supplied by the file or server. No automatic translation is performed.')}</Text>
      <SettingsGroup>{LYRIC_DISPLAY_MODES.map((next) => <SettingRow key={next} label={t(MODES[next])} right={mode === next ? '✓' : ''}
        onPress={() => { void saveDisplay(next); }} />)}</SettingsGroup>
      {displayError ? <SettingRow label={t('Retry')} onPress={() => { void useLyricDisplay.getState().hydrate(profile, current); }} /> : null}
      {error || candidates.isError ? <SettingRow label={t('Retry')} description={t('Could not load or save lyric sources. Your previous choice has been kept.')}
        onPress={() => { setError(false); void candidates.refetch(); }} /> : null}
    </> : <Text style={styles.note}>{t('Choose a song first to use lyrics tools.')}</Text>}
  </View>;

  const shownPreview = song ? preview : null;
  return <SettingsPage title={shownPreview ? t('Preview lyrics') : t('Lyric sources')}>
    {shownPreview ? <>
      <View style={styles.previewHeader}>
        <Text style={styles.heading}>{t(LABELS[shownPreview.kind])}</Text>
        {shownPreview.label ? <Text style={styles.note}>{shownPreview.label}</Text> : null}
        <View style={styles.actions}>
          <GlassPressable variant="regular" style={styles.button} disabled={working} onPress={() => setPreview(null)}>
            <Text style={styles.actionText}>{t('Back')}</Text></GlassPressable>
          <GlassPressable variant="prominent" tint={colors.accent} style={styles.button} disabled={working} onPress={() => { void choose(shownPreview); }}>
            <Text style={[styles.actionText, { color: colors.onAccent }]}>{t('Use these lyrics')}</Text></GlassPressable>
        </View>
        {error ? <Text style={styles.note}>{t('Could not load or save lyric sources. Your previous choice has been kept.')}</Text> : null}
      </View>
      <FlatList data={shownPreview.lyrics.lines} keyExtractor={(_, index) => String(index)} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
        contentContainerStyle={styles.preview} renderItem={({ item }) => <View style={styles.previewLine}>
          <Text style={styles.original}>{item.value || '♪'}</Text>
          {lyricCompanions(item, mode).map((value, index) => <Text key={index} style={styles.companion}>{value}</Text>)}
        </View>} />
    </> : <FlatList data={[]} renderItem={() => null} ListHeaderComponent={header} contentContainerStyle={styles.content}
      ListFooterComponent={<GlassPressable variant="subtle" style={styles.button} onPress={() => router.back()}><Text style={styles.actionText}>{t('Done')}</Text></GlassPressable>} />}
  </SettingsPage>;
}

const styles = themed((palette) => ({
  content: { padding: spacing.lg, paddingBottom: 180 }, header: { gap: spacing.sm }, song: { color: palette.text, fontSize: fontSize.lg, fontWeight: '600' },
  heading: { color: palette.text, fontSize: fontSize.md, fontWeight: '600', marginTop: spacing.md },
  note: { color: palette.textSecondary, fontSize: fontSize.sm, lineHeight: 21, marginBottom: spacing.sm },
  busy: { padding: spacing.md }, previewHeader: { padding: spacing.lg }, actions: { flexDirection: 'row', gap: spacing.md },
  button: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: 'center' },
  actionText: { color: palette.text, fontSize: fontSize.md, fontWeight: '600' }, preview: { padding: spacing.lg, paddingBottom: 180 },
  previewLine: { paddingVertical: spacing.sm }, original: { color: palette.text, fontSize: fontSize.lg, lineHeight: 28, fontWeight: '500' },
  companion: { color: palette.textSecondary, fontSize: fontSize.md, lineHeight: 24, marginTop: 3 },
}));
