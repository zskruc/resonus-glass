import type { SongLyrics } from '@/api/subsonic';
export type ExtraWidgetKind = 'podcast' | 'stats' | 'lyrics';
export interface WidgetExtraSection { title: string; rows: { id: string; text: string }[] }
export interface WidgetExtraSnapshot { profile: string; podcast?: WidgetExtraSection; stats?: WidgetExtraSection; lyrics?: WidgetExtraSection }
export function widgetLyricIndex(lyrics: SongLyrics | null | undefined, seconds: number): number {
  if (!lyrics?.lines.length) return -1;
  if (!lyrics.synced) return 0;
  let lo = 0, hi = lyrics.lines.length - 1, at = -1;
  const time = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
  while (lo <= hi) { const middle = (lo + hi) >>> 1, start = lyrics.lines[middle].start ?? Infinity;
    if (start <= time) { at = middle; lo = middle + 1; } else hi = middle - 1; }
  return at;
}
export function widgetLyricRows(lyrics: SongLyrics | null | undefined, index: number): string[] {
  if (!lyrics || index < 0) return [];
  return lyrics.lines.slice(Math.max(0, index - 1), Math.max(0, index - 1) + 3).map((line) => line.value.trim().slice(0, 300));
}
