import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SongLyrics } from '@/api/subsonic';
import { GlassPressable } from '@/components/glass';
import { SettingRow, SettingsGroup, SettingsPage, SelectList, settingsStyles } from '@/components/SettingsUI';
import { useLyricToolSong } from '@/hooks/useLyricToolSong';
import { useLyrics } from '@/hooks/useLyrics';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useT } from '@/i18n';
import { lyricRecordingKey } from '@/lib/lyricDocuments';
import { cloneLyrics, editLyricLine, editLyricWord, formatLyricTimestamp, lyricTimestamp } from '@/lib/lyricEditing';
import { exportLyrics, type LyricsExportFormat } from '@/lib/lyricsExport';
import { captureCustomizationOwner, writeLocalCustomization } from '@/lib/localCustomizations';
import { useLyricOffsets } from '@/store/lyricOffsets';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';

export default function LyricEditor() {
  useTheme(); const t = useT(), dock = useLiquidDockScrollHandler(), { song } = useLyricToolSong(), lyrics = useLyrics(song ?? undefined);
  const [draft, setDraft] = useState<SongLyrics>(), [index, setIndex] = useState(0), [wordIndex, setWordIndex] = useState(0);
  const [text, setText] = useState(''), [translation, setTranslation] = useState(''), [romanization, setRomanization] = useState(''), [time, setTime] = useState(''), [word, setWord] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [exportFormat, setExportFormat] = useState<LyricsExportFormat>('lrc');
  const [exportOffset, setExportOffset] = useState<'source' | 'display'>('source');
  const loaded = useRef<string>(''), alive = useRef(true), dirty = useRef(false);
  const fillLine = useCallback((value: SongLyrics['lines'][number] | undefined) => {
    setText(value?.value ?? ''); setTranslation(value?.translation ?? ''); setRomanization(value?.romanization ?? '');
    setTime(value?.start === undefined ? '' : formatLyricTimestamp(value.start)); setWordIndex(0); setWord(value?.words?.[0]?.value ?? '');
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scope = lyrics.customizationScope, identity = song ? `${scope.profile}|${scope.source}|${song.id}` : '';
  useEffect(() => {
    if (!song || lyrics.localEditPending || !lyrics.unshiftedLyrics || loaded.current === identity) return;
    loaded.current = identity; dirty.current = false; const next = cloneLyrics(lyrics.unshiftedLyrics); setDraft(next); setIndex(0); fillLine(next.lines[0]);
  }, [identity, song, lyrics.localEditPending, lyrics.unshiftedLyrics, fillLine]);
  const line = draft?.lines[index];
  const timed = !!draft?.synced && draft.lines.every((item) => item.start !== undefined);
  const selectWord = (value: number) => { setWordIndex(value); setWord(line?.words?.[value]?.value ?? ''); };
  const action = async (work: (current: () => boolean) => Promise<void>) => {
    if (!song || busy || !draft) return;
    const owns = captureCustomizationOwner(scope, () => alive.current);
    setBusy(true); setError('');
    try { await work(owns); } catch { if (owns()) setError(t('Could not save or export local lyrics. Your source was not changed.')); }
    finally { if (alive.current) setBusy(false); }
  };
  const apply = () => {
    if (!draft || !line || busy) return;
    try {
      const start = time.trim() ? lyricTimestamp(time) : undefined;
      if (time.trim() && start === undefined) throw new Error('Invalid time');
      const next = editLyricLine(draft, index, { value: text, translation, romanization, ...(start === undefined ? {} : { start }) });
      dirty.current = true; setDraft(next); fillLine(next.lines[index]); setError('');
    } catch { setError(t('Check the time order. Edit word-timed text one word at a time.')); }
  };
  const save = () => action(async (current) => {
    if (!current()) return;
    await writeLocalCustomization(scope, 'lyric-edit', song!.id, { version: 1, recording: lyricRecordingKey(song!),
      base: lyrics.localEdit?.base ?? lyrics.sourceLyrics ?? draft, lyrics: draft, updatedAt: Date.now() }, current);
    if (current()) { dirty.current = false; useToast.getState().show(t('Local lyrics saved')); }
  });
  const restore = () => action(async (current) => {
    await writeLocalCustomization(scope, 'lyric-edit', song!.id, undefined, current);
    if (current() && lyrics.sourceLyrics) { const next = cloneLyrics(lyrics.sourceLyrics); setDraft(next); setIndex(0); fillLine(next.lines[0]); dirty.current = false; useToast.getState().show(t('Original lyric source restored')); }
  });
  const share = () => action(async (current) => {
    if (!current() || !await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable');
    const format = timed ? exportFormat : 'txt';
    const offset = exportOffset === 'display' ? useLyricOffsets.getState().offsets[song!.id] ?? 0 : 0;
    const body = exportLyrics(draft!, format, { offsetMs: offset, durationMs: (song!.duration ?? 0) * 1000 || undefined, translation: true });
    const dir = `${FileSystem.cacheDirectory}lyric-exports/`; await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); if (!current()) return;
    const file = `${dir}lyrics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format}`;
    await FileSystem.writeAsStringAsync(file, body); if (!current()) { void FileSystem.deleteAsync(file, { idempotent: true }); return; }
    await Sharing.shareAsync(file, { mimeType: format === 'srt' ? 'application/x-subrip' : 'text/plain', dialogTitle: t('Export lyrics') });
  });
  const input = (label: string, value: string, onChangeText: (value: string) => void, multiline = false, editable = true) => <View style={styles.field}>
    <Text style={styles.label}>{t(label)}</Text><TextInput value={value} onChangeText={onChangeText} editable={!busy && editable} multiline={multiline}
      style={[styles.input, multiline && { minHeight: 68 }, !editable && { opacity: .55 }]} placeholderTextColor={colors.textMuted} />
  </View>;
  const header = <View style={styles.header}>
    <Text style={styles.title}>{song?.title ?? t('Choose a song first to use lyrics tools.')}</Text>
    <Text style={styles.note}>{t('Local changes affect this app only. Apply a line, then save. Restoring returns to the original source.')}</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {song && draft ? <>
      <SettingsGroup><SettingRow label={t('Save local lyrics')} onPress={busy ? undefined : () => { void save(); }} />
        <SettingRow label={t('Restore original source')} onPress={busy || !lyrics.localEdit ? undefined : () => { void restore(); }} /></SettingsGroup>
      <Text style={styles.label}>{t('Line {n}', { n: index + 1 })}</Text>
      {input('Original text', text, setText, true, !line?.words?.length)}
      {input('Translation', translation, setTranslation, true)}{input('Romanization', romanization, setRomanization, true)}
      {input('Start time (mm:ss.mmm)', time, setTime)}
      <GlassPressable style={styles.button} disabled={busy} onPress={apply}><Text style={styles.link}>{t('Apply line')}</Text></GlassPressable>
      {line?.words?.length ? <View style={styles.wordPanel}><Text style={styles.note}>{t('Real word timestamps are preserved. Edit each word without replacing the whole line.')}</Text>
        <View style={styles.actions}><GlassPressable disabled={wordIndex === 0 || busy} onPress={() => selectWord(Math.max(0, wordIndex - 1))}><Text style={styles.link}>‹</Text></GlassPressable>
          <Text style={styles.label}>{`${wordIndex + 1} / ${line.words.length}`}</Text>
          <GlassPressable disabled={wordIndex >= line.words.length - 1 || busy} onPress={() => selectWord(Math.min(line.words!.length - 1, wordIndex + 1))}><Text style={styles.link}>›</Text></GlassPressable></View>
        {input('Word text', word, setWord)}
        <GlassPressable style={styles.button} disabled={busy} onPress={() => { try { const next = editLyricWord(draft, index, wordIndex, word); setDraft(next); setText(next.lines[index].value); dirty.current = true; } catch { setError(t('Could not edit this word.')); } }}><Text style={styles.link}>{t('Apply word')}</Text></GlassPressable>
      </View> : null}
      <SettingRow label={t('Add lyric line')} onPress={busy || draft.lines.length >= 5000 ? undefined : () => {
        const next = cloneLyrics(draft); next.lines.push({ value: '', ...(timed ? { start: (draft.lines.at(-1)?.start ?? 0) + 4000 } : {}) });
        setDraft(next); setIndex(next.lines.length - 1); fillLine(next.lines.at(-1)); dirty.current = true;
      }} />
      <SelectList<LyricsExportFormat> label={t('Export format')} options={(timed ? ['lrc', 'srt', 'txt'] : ['txt']).map((value) => ({ value: value as LyricsExportFormat, label: value.toUpperCase() }))}
        value={timed ? exportFormat : 'txt'} onChange={setExportFormat} />
      <SelectList<'source' | 'display'> label={t('Export timeline')} value={exportOffset} onChange={setExportOffset}
        options={[{ value: 'source', label: t('Original timeline') }, { value: 'display', label: t('Include this song display offset') }]} />
      <SettingRow label={t('Export lyrics')} onPress={busy ? undefined : () => { void share(); }} />
      <Text style={styles.note}>{t('Tap a line below to edit. Untimed lyrics export as TXT only.')}</Text>
    </> : !song ? null : lyrics.isError || lyrics.localEditError ? <SettingRow label={t('Retry')} onPress={() => { void lyrics.refetch(); }} />
      : lyrics.isPending ? <Text style={styles.note}>{t('Loading…')}</Text> : <SettingRow label={t('Create plain lyrics')} onPress={() => { setDraft({ synced: false, lines: [{ value: '' }] }); fillLine(undefined); }} />}
  </View>;
  return <SettingsPage title={t('Edit and export lyrics')}><Animated.FlatList data={song ? draft?.lines ?? [] : []} keyExtractor={(_, at) => String(at)} onScroll={dock} scrollEventThrottle={16} keyboardShouldPersistTaps="handled"
    initialNumToRender={10} maxToRenderPerBatch={8} windowSize={5} contentContainerStyle={settingsStyles.content} ListHeaderComponent={header}
    renderItem={({ item, index: at }) => <GlassPressable disabled={busy} onPress={() => { setIndex(at); fillLine(item); }} style={[styles.row, at === index && { backgroundColor: colors.surfaceHighlight }]}>
      <Text style={styles.note}>{item.start === undefined ? String(at + 1) : formatLyricTimestamp(item.start)}</Text><Text style={styles.label}>{item.value || '♪'}</Text>
      {item.translation ? <Text style={styles.note}>{item.translation}</Text> : null}
    </GlassPressable>} /></SettingsPage>;
}
const styles = themed((palette) => ({ header: { gap: spacing.sm }, title: { color: palette.text, fontSize: fontSize.lg, fontWeight: '600' },
  label: { color: palette.text, fontSize: fontSize.md }, note: { color: palette.textSecondary, fontSize: fontSize.sm, lineHeight: 21 },
  error: { color: palette.accent, fontSize: fontSize.sm }, field: { gap: 6 }, input: { color: palette.text, backgroundColor: palette.surfaceHighlight, borderRadius: 12, padding: 12, fontSize: fontSize.md },
  button: { padding: 14, borderRadius: 14, backgroundColor: palette.surface }, link: { color: palette.accent, fontSize: fontSize.md, fontWeight: '600' },
  row: { padding: 14, gap: 6, borderRadius: 12, marginTop: 6 }, wordPanel: { gap: 8 }, actions: { flexDirection: 'row', gap: 24, alignItems: 'center' } }));
