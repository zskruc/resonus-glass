import { normalizeLocalChapters, type LocalChapter } from './listeningTools';

export const CHAPTER_IMPORT_MAX_BYTES = 1024 * 1024;
export function chapterTime(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 604800 ? value : undefined;
  if (typeof value !== 'string' || value.length > 30) return;
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2}(?:\.\d{1,3})?)$/.exec(value.trim());
  if (!match) return;
  const hours = Number(match[1] ?? 0), minutes = Number(match[2]), seconds = Number(match[3]);
  if (minutes >= 60 || seconds >= 60) return;
  const time = hours * 3600 + minutes * 60 + seconds; return time <= 604800 ? time : undefined;
}
/** TXT: `00:00 Introduction`; JSON: chapters[{title,start/end}] (seconds or timestamps). */
export function parseLocalChapters(text: string, duration?: number): LocalChapter[] {
  if (text.length > CHAPTER_IMPORT_MAX_BYTES || new TextEncoder().encode(text).length > CHAPTER_IMPORT_MAX_BYTES) throw new Error('Chapter file is too large');
  const input = text.replace(/^\uFEFF/, '').trim(); let rows: unknown[];
  if (input.startsWith('{') || input.startsWith('[')) {
    const parsed: unknown = JSON.parse(input);
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { chapters?: unknown }).chapters : undefined;
    if (!Array.isArray(list) || list.length > 1000) throw new Error('Invalid chapter list');
    rows = list.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid chapter');
      const row = item as Record<string, unknown>;
      const start = chapterTime(row.start ?? row.startTime ?? row.startSec), rawEnd = row.end ?? row.endTime ?? row.endSec;
      if (rawEnd !== undefined && chapterTime(rawEnd) === undefined) throw new Error('Invalid chapter end');
      return { title: row.title, start, ...(rawEnd !== undefined ? { end: chapterTime(rawEnd) } : {}) };
    });
  } else {
    const lines = input.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
    if (lines.length > 1000) throw new Error('Too many chapters');
    rows = lines.map((line) => {
      const match = /^\s*((?:\d{1,3}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)\s+(.+?)\s*$/.exec(line);
      if (!match) throw new Error('Use a timestamp followed by a chapter title');
      return { start: chapterTime(match[1]), title: match[2] };
    });
  }
  return normalizeLocalChapters(rows, duration);
}
export function chapterAt(chapters: readonly LocalChapter[], position: number): number {
  for (let index = chapters.length - 1; index >= 0; index--) if (chapters[index].start <= position) return index;
  return -1;
}
export function chapterEnd(chapters: readonly LocalChapter[], index: number, duration?: number): number | null {
  return chapters[index]?.end ?? chapters[index + 1]?.start ?? (duration && Number.isFinite(duration) && duration > 0 ? duration : null);
}
export interface ChapterStop { songId: string; chapterStart: number; end: number | null; title: string }
export function chapterStopReached(stop: ChapterStop, songId: string, position: number, finished: boolean): boolean {
  return stop.songId === songId && (stop.end === null ? finished : Number.isFinite(position) && position >= stop.end);
}
