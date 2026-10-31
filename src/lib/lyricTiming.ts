/** Per-song presentation timing. Cached/source lyrics are never rewritten. */
import type { LyricLine, SongLyrics } from '@/api/subsonic';

export const MAX_LYRIC_OFFSET_MS = 15_000;

/** Positive values display lyrics later; negative values display them earlier. */
export function normalizeLyricOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-MAX_LYRIC_OFFSET_MS, Math.min(MAX_LYRIC_OFFSET_MS, Math.round(value / 10) * 10)) : 0;
}

export function savedLyricOffsets(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([id, value]) => {
    const offset = normalizeLyricOffset(value);
    return id.length > 0 && id.length <= 1024 && offset ? [[id, offset]] : [];
  }));
}

export function shiftSongLyrics(lyrics: SongLyrics | null, value: number): SongLyrics | null {
  const offset = normalizeLyricOffset(value);
  if (!lyrics || !lyrics.synced || !offset) return lyrics;
  const at = (time: number) => Math.max(0, time + offset);
  return { ...lyrics, lines: lyrics.lines.map((line): LyricLine => {
    const start = line.start === undefined ? undefined : at(line.start);
    // Most sources infer the line end from the next start. Preserve and shift
    // an explicit end too, should an enhanced source provide it.
    const end = (line as LyricLine & { end?: number }).end;
    return { ...line,
      ...(start === undefined ? {} : { start }),
      ...(end === undefined ? {} : { end: Math.max(start ?? 0, at(end)) }),
      ...(line.words ? { words: line.words.map((word) => ({ ...word,
        start: at(word.start),
        ...(word.end === undefined ? {} : { end: Math.max(at(word.start), at(word.end)) }),
      })) } : {}),
    };
  }) };
}
