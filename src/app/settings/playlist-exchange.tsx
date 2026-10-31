/** Preview and resolve external playlists before creating a separate new list. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { createPlaylistFromSongs, getPlaylist } from '@/api/data';
import type { Song } from '@/api/subsonic';
import { SettingsPage, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { SheetModal } from '@/components/SheetModal';
import { useT } from '@/i18n';
import { readMusicCatalog, type MusicCatalog } from '@/lib/musicToolsCatalog';
import { matchPlaylistAsync, parsePlaylistFile, playlistJson, playlistM3u, unmatchedReport, type PlaylistMatch } from '@/lib/playlistExchange';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLibraries } from '@/store/libraries';
import { useToast } from '@/store/toast';
import { fontSize, spacing, themed, useTheme } from '@/theme';

const MatchList = Animated.createAnimatedComponent(FlatList<PlaylistMatch>);

export default function PlaylistExchangeScreen() {
  const t = useT(); useTheme();
  const router = useRouter();
  const dockScroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding();
  const { playlistId } = useLocalSearchParams<{ playlistId?: string }>();
  const auth = useAuthStore((s) => s.auth), offline = useAuthStore((s) => s.offline);
  const source = useAuthStore((s) => s.offlineSource), hydrating = useAuthStore((s) => s.hydrating);
  const folders = useLibraries((s) => s.disabled);
  const [owner] = useState(() => ({ auth, offline, source, folders, scope: profileScopeId() }));
  const alive = useRef(true), generation = useRef(0);
  const valid = useCallback(() => alive.current && owner.auth === useAuthStore.getState().auth
    && !useAuthStore.getState().hydrating && owner.offline === useAuthStore.getState().offline
    && owner.source === useAuthStore.getState().offlineSource && owner.folders === useLibraries.getState().disabled && owner.scope === profileScopeId(), [owner]);
  useEffect(() => {
    alive.current = true;
    const token = generation;
    return () => { alive.current = false; token.current++; };
  }, []);
  const [catalog, setCatalog] = useState<MusicCatalog | null>(null);
  const [matches, setMatches] = useState<PlaylistMatch[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [choice, setChoice] = useState<number | null>(null), [query, setQuery] = useState('');
  const picker = useRef<() => void>(() => {});
  const matched = matches.filter((match) => match.selected).length;
  const toast = useToast((s) => s.show);
  const changed = auth !== owner.auth || offline !== owner.offline || source !== owner.source
    || folders !== owner.folders || hydrating || profileScopeId() !== owner.scope;
  const [search, setSearch] = useState<{ query: string; choice: number; catalog: MusicCatalog; songs: Song[] }>();
  useEffect(() => {
    const text = query.trim().toLocaleLowerCase();
    if (!text || choice === null || !catalog || !valid()) return;
    let active = true;
    // Do not block a frame on a 250k-song catalogue for every key press.
    const timer = setTimeout(() => { void (async () => {
      const songs: Song[] = [];
      for (let index = 0; index < catalog.songs.length; index++) {
        if (!active || !valid()) return;
        const song = catalog.songs[index];
        if (`${song.title} ${song.artist ?? ''} ${song.album ?? ''}`.toLocaleLowerCase().includes(text)) songs.push(song);
        if (songs.length >= 50) break;
        if ((index + 1) % 1000 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (active && valid()) setSearch({ query: text, choice, catalog, songs });
    })(); }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [catalog, choice, query, valid]);
  const candidates = choice === null ? [] : !query.trim() ? matches[choice]?.candidates ?? []
    : search?.choice === choice && search.catalog === catalog && search.query === query.trim().toLocaleLowerCase() ? search.songs : [];
  async function share(text: string, extension: string, mime: string) {
    if (!valid()) return;
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable');
    if (!valid()) return;
    const directory = new Directory(Paths.cache, 'playlist-exchange');
    directory.create({ intermediates: true, idempotent: true });
    // A receiving app can read after Android's chooser has already returned.
    // Retain new exports; prune only this feature's old cache files next time.
    for (const old of directory.list()) {
      if (old instanceof File && old.modificationTime && Date.now() - old.modificationTime > 86400000) old.delete();
    }
    const file = new File(directory, `resonus-playlist-${Date.now()}.${extension}`);
    file.create({ overwrite: true }); file.write(text);
    if (valid()) await Sharing.shareAsync(file.uri, { mimeType: mime });
  }
  async function chooseFile() {
    if (busy || !valid()) return;
    const ticket = ++generation.current;
    setMessage(''); setBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0] || !valid() || ticket !== generation.current) return;
      const asset = picked.assets[0];
      if ((asset.size ?? 0) > 5_000_000) throw new Error('Playlist file is too large');
      setBusy(true); setProgress(0);
      const file = new File(asset.uri);
      if (file.size > 5_000_000) throw new Error('Playlist file is too large');
      const parsed = parsePlaylistFile(await file.text(), asset.name);
      const library = await readMusicCatalog({ isCurrent: () => valid() && ticket === generation.current,
        onProgress: (count) => { if (valid() && ticket === generation.current) setProgress(count); } });
      if (!valid() || ticket !== generation.current) return;
      const result = await matchPlaylistAsync(parsed, library.songs, {
        isCurrent: () => valid() && ticket === generation.current,
      });
      if (!valid() || ticket !== generation.current) return;
      setCatalog(library); setName(parsed.name); setMatches(result);
    } catch (error) {
      if (valid() && ticket === generation.current) {
        const reason = error instanceof Error ? error.message : '';
        setMessage(reason === 'Playlist file is too large' ? t('Playlist file is too large')
          : reason === 'Playlist has too many tracks' ? t('Playlist has too many tracks')
          : reason === 'Playlist contains no valid tracks' ? t('Playlist contains no valid tracks')
          : reason === 'Unsupported playlist file' ? t('Unsupported playlist file') : t("Couldn't complete the action"));
      }
    }
    finally { if (valid() && ticket === generation.current) setBusy(false); }
  }
  async function exportFile(format: 'json' | 'm3u8') {
    if (!playlistId || busy || !valid()) return;
    setBusy(true); setMessage('');
    try {
      const result = await getPlaylist(playlistId);
      if (!valid()) return;
      await share(format === 'json' ? playlistJson(result.playlist.name, result.songs) : playlistM3u(result.playlist.name, result.songs),
        format, format === 'json' ? 'application/json' : 'audio/x-mpegurl');
    } catch { if (valid()) setMessage(t("Couldn't complete the action")); }
    finally { if (valid()) setBusy(false); }
  }
  async function importNew() {
    if (busy || !valid() || !name.trim() || !matched) return;
    setBusy(true); setMessage('');
    try {
      const selected = matches.flatMap((match) => match.selected ? [match.selected] : []);
      const id = await createPlaylistFromSongs(name, selected);
      if (!valid()) return;
      toast(t('Playlist imported'));
      router.replace(`/playlist/${encodeURIComponent(id)}`);
    } catch { if (valid()) setMessage(t('Import failed. A new empty or partial playlist may remain; existing playlists were not replaced.')); }
    finally { if (valid()) setBusy(false); }
  }
  return <SettingsPage title={t('Playlist import and export')}>
    {changed ? <Text style={styles.notice}>{t('Library changed. Reopen this page.')}</Text> : <MatchList
      data={matches} keyExtractor={(_, index) => String(index)} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={5}
      onScroll={dockScroll} scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled" contentContainerStyle={[settingsStyles.content, { paddingBottom: bottom }]}
      ListHeaderComponent={<>
        <Text style={styles.notice}>{t('Import matches music in this library; it never downloads links or replaces an existing playlist.')}</Text>
        {playlistId ? <>
          <SettingRow label={t('Export JSON playlist')} description={t('Portable song metadata without account credentials.')} onPress={busy ? undefined : () => void exportFile('json')} />
          <SettingRow label={t('Export M3U8 playlist')} description={t('Relative music paths, without authenticated stream links.')} onPress={busy ? undefined : () => void exportFile('m3u8')} />
        </> : null}
        <SettingRow label={t('Choose playlist file')} description={t('M3U, M3U8 or Resonus JSON; up to 10,000 tracks.')} onPress={busy ? undefined : () => void chooseFile()} />
        {busy ? <View style={styles.status}><ActivityIndicator /><Text style={styles.text}>{t('Working…')} {progress || ''}</Text></View> : null}
        {message ? <Text style={styles.error}>{message}</Text> : null}
        {matches.length ? <>
          <TextInput accessibilityLabel={t('Playlist name')} value={name} onChangeText={setName} editable={!busy} style={styles.input} placeholder={t('Playlist name')} placeholderTextColor={styles.muted.color} />
          <Text style={styles.notice}>{t('{matched} matched, {unmatched} need review', { matched, unmatched: matches.length - matched })}</Text>
          <SettingRow label={t('Import matched tracks into a new playlist')} right={String(matched)} onPress={!busy && matched ? () => void importNew() : undefined} />
          {matched < matches.length ? <SettingRow label={t('Save unmatched tracks')} onPress={busy ? undefined : () => void share(unmatchedReport(matches), 'json', 'application/json').catch(() => setMessage(t("Couldn't complete the action")))} /> : null}
        </> : null}
      </>}
      renderItem={({ item, index }) => <Pressable disabled={busy} style={styles.row} onPress={() => { setChoice(index); setQuery(''); picker.current(); }}>
        <View style={{ flex: 1 }}><Text style={styles.text}>{index + 1}. {item.track.title}</Text><Text style={styles.muted}>{item.track.artist}</Text>
          <Text style={item.selected ? styles.matched : styles.muted}>{item.selected ? `${item.selected.title} · ${item.selected.artist ?? ''}` : t('Choose a match or skip')}</Text></View>
      </Pressable>} />}
    <SheetModal openRef={picker}>{(close) => <>
      <Text style={styles.text}>{t('Choose a match or skip')}</Text>
      <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder={t('Search this library')} placeholderTextColor={styles.muted.color} />
      <Text style={styles.notice}>{t('Showing up to 50 candidates. Refine the search if needed.')}</Text>
      <SettingRow label={t('Skip this track')} onPress={() => { if (choice !== null && valid()) setMatches((rows) => rows.map((row, index) => index === choice ? { ...row, selected: undefined } : row)); close(); }} />
      {candidates.map((song) => <SettingRow key={song.id} label={song.title} description={`${song.artist ?? ''} · ${song.album ?? ''} · ${Math.round(song.duration ?? 0)}s`}
        onPress={() => { if (choice !== null && valid()) setMatches((rows) => rows.map((row, index) => index === choice ? { ...row, selected: song } : row)); close(); }} />)}
    </>}</SheetModal>
  </SettingsPage>;
}
const styles = themed((c) => ({
  notice: { color: c.textSecondary, fontSize: fontSize.sm, lineHeight: 21, paddingVertical: 12 },
  text: { color: c.text, fontSize: fontSize.sm, lineHeight: 22 }, muted: { color: c.textMuted, fontSize: fontSize.xs, lineHeight: 19 },
  matched: { color: c.accent, fontSize: fontSize.xs, lineHeight: 19 }, error: { color: c.danger, paddingVertical: 12 },
  input: { minHeight: 48, color: c.text, backgroundColor: c.surfaceHighlight, borderRadius: 12, paddingHorizontal: 12, marginVertical: 8 },
  row: { minHeight: 64, paddingVertical: 10, borderBottomWidth: .5, borderBottomColor: c.border },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
}));
