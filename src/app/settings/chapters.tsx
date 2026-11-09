import { useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getSong, type Song } from '@/api/data';
import { SettingsPage, SettingsGroup, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { useListeningToolsSource } from '@/hooks/useListeningTools';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { chapterAt, CHAPTER_IMPORT_MAX_BYTES, parseLocalChapters } from '@/lib/localChapters';
import type { LocalChapter } from '@/lib/listeningTools';
import { formatDuration } from '@/lib/format';
import { hashKey } from '@/lib/localLibrary';
import * as PodcastDb from '@/lib/podcastDb';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { mutateListeningSource } from '@/store/listeningTools';
import { cancelChapterStop, currentSong, stopAfterChapter, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, spacing, useTheme } from '@/theme';

interface Preview { songId: string; chapters: LocalChapter[]; current: () => boolean }
export default function ChaptersScreen() {
  useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>(), playing = usePlayerStore(currentSong), t = useT();
  const stop = usePlayerStore((state) => state.chapterStop), liveDuration = usePlayerStore((state) => state.durationSec);
  useAuthStore((state) => state.auth); const profile = profileScopeId(), target = id ?? playing?.id;
  const { source, pending, error } = useListeningToolsSource();
  const { data, isPending: songPending } = useQuery({ queryKey: ['chapterTarget', profile, target], enabled: !!target,
    queryFn: async () => {
      const owns = captureLyricOwner(profile), check = () => { if (!owns()) throw new Error('Profile changed'); };
      let song: Song | undefined = playing?.id === target ? playing ?? undefined : undefined;
      const episode = await PodcastDb.getEpisode(hashKey(profile), target!); check();
      if (!song && episode) { const channel = await PodcastDb.getChannel(hashKey(profile), episode.channelId); check();
        if (channel) { const { episodeToSong } = await import('@/api/podcasts'); check(); song = episodeToSong(episode, channel); } }
      if (!song) { song = await getSong(target!); check(); }
      const chapters: LocalChapter[] = episode?.chapters?.map((chapter) => ({ title: chapter.title, start: chapter.startSec,
        ...(chapter.endSec !== undefined ? { end: chapter.endSec } : {}) })) ?? [];
      return { song, chapters };
    } });
  const song = target === playing?.id ? playing : data?.song;
  const duration = target === playing?.id ? liveDuration || song?.duration : song?.duration;
  const override = target ? source?.chapters[target] : undefined, chapters = override?.chapters ?? data?.chapters ?? [];
  const [preview, setPreview] = useState<Preview>(), [busy, setBusy] = useState(false), active = useRef(false), toast = useToast((state) => state.show);
  const shownPreview = preview && preview.songId === target && preview.current() ? preview : undefined;
  const rows = shownPreview?.chapters ?? chapters;
  const activeChapter = usePlayerStore((state) => currentSong(state)?.id === target ? chapterAt(chapters, state.positionSec) : -1);
  const viewOwns = captureLyricOwner(profile);
  async function selectFile() {
    if (!song || active.current || !viewOwns()) return; active.current = true; setBusy(true);
    const owns = captureLyricOwner(profile), songId = song.id; let picked: string | undefined;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
      if (result.canceled || !owns()) return;
      const asset = result.assets[0]; picked = asset.uri;
      if (!/\.(json|txt)$/i.test(asset.name)) throw new Error('Use TXT or JSON');
      const stat = await FileSystem.getInfoAsync(asset.uri); if (!owns()) return;
      if (!stat.exists || stat.isDirectory || stat.size > CHAPTER_IMPORT_MAX_BYTES) throw new Error('Chapter file is too large');
      const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 }); if (!owns()) return;
      setPreview({ songId, chapters: parseLocalChapters(content, duration && duration > 0 ? duration : undefined), current: owns });
    } catch { if (owns()) toast(t('Invalid chapter file. Use increasing timestamps and non-overlapping chapters.')); }
    finally { if (picked && FileSystem.cacheDirectory && picked.startsWith(FileSystem.cacheDirectory)) await FileSystem.deleteAsync(picked, { idempotent: true }).catch(() => {});
      active.current = false; setBusy(false); }
  }
  async function apply() {
    if (!song || !shownPreview || active.current || !shownPreview.current()) return;
    active.current = true; setBusy(true);
    try {
      const saved = await mutateListeningSource((value) => ({ ...value, chapters: { ...value.chapters, [song.id]: { songId: song.id, title: song.title,
        ...(duration && duration > 0 ? { duration } : {}), chapters: shownPreview.chapters } } }));
      if (saved && shownPreview.current()) { setPreview(undefined); toast(t('Saved')); }
    } catch { toast(t("Couldn't save listening settings.")); } finally { active.current = false; setBusy(false); }
  }
  const header = <View style={{ gap: spacing.md }}>
    <Text style={settingsStyles.groupTitle}>{song?.title ?? t('Play a track or select a song to manage chapters.')}</Text>
    {(pending || !!target && songPending) && !error ? <ActivityIndicator color={colors.accent} /> : null}
    <SettingsGroup>
      <SettingRow label={t('Import TXT / JSON chapters')} description={t('TXT example: 00:00 Introduction. JSON uses title, start and optional end. Maximum 1 MiB.')}
        onPress={song && !busy && !pending ? () => void selectFile() : undefined} />
      {override ? <SettingRow label={t('Restore publisher chapters')} onPress={busy ? undefined : () => {
        if (active.current || !target) return; active.current = true; setBusy(true); const owns = captureLyricOwner();
        void mutateListeningSource((value) => { const next = { ...value.chapters }; delete next[target]; return { ...value, chapters: next }; })
          .then((saved) => { if (saved && owns()) { setPreview(undefined); if (currentSong(usePlayerStore.getState())?.id === target) cancelChapterStop(); } })
          .catch(() => toast(t("Couldn't save listening settings."))).finally(() => { active.current = false; setBusy(false); }); }} /> : null}
    </SettingsGroup>
    {shownPreview ? <SettingsGroup><SettingRow label={t('Apply chapter import')} right={String(rows.length)} onPress={busy ? undefined : () => void apply()} />
      <SettingRow label={t('Cancel')} onPress={() => setPreview(undefined)} /></SettingsGroup> : null}
    {stop ? <SettingsGroup><SettingRow label={t('Stop after chapter')} description={stop.title} right={t('Cancel')} onPress={cancelChapterStop} /></SettingsGroup> : null}
    {!shownPreview && song?.id === playing?.id && chapters.length ? <SettingsGroup><SettingRow label={t('Stop after current chapter')}
      onPress={() => { const index = chapterAt(chapters, usePlayerStore.getState().positionSec);
        if (!viewOwns() || index < 0 || !song || !stopAfterChapter(song.id, chapters, index)) toast(t('This chapter cannot be selected for stopping.')); }} /></SettingsGroup> : null}
    <Text style={settingsStyles.sectionDescription}>{shownPreview ? t('Preview only. Apply to keep these chapters on this device.') : t('Tap a chapter to seek. Use Stop here to stop at that chapter end. Imported chapters can be removed without changing the audio file.')}</Text>
    {!rows.length ? <Text style={settingsStyles.sectionDescription}>{t('No chapters available. Import a TXT or JSON file to add them.')}</Text> : null}
  </View>;
  return <SettingsPage title={t('Local chapters')}><FlatList data={rows} keyExtractor={(item) => String(item.start)} ListHeaderComponent={header}
    initialNumToRender={12} windowSize={7} contentContainerStyle={settingsStyles.content} renderItem={({ item, index }) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
        <Pressable accessibilityRole="button" style={{ flex: 1, paddingVertical: spacing.md }} disabled={!!shownPreview || song?.id !== playing?.id}
          onPress={() => { if (viewOwns() && currentSong(usePlayerStore.getState())?.id === song?.id) usePlayerStore.getState().seekTo(item.start); }}>
          <Text style={{ color: colors.text, fontSize: 16 }}>{item.title}</Text>
          <Text style={{ color: colors.textSecondary }}>{formatDuration(item.start)}{!shownPreview && song?.id === playing?.id && activeChapter === index ? ` · ${t('Current chapter')}` : ''}</Text>
        </Pressable>
        {!shownPreview && song?.id === playing?.id ? <Pressable accessibilityRole="button" accessibilityLabel={t('Stop after this chapter')}
          style={{ padding: spacing.md }} onPress={() => { if (!viewOwns() || !song || !stopAfterChapter(song.id, chapters, index)) toast(t('This chapter cannot be selected for stopping.')); }}>
          <Text style={{ color: colors.accent }}>{t('Stop here')}</Text></Pressable> : null}
      </View>
    )} /></SettingsPage>;
}
