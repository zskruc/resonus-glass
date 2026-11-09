/** Explicit metadata preview and confirmed restoration. Unknown/ambiguous records remain pending. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { getSong, setRating, star, type Song } from '@/api/data';
import { SettingsPage, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { SheetModal } from '@/components/SheetModal';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { readMusicCatalog } from '@/lib/musicToolsCatalog';
import { matchBackupTracks, type BackupMatch } from '@/lib/personalBackupModels';
import { personalOwner, wholeLibraryReadError } from '@/store/playlistRecovery';
import { deletePendingSongMark, exportPendingSongMarks, usePendingSongMarks, type PendingSongMark } from '@/store/pendingSongMarks';
import { queryClient } from '@/lib/query';
import { colors, themed, useTheme } from '@/theme';
const Rows = Animated.createAnimatedComponent(FlatList<PendingSongMark>);
export default function PendingMarksScreen() {
  useTheme(); const t = useT(), dock = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const [owner] = useState(personalOwner), alive = useRef(true), operation = useRef(0), locked = useRef(false);
  const revision = usePendingSongMarks((state) => state.revision);
  const current = useCallback(() => alive.current && owner.current(), [owner]);
  const [rows, setRows] = useState<PendingSongMark[]>([]), [matches, setMatches] = useState<Record<string, BackupMatch>>({}), [catalog, setCatalog] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [choice, setChoice] = useState<string>(), [query, setQuery] = useState(''), [candidates, setCandidates] = useState<Song[]>([]);
  const picker = useRef<() => void>(() => {});
  useEffect(() => { alive.current = true; const generation = operation; return () => { alive.current = false; generation.current++; }; }, []);
  const reload = useCallback(async () => { const data = await exportPendingSongMarks(owner); if (current()) setRows(data); }, [current, owner]);
  useEffect(() => { void Promise.resolve().then(reload).catch(() => { if (current()) setError(t("Couldn't load pending marks.")); }); }, [reload, revision, current, t]);
  useEffect(() => {
    let active = true; const term = query.trim().toLocaleLowerCase(); if (!term) return;
    const timer = setTimeout(() => { void (async () => {
      const found: Song[] = [];
      for (let i = 0; i < catalog.length; i++) {
        if (!active || !current()) return; const song = catalog[i];
        if (`${song.title} ${song.artist ?? ''} ${song.album ?? ''}`.toLocaleLowerCase().includes(term)) found.push(song);
        if (found.length === 50) break; if (i % 512 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (active && current()) setCandidates(found);
    })(); }, 200); return () => { active = false; clearTimeout(timer); };
  }, [query, catalog, current]);
  async function run(work: (check: () => void) => Promise<void>) {
    if (locked.current || !current()) return; locked.current = true; const ticket = ++operation.current; setBusy(true); setError('');
    const check = () => { owner.check(); if (!alive.current || operation.current !== ticket) throw new Error('Pending marks cancelled'); };
    try { await work(check); } catch { if (current()) setError(t('Restoration was interrupted. Unfinished marks remain pending.')); }
    finally { if (operation.current === ticket) { locked.current = false; if (alive.current) setBusy(false); } }
  }
  async function scan(check: () => void) {
    const restriction = wholeLibraryReadError(); if (restriction) { setError(t(restriction)); return; }
    const library = await readMusicCatalog({ isCurrent: current, onProgress: (count) => { if (current()) setStatus(t('Reading library: {n} songs', { n: count })); } }); check();
    const result = await matchBackupTracks(rows.map((row) => row.track), library.songs, false, current); check();
    // Old IDs may originate on another server. Only a reviewed metadata match is offered.
    setMatches(Object.fromEntries(rows.map((row, index) => [row.key, result[index]]))); setCatalog(library.songs); setStatus(t('Review the suggested matches, then apply. Existing ratings are kept.'));
  }
  const matched = useMemo(() => rows.filter((row) => matches[row.key]?.selected), [rows, matches]);
  async function apply(check: () => void) {
    const restriction = wholeLibraryReadError(); if (restriction) { setError(t(restriction)); return; }
    let done = 0;
    for (const row of matched) {
      check(); const selected = matches[row.key].selected!;
      const song = await getSong(selected.id); check(); if (!song) throw new Error('Song unavailable');
      if (row.marks.favorite && !song.starred) { await star(song.id, 'song'); check(); }
      if (row.marks.rating && !song.userRating) { await setRating(song.id, row.marks.rating); check(); }
      await deletePendingSongMark(row.key, owner); check(); done++;
      setRows((previous) => previous.filter((entry) => entry.key !== row.key)); setStatus(t('Restored {n} pending marks', { n: done }));
    }
    await queryClient.invalidateQueries({ queryKey: ['starred'] }); check(); await reload();
  }
  const selectedChoice = choice ? rows.find((row) => row.key === choice) : undefined;
  return <SettingsPage title={t('Pending favourites and ratings')}><Rows data={owner.current() ? rows : []} keyExtractor={(row) => row.key} onScroll={dock} scrollEventThrottle={16} initialNumToRender={10} windowSize={5}
    contentContainerStyle={[settingsStyles.content, { paddingBottom: bottom }]} keyboardShouldPersistTaps="handled"
    ListHeaderComponent={<>
      <Text style={styles.note}>{t('Unmatched favourites and ratings are kept here even when the song is not in a playlist. Scan a complete library, review the version and confirm before applying. Audio files are never imported.')}</Text>
      <SettingRow label={t('Find matching songs')} onPress={busy || !owner.current() ? undefined : () => void run(scan)} />
      {matched.length ? <SettingRow label={t('Apply selected marks')} right={String(matched.length)} onPress={busy || !owner.current() ? undefined : () => void run(apply)} /> : null}
      {busy ? <ActivityIndicator color={colors.accent} /> : null}
      {status ? <Text style={styles.note}>{status}</Text> : null}{error ? <Text style={styles.error}>{error}</Text> : null}
      {!owner.current() ? <Text style={styles.error}>{t('Library changed. Reopen this page.')}</Text> : null}
    </>}
    ListEmptyComponent={!busy ? <Text style={styles.note}>{t('No pending marks')}</Text> : null}
    renderItem={({ item }) => <Pressable disabled={busy || !catalog.length} style={styles.row} onPress={() => { setChoice(item.key); setQuery(''); setCandidates([]); picker.current(); }}>
      <Text style={styles.title}>{item.track.title}</Text><Text style={styles.note}>{item.track.artist} · {item.track.album}</Text>
      <Text style={styles.note}>{[item.marks.favorite ? t('Favorites') : '', item.marks.rating ? `${t('Rating')}: ${item.marks.rating}` : ''].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.note}>{matches[item.key]?.selected ? `${matches[item.key].selected!.title} · ${matches[item.key].selected!.artist ?? ''}` : t('Choose a match or skip')}</Text>
    </Pressable>} />
    <SheetModal openRef={picker}>{(close) => <View><Text style={styles.title}>{selectedChoice?.track.title}</Text>
      <TextInput value={query} onChangeText={setQuery} placeholder={t('Search this library')} placeholderTextColor={colors.textMuted} style={styles.input} />
      <SettingRow label={t('Keep pending')} onPress={() => { if (choice && current()) setMatches((before) => ({ ...before, [choice]: { ...before[choice], selected: undefined } })); close(); }} />
      <Text style={styles.note}>{t('Showing up to 50 candidates. Refine the search if needed.')}</Text>
      {(query.trim() ? candidates : choice ? matches[choice]?.candidates ?? [] : []).map((song) => <SettingRow key={song.id} label={song.title} description={`${song.artist ?? ''} · ${song.album ?? ''} · ${Math.round(song.duration ?? 0)}s`} onPress={() => { if (choice && current()) setMatches((before) => ({ ...before, [choice]: { ...before[choice], selected: song } })); close(); }} />)}
    </View>}</SheetModal>
  </SettingsPage>;
}
const styles = themed((c) => ({ note: { color: c.textSecondary, fontSize: 13, lineHeight: 20, paddingVertical: 6 }, error: { color: c.danger, paddingVertical: 10 },
  row: { paddingVertical: 12, borderBottomWidth: .5, borderBottomColor: c.border }, title: { color: c.text, fontSize: 16, fontWeight: '600' }, input: { color: c.text, minHeight: 48, paddingHorizontal: 12, backgroundColor: c.surfaceHighlight, borderRadius: 14 } }));
