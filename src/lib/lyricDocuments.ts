/** Recording identity and bounded, literal FTS tokens shared by cache/search. */
import type { LyricLine, Song, SongLyrics } from '@/api/subsonic';
import { recommendationSong } from './dailyRecommendations';
import { sourceSong } from './sourceSongMetadata';

export type LyricDisplayMode = 'original' | 'translation' | 'romanization' | 'both';
export const LYRIC_DISPLAY_MODES: LyricDisplayMode[] = ['original', 'translation', 'romanization', 'both'];
export type LyricCandidateKind = 'automatic' | 'server' | 'sidecar-ttml' | 'sidecar-lrc' | 'embedded' | 'lrclib';
export interface LyricCandidate { id: string; kind: LyricCandidateKind; label?: string; lyrics: SongLyrics; }
export interface CachedLyricMatch { song: Song; excerpt: string; }

/** IDs can be reused after a library rescan or a file can be retagged. */
export function lyricRecordingKey(song: Song): string {
  const raw = sourceSong(song);
  return JSON.stringify([raw.id, raw.title ?? '', raw.artist ?? '', raw.album ?? '', raw.duration ?? 0]);
}
export function lyricCompanions(line: LyricLine, mode: LyricDisplayMode): string[] {
  const values = mode === 'both' ? [line.romanization, line.translation]
    : mode === 'translation' ? [line.translation] : mode === 'romanization' ? [line.romanization] : [];
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value && value !== line.value.trim()))];
}
export function plainLyricText(lyrics: SongLyrics, mode: LyricDisplayMode): string {
  return lyrics.lines.map((line) => [line.value, ...lyricCompanions(line, mode)].join('\n')).join('\n');
}
export function validLyricDocument(value: unknown): value is SongLyrics {
  const data = value as SongLyrics | undefined;
  let wordCount = 0;
  const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return !!data && typeof data.synced === 'boolean' && Array.isArray(data.lines) && data.lines.length > 0
    && data.lines.length <= 5000 && data.lines.every((line) => !!line && typeof line === 'object'
      && typeof line.value === 'string' && line.value.length <= 16000
      && (line.start === undefined || time(line.start))
      && (line.translation === undefined || typeof line.translation === 'string' && line.translation.length <= 16000)
      && (line.romanization === undefined || typeof line.romanization === 'string' && line.romanization.length <= 16000)
      && (line.words === undefined || Array.isArray(line.words) && line.words.length <= 2000
        && (wordCount += line.words.length) <= 50000 && line.words.every((word) => !!word && typeof word === 'object'
          && typeof word.value === 'string' && word.value.length <= 16000 && time(word.start)
          && (word.end === undefined || time(word.end) && word.end >= word.start))));
}
/** Search stores metadata IDs only. Playback resolves the active source again. */
export function lyricCatalogSong(song: Song): Song | null { return recommendationSong(song); }
const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
const PARTS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu;
const normalized = (text: string) => text.normalize('NFKC').toLowerCase();
const gram = (value: string) => `c${Array.from(value).map((letter) => letter.codePointAt(0)!.toString(16)).join('x')}`;
function tokens(text: string, query: boolean): string[] {
  const out: string[] = [];
  for (const part of normalized(text).match(PARTS) ?? []) {
    if (!CJK.test(part)) { out.push(query ? `"${part}"*` : part); continue; }
    const letters = Array.from(part);
    if (letters.length === 1) out.push(gram(part));
    else for (let index = 0; index < letters.length - 1; index++) out.push(gram(letters[index] + letters[index + 1]));
    // A single ideograph query still uses the index; never LIKE-scan the cache.
    if (!query) for (const letter of letters) out.push(gram(letter));
  }
  return [...new Set(out)];
}
export function lyricIndexText(text: string): string { return tokens(text, false).join(' '); }
export function lyricMatchQuery(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 200) return null;
  const terms = tokens(trimmed, true).slice(0, 24);
  return terms.length ? terms.join(' AND ') : null;
}
