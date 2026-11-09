import type { LyricLine, SongLyrics } from '@/api/subsonic';
import { validLyricDocument } from './lyricDocuments';

export function cloneLyrics(lyrics: SongLyrics): SongLyrics { return JSON.parse(JSON.stringify(lyrics)); }
export function editLyricLine(document: SongLyrics, index: number, patch: { value?: string; translation?: string; romanization?: string; start?: number }): SongLyrics {
  if (!Number.isInteger(index) || index < 0 || index >= document.lines.length) throw new Error('Invalid lyric line');
  const original = document.lines[index];
  if (patch.start !== undefined && (!Number.isFinite(patch.start) || patch.start < 0)) throw new Error('Invalid lyric timestamp');
  if (patch.value !== undefined && patch.value !== original.value && original.words?.length) {
    // Editing word text without editing its word boundaries would destroy a
    // real source timeline. Keep the line locked; translations/time stay editable.
    throw new Error('Word-timed lyric text is protected');
  }
  const next = cloneLyrics(document), line: LyricLine = { ...next.lines[index], ...patch };
  if (patch.start !== undefined && original.start !== undefined) {
    const delta = patch.start - original.start;
    if (original.words) line.words = original.words.map((word) => ({ ...word, start: word.start + delta,
      ...(word.end === undefined ? {} : { end: word.end + delta }) }));
    const end = (original as LyricLine & { end?: number }).end;
    if (end !== undefined) (line as LyricLine & { end?: number }).end = end + delta;
  }
  if (patch.start !== undefined && patch.start !== original.start) {
    const previous = document.lines[index - 1]?.start, following = document.lines[index + 1]?.start;
    if (previous !== undefined && patch.start < previous || following !== undefined && patch.start > following) throw new Error('Lyric timestamps must remain in order');
    if (following !== undefined && line.words?.some((word) => word.start > following || word.end !== undefined && word.end > following)) throw new Error('Word timing overlaps the next line');
  }
  next.lines[index] = line;
  if (patch.start !== undefined) next.synced = true;
  if (!validLyricDocument(next)) throw new Error('Invalid lyric edit');
  return next;
}
export function editLyricWord(document: SongLyrics, lineIndex: number, wordIndex: number, value: string): SongLyrics {
  const next = cloneLyrics(document), line = next.lines[lineIndex], word = line?.words?.[wordIndex];
  if (!word || value.length > 16000) throw new Error('Invalid lyric word');
  word.value = value; line.value = line.words!.map((item) => item.value).join('');
  if (!validLyricDocument(next)) throw new Error('Invalid lyric edit');
  return next;
}
export function lyricTimestamp(value: string): number | undefined {
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!match || Number(match[3]) >= 60 || match[1] && Number(match[2]) >= 60) return undefined;
  return ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number((match[4] ?? '').padEnd(3, '0'));
}
export function formatLyricTimestamp(ms: number): string {
  const value = Math.max(0, Math.round(ms)), min = Math.floor(value / 60000), seconds = Math.floor(value % 60000 / 1000);
  return `${String(min).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}
