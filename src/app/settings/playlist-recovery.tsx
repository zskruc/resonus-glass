/** Inspect missing occurrences and restore selected library matches in their original positions. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getPlaylist, getPlaylistForEditing, insertRecoveredPlaylistTracks, setRating, star } from '@/api/data';
import type { Song } from '@/api/subsonic';
import { SettingsPage, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { SheetModal } from '@/components/SheetModal';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { readMusicCatalog } from '@/lib/musicToolsCatalog';
import { matchBackupTracks, observedRecoveryEntries, type BackupMatch, type RecoveryPlaylist } from '@/lib/personalBackupModels';
import { completeRecoveryInsertion, recoveryInsertionIntent, validateRecoveryInsertion, type RecoveryInsertionIntent } from '@/lib/playlistRecoveryInsert';
import { exportPlaylistRecovery, personalOwner, readRecoveryPlaylist, saveRecoveryPlaylist, wholeLibraryReadError } from '@/store/playlistRecovery';
import { deleteRecoveryJournal, readRecoveryJournal, saveRecoveryJournal } from '@/store/playlistRecoveryJournal';
import { queryClient } from '@/lib/query';
import { colors, themed, useTheme } from '@/theme';
const Rows = Animated.createAnimatedComponent(FlatList<number>);
export default function PlaylistRecoveryScreen() {
  useTheme(); const t = useT(), router = useRouter(), { playlistId } = useLocalSearchParams<{ playlistId?: string }>();
  const scroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const [owner] = useState(personalOwner), alive = useRef(true), ticket = useRef(0);
  const current = useCallback(() => alive.current && owner.current(), [owner]);
  useEffect(() => { alive.current = true; const generation = ticket; return () => { alive.current = false; generation.current++; }; }, []);
  const [lists, setLists] = useState<RecoveryPlaylist[]>([]), [manifest, setManifest] = useState<RecoveryPlaylist>();
  const [pendingIntent, setPendingIntent] = useState<RecoveryInsertionIntent>();
  const [matches, setMatches] = useState<BackupMatch[]>([]), [catalog, setCatalog] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [choice, setChoice] = useState<number | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState<Song[]>([]);
  const picker = useRef<() => void>(() => {});
  const load = useCallback(async () => {
    if (!current()) return;
    if (!playlistId) { const result = await exportPlaylistRecovery(owner); if (current()) setLists(result); return; }
    const savedIntent = await readRecoveryJournal(`insert:${playlistId}`, owner); if (!current()) return;
    const intent = savedIntent ? validateRecoveryInsertion(savedIntent, playlistId) : undefined;
    setPendingIntent(intent);
    const detail = await getPlaylist(playlistId); if (!current()) return;
    const old = await readRecoveryPlaylist(playlistId, owner); if (!current()) return;
    // An interrupted insertion owns its original occurrence keys until the
    // exact before/after sequence is reconciled. Do not observe it as new music.
    if (intent) { setManifest(old ?? intent.manifest); return; }
    const value = { key: old?.key ?? playlistId, playlistId, name: detail.playlist.name, updatedAt: Date.now(), entries: observedRecoveryEntries(old?.entries ?? [], detail.songs) };
    await saveRecoveryPlaylist(value, owner); if (current()) setManifest(value);
  }, [current, owner, playlistId]);
  useEffect(() => { void Promise.resolve().then(load).catch(() => { if (current()) setError(t("Couldn't complete the action")); }); }, [current, load, t]);
  useEffect(() => {
    let active = true; const q = query.trim().toLocaleLowerCase(); if (!q) return;
    const timer = setTimeout(() => { void (async () => {
      const found: Song[] = [];
      for (let i = 0; i < catalog.length; i++) {
        if (!active || !current()) return; const s = catalog[i];
        if (`${s.title} ${s.artist ?? ''} ${s.album ?? ''}`.toLocaleLowerCase().includes(q)) found.push(s);
        if (found.length === 50) break;
        if (i % 512 === 0) await new Promise<void>((r) => setTimeout(r, 0));
      }
      if (active && current()) setSearch(found);
    })(); }, 180); return () => { active = false; clearTimeout(timer); };
  }, [catalog, current, query]);
  async function run(action: () => Promise<void>) {
    if (busy || !current()) return; const id = ++ticket.current; setBusy(true); setError('');
    try { await action(); } catch { if (current() && id === ticket.current) setError(t('Recovery interrupted. Refresh the playlist before trying again; current tracks were not intentionally removed.')); }
    finally { if (current() && id === ticket.current) setBusy(false); }
  }
  async function scan(currentManifest = manifest) {
    if (!currentManifest || !playlistId) return;
    const unavailable = wholeLibraryReadError(); if (unavailable) { setError(t(unavailable)); return; }
    setMessage(t('Matching library'));
    const library = await readMusicCatalog({ isCurrent: current, onProgress: (n) => { if (current()) setMessage(`${t('Matching library')} · ${n}`); } });
    if (!current()) return; const detail = await getPlaylistForEditing(playlistId); if (!current()) return;
    const byId = new Map(library.songs.map((s) => [s.id, s])), inPlaylist = new Set(detail.songs.map((s) => s.id));
    const observed = observedRecoveryEntries(currentManifest.entries, detail.songs);
    // A live song removed from a playlist is intentional, not a missing file.
    const entries = observed.filter((e) => !e.songId || inPlaylist.has(e.songId) || !byId.has(e.songId)).map((e) => e.songId && !byId.has(e.songId) ? { ...e, songId: undefined } : e);
    const value = { ...currentManifest, entries, updatedAt: Date.now() };
    const result = await matchBackupTracks(entries.filter((e) => !e.songId).map((e) => e.track), library.songs, true, current);
    if (!current()) return; await saveRecoveryPlaylist(value, owner); if (!current()) return;
    setManifest(value); setMatches(result); setCatalog(library.songs); setMessage(t('Choose matches, then apply. Current playlist tracks keep their order.'));
  }
  async function apply() {
    if (!manifest || !playlistId) return;
    const key = `insert:${playlistId}`, saved = await readRecoveryJournal(key, owner); if (!current()) return;
    let intent = saved ? validateRecoveryInsertion(saved, playlistId) : undefined;
    if (!intent) {
      const detail = await getPlaylistForEditing(playlistId); if (!current()) return;
      const chosen = new Map(manifest.entries.filter((entry) => !entry.songId).flatMap((entry, i) => matches[i]?.selected ? [[entry.key, matches[i].selected!] as const] : []));
      intent = recoveryInsertionIntent(manifest, detail.songs, chosen); if (!intent) return;
      await saveRecoveryJournal(key, { ...intent }, owner); if (!current()) return;
    }
    setPendingIntent(intent);
    const result = await completeRecoveryInsertion(intent, {
      check: () => { owner.check(); if (!current()) throw new Error('Library changed'); },
      readSongs: async () => (await getPlaylistForEditing(playlistId)).songs,
      insert: (rows, expected) => insertRecoveredPlaylistTracks(playlistId, rows, expected, current),
      persistManifest: (value) => saveRecoveryPlaylist(value, owner),
      restoreMarks: async (song, marks) => {
        if (marks.favorite && !song.starred) { await star(song.id, 'song'); if (!current()) throw new Error('Library changed'); }
        if (marks.rating && !song.userRating) { await setRating(song.id, marks.rating); if (!current()) throw new Error('Library changed'); }
      },
      finish: () => deleteRecoveryJournal(key, owner),
    }); if (!current()) return;
    setPendingIntent(undefined);
    void queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
    void queryClient.invalidateQueries({ queryKey: ['playlists'] }); void queryClient.invalidateQueries({ queryKey: ['starred'] });
    setManifest(result.manifest); setMatches([]); setMessage(t('Missing tracks restored')); await scan(result.manifest);
  }
  const missing = manifest?.entries.filter((e) => !e.songId) ?? [];
  const data = playlistId ? missing.map((_, i) => i) : lists.map((_, i) => i);
  return <SettingsPage title={t('Playlist recovery')}><Rows data={data} keyExtractor={String} onScroll={scroll} scrollEventThrottle={16} initialNumToRender={10} windowSize={5}
    contentContainerStyle={[settingsStyles.content, { paddingBottom: bottom }]} keyboardShouldPersistTaps="handled"
    ListHeaderComponent={<>
      <Text style={styles.note}>{t('Opened playlists keep a local metadata snapshot. After music moves or disappears, scan to find confident matches. Live songs deliberately removed from a playlist are not restored.')}</Text>
      {manifest ? <><Text style={styles.title}>{manifest.name}</Text><Text style={styles.note}>{t('{n} missing tracks', { n: missing.length })}</Text>
        {pendingIntent ? <>
          <Text style={styles.note}>{t('An interrupted recovery is saved. Resume checks the current playlist before inserting anything again.')}</Text>
          <SettingRow label={t('Resume interrupted recovery')} onPress={busy ? undefined : () => void run(apply)} />
          <SettingRow label={t('Discard recovery intent and review again')} description={t('Existing music stays in place. No playlist change is undone.')} onPress={busy ? undefined : () => void run(async () => {
            await deleteRecoveryJournal(`insert:${playlistId}`, owner); if (!current()) return; setPendingIntent(undefined); setMatches([]); await load();
          })} />
        </> : <>
          <SettingRow label={t('Scan library for missing tracks')} onPress={busy ? undefined : () => void run(scan)} />
          {matches.length ? <SettingRow label={t('Restore selected matches in place')} right={String(matches.filter((m) => m.selected).length)} onPress={busy ? undefined : () => void run(apply)} /> : null}
        </>}
      </> : null}
      {busy ? <ActivityIndicator style={{ margin: 12 }} /> : null}
      {message ? <Text style={styles.note}>{message}</Text> : null}{error ? <Text style={styles.error}>{error}</Text> : null}
      {!owner.current() ? <Text style={styles.error}>{t('Library changed. Reopen this page.')}</Text> : null}
    </>}
    renderItem={({ item: i }) => playlistId ? <Pressable disabled={busy || !matches.length} style={styles.row} onPress={() => { setChoice(i); setQuery(''); setSearch([]); picker.current(); }}>
      <Text style={styles.text}>{missing[i].track.title}</Text><Text style={styles.note}>{missing[i].track.artist} · {missing[i].track.album}</Text>
      <Text style={styles.note}>{matches[i]?.selected ? `${matches[i].selected!.title} · ${matches[i].selected!.artist ?? ''}` : t('Choose a match or skip')}</Text>
    </Pressable> : <SettingRow label={lists[i].name} description={t('{n} missing tracks', { n: lists[i].entries.filter((e) => !e.songId).length })}
      onPress={() => router.push({ pathname: '/settings/playlist-recovery', params: { playlistId: lists[i].playlistId } })} />} />
    <SheetModal openRef={picker}>{(close) => <>
      <Text style={styles.title}>{t('Choose a match or skip')}</Text><TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder={t('Search this library')} placeholderTextColor={colors.textMuted} />
      <SettingRow label={t('Keep as missing track')} onPress={() => { if (choice !== null) setMatches((r) => r.map((m, i) => i === choice ? { ...m, selected: undefined } : m)); close(); }} />
      <Text style={styles.note}>{t('Showing up to 50 candidates. Refine the search if needed.')}</Text>
      {(query.trim() ? search : choice !== null ? matches[choice]?.candidates ?? [] : []).map((song) => <SettingRow key={song.id} label={song.title} description={`${song.artist ?? ''} · ${song.album ?? ''} · ${Math.round(song.duration ?? 0)}s`}
        onPress={() => { if (choice !== null && current()) setMatches((r) => r.map((m, i) => i === choice ? { ...m, selected: song } : m)); close(); }} />)}
    </>}</SheetModal>
  </SettingsPage>;
}
const styles = themed((c) => ({
  note: { color: c.textSecondary, fontSize: 13, lineHeight: 20, paddingVertical: 6 }, title: { color: c.text, fontSize: 18, fontWeight: '600', paddingVertical: 12 }, text: { color: c.text, fontSize: 15 },
  error: { color: c.danger, paddingVertical: 10 }, row: { paddingVertical: 10, borderBottomWidth: .5, borderBottomColor: c.border }, input: { color: c.text, minHeight: 48, backgroundColor: c.surfaceHighlight, borderRadius: 12, paddingHorizontal: 12, marginVertical: 10 },
}));
