import type { SongLyrics } from '@/api/subsonic';
import { formatLyricTimestamp } from './lyricEditing';
import { validLyricDocument } from './lyricDocuments';
import { shiftSongLyrics } from './lyricTiming';
export type LyricsExportFormat = 'lrc' | 'srt' | 'txt';
export function exportLyrics(document: SongLyrics, format: LyricsExportFormat, options: { offsetMs?: number; durationMs?: number; translation?: boolean } = {}): string {
  if (!validLyricDocument(document)) throw new Error('No lyrics to export');
  const shifted = shiftSongLyrics(document, options.offsetMs ?? 0)!;
  if (format === 'txt') return shifted.lines.map((line) => [line.value, ...(options.translation && line.translation ? [line.translation] : [])].join('\n')).join('\n');
  if (!shifted.synced || shifted.lines.some((line) => line.start === undefined)) throw new Error('Synchronized lyrics required');
  if (format === 'lrc') {
    const body = shifted.lines.map((line) => `[${formatLyricTimestamp(line.start!)}]${line.words?.length
      ? line.words.map((word) => `<${formatLyricTimestamp(word.start)}>${word.value}`).join('')
        + (line.words.at(-1)?.end === undefined ? '' : `<${formatLyricTimestamp(line.words.at(-1)!.end!)}>`)
      : line.value}`).join('\n');
    const companions = shifted.lines.map((line) => ({ value: line.value.trim(), start: Math.round(line.start!),
      ...(line.translation ? { translation: line.translation } : {}), ...(line.romanization ? { romanization: line.romanization } : {}),
      ...(line.words ? { words: line.words } : {}) }));
    return companions.some((line) => line.translation || line.romanization || line.words) ? `${body}\n[resonus-companions:${JSON.stringify(companions)}]` : body;
  }
  const stamp = (value: number) => { const ms = Math.max(0, Math.round(value)); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms % 3600000 / 60000)).padStart(2, '0')}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  return shifted.lines.map((line, index) => {
    const start = line.start!, explicit = line.words?.at(-1)?.end;
    const end = Math.max(start + 1, shifted.lines[index + 1]?.start ?? explicit ?? options.durationMs ?? start + 4000);
    return `${index + 1}\n${stamp(start)} --> ${stamp(end)}\n${line.value}${options.translation && line.translation ? `\n${line.translation}` : ''}\n`;
  }).join('\n');
}
