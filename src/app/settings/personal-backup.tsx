/** Portable personal backup, matching/conflict preview and explicitly applied merge. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput } from 'react-native';
import Animated from 'react-native-reanimated';
import { SettingsPage, SettingRow, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { SheetModal } from '@/components/SheetModal';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { applyPersonalRestore, buildPersonalBackup, pickPersonalBackup, previewPersonalRestore, sharePersonalBackup, type PersonalRestorePreview } from '@/lib/personalBackup';
import { personalOwner, wholeLibraryReadError } from '@/store/playlistRecovery';
import type { Song } from '@/api/subsonic';
import { colors, themed, useTheme } from '@/theme';
const Rows = Animated.createAnimatedComponent(FlatList<number>);
export default function PersonalBackupScreen() {
  useTheme(); const t = useT(), scroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const [owner] = useState(personalOwner), alive = useRef(true), ticket = useRef(0);
  const current = useCallback(() => alive.current && owner.current(), [owner]);
  useEffect(() => { alive.current = true; const generation = ticket; return () => { alive.current = false; generation.current++; }; }, []);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [preview, setPreview] = useState<PersonalRestorePreview>();
  const [appearance, setAppearance] = useState(true), [personal, setPersonal] = useState(true), [local, setLocal] = useState(true), [replace, setReplace] = useState(false);
  const [choice, setChoice] = useState<number | null>(null), [query, setQuery] = useState(''), [results, setResults] = useState<Song[]>([]);
  const picker = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true; const q = query.trim().toLocaleLowerCase();
    if (!q || !preview || choice === null) return;
    const timer = setTimeout(() => { void (async () => {
      const found: Song[] = [];
      for (let i = 0; i < preview.songs.length; i++) {
        if (!active || !current()) return; const s = preview.songs[i];
        if (`${s.title} ${s.artist ?? ''} ${s.album ?? ''}`.toLocaleLowerCase().includes(q)) found.push(s);
        if (found.length === 50) break;
        if (i % 512 === 0) await new Promise<void>((r) => setTimeout(r, 0));
      }
      if (active && current()) setResults(found);
    })(); }, 180); return () => { active = false; clearTimeout(timer); };
  }, [choice, current, preview, query]);
  async function run(action: (id: number) => Promise<void>) {
    if (busy || !current()) return; setBusy(true); setError(''); const id = ++ticket.current;
    try { await action(id); } catch (e) { if (current() && id === ticket.current) { setStatus(''); setError(e instanceof Error && ['Library changed. Reopen this page.', wholeLibraryReadError()].includes(e.message) ? t(e.message) : t("Couldn't complete the action") + ' · ' + t('If interrupted, completed changes remain. Reopen the backup to continue.')); } }
    finally { if (current() && id === ticket.current) setBusy(false); }
  }
  const operationOwner = (id: number) => ({ ...owner, current: () => current() && id === ticket.current,
    check: () => { if (!current() || id !== ticket.current) throw new Error('Library changed. Reopen this page.'); } });
  const updateStatus = (message: string, n: number) => { if (current()) setStatus(`${t(message)}${n ? ` · ${n}` : ''}`); };
  const matched = preview?.tracks.filter((r) => r.selected).length ?? 0;
  const review = useMemo(() => preview ? preview.tracks.map((_, i) => i).filter((i) => !preview.tracks[i].selected) : [], [preview]);
  function selectSong(song?: Song) {
    if (choice === null || !preview || !current()) return;
    const key = JSON.stringify(preview.tracks[choice].track);
    setPreview({ ...preview, tracks: preview.tracks.map((r) => JSON.stringify(r.track) === key ? { ...r, selected: song } : r) });
  }
  const toggle = (label: string, value: boolean, setter: (v: boolean) => void, disabled = false) => <SwitchList options={[{ label: t(label), value, onChange: setter, disabled: busy || disabled }]} />;
  return <SettingsPage title={t('Personal backup and restore')}>
    <Rows data={review} keyExtractor={(i) => String(i)} onScroll={scroll} scrollEventThrottle={16} initialNumToRender={10} windowSize={5}
      contentContainerStyle={[settingsStyles.content, { paddingBottom: bottom }]} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<>
        <Text style={styles.note}>{t('Back up favorites, ratings, your playlists, bookmarks, lyric edits, listening history and appearance. Music files and account passwords are excluded.')}</Text>
        <SettingRow label={t('Export personal backup')} onPress={busy ? undefined : () => void run(async (id) => {
          const file = await buildPersonalBackup(operationOwner(id), updateStatus);
          if (!current()) return; await sharePersonalBackup(file); if (current()) setStatus(t('Backup exported'));
        })} />
        <SettingRow label={t('Choose backup and preview')} onPress={busy ? undefined : () => void run(async (id) => {
          const file = await pickPersonalBackup(); if (!file || !current()) return;
          setPreview(undefined); setStatus(t('Matching library'));
          const result = await previewPersonalRestore(file, operationOwner(id), (n) => updateStatus('Matching library', n));
          if (current()) { setPreview({ ...result, owner }); setLocal(result.sameLibrary); setStatus(''); }
        })} />
        {busy ? <><ActivityIndicator style={{ margin: 12 }} /><SettingRow label={t('Cancel')} onPress={() => { ticket.current++; setBusy(false); setStatus(t('Cancelled. Completed changes remain.')); }} /></> : null}
        {status ? <Text accessibilityLiveRegion="polite" style={styles.note}>{status}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!owner.current() ? <Text style={styles.error}>{t('Library changed. Reopen this page.')}</Text> : null}
        {preview ? <>
          <Text style={styles.title}>{t('Restore preview')}</Text>
          <Text style={styles.note}>{t('{matched} matched, {unmatched} need review', { matched, unmatched: preview.tracks.length - matched })}</Text>
          <Text style={styles.note}>{t('{n} playlists', { n: preview.backup.playlists.length })} · {t('{n} rating conflicts', { n: preview.conflicts })}</Text>
          {preview.albums.some((a) => !a.id) || preview.artists.some((a) => !a.id) ? <Text style={styles.note}>{t('Unmatched album and artist favorites are skipped. Songs can be matched below.')}</Text> : null}
          {!preview.sameLibrary ? <Text style={styles.note}>{t('This is a different library. ID-based local edits, sessions and bookmarks will not be applied. Songs are matched by metadata.')}</Text> : null}
          {toggle('Restore appearance and glass settings', appearance, setAppearance)}
          {toggle('Merge favorites, ratings and new playlists', personal, setPersonal)}
          {toggle('Restore local edits, bookmarks and history', local, setLocal, !preview.sameLibrary)}
          {toggle('Replace conflicting ratings', replace, setReplace)}
          <Text style={styles.note}>{t('Existing playlists stay intact. Missing tracks remain as placeholders in restored playlists; ambiguous versions wait for your choice.')}</Text>
          <SettingRow label={t('Apply restore')} onPress={busy || !owner.current() || !(appearance || personal || local) ? undefined : () => void run(async (id) => {
            const n = await applyPersonalRestore({ ...preview, owner: operationOwner(id) }, { appearance, personal, local, replaceRatings: replace }, (done) => updateStatus('Restoring personal data', done));
            if (current()) setStatus(t('Restore completed: {n} actions', { n }));
          })} />
          {review.length ? <Text style={styles.title}>{t('Tracks needing a match')}</Text> : null}
        </> : null}
      </>}
      renderItem={({ item: i }) => {
        const r = preview!.tracks[i]; return <Pressable disabled={busy} style={styles.row} onPress={() => { setChoice(i); setQuery(''); setResults([]); picker.current(); }}>
          <Text style={styles.text}>{r.track.title}</Text><Text style={styles.note}>{r.track.artist} · {r.track.album}</Text><Text style={styles.note}>{t('Choose a match or skip')}</Text>
        </Pressable>;
      }} />
    <SheetModal openRef={picker}>{(close) => <>
      <Text style={styles.title}>{t('Choose a match or skip')}</Text>
      <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder={t('Search this library')} placeholderTextColor={colors.textMuted} />
      <SettingRow label={t('Keep as missing track')} onPress={() => { selectSong(); close(); }} />
      <Text style={styles.note}>{t('Showing up to 50 candidates. Refine the search if needed.')}</Text>
      {(query.trim() ? results : choice !== null ? preview?.tracks[choice].candidates ?? [] : []).map((song) => <SettingRow key={song.id}
        label={song.title} description={`${song.artist ?? ''} · ${song.album ?? ''} · ${Math.round(song.duration ?? 0)}s`}
        onPress={() => { selectSong(song); close(); }} />)}
    </>}</SheetModal>
  </SettingsPage>;
}
const styles = themed((c) => ({
  note: { color: c.textSecondary, fontSize: 13, lineHeight: 20, paddingVertical: 6 }, text: { color: c.text, fontSize: 15, fontWeight: '500' },
  title: { color: c.text, fontSize: 18, fontWeight: '600', marginTop: 20, marginBottom: 8 }, error: { color: c.danger, paddingVertical: 12 },
  row: { paddingVertical: 10, borderBottomWidth: .5, borderBottomColor: c.border }, input: { color: c.text, minHeight: 48, backgroundColor: c.surfaceHighlight, borderRadius: 12, paddingHorizontal: 12, marginVertical: 10 },
}));
