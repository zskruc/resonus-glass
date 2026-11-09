import type { Song, SongLyrics } from '@/api/subsonic';
import { validLyricDocument } from './lyricDocuments';
import type { CustomizationKind } from './localCustomizations';

export interface LocalLyricEdit { version: 1; recording: string; base: SongLyrics; lyrics: SongLyrics; updatedAt: number; }
export const METADATA_FIELDS = ['title', 'artist', 'album', 'year', 'genre', 'track', 'discNumber'] as const;
export type MetadataField = typeof METADATA_FIELDS[number];
export type SongMetadataPatch = Partial<Pick<Song, MetadataField>>;
export interface LocalSongMetadata { version: 1; patch: SongMetadataPatch; original: SongMetadataPatch; albumId?: string; artistId?: string; }
export interface LocalArtistAlias { version: 1; artistId: string; canonical: string; aliases: string[]; }
export const LYRIC_SCRIPTS = ['chinese', 'latin', 'japanese', 'korean'] as const;
export type LyricScript = typeof LYRIC_SCRIPTS[number];
export type LyricFont = 'inherit' | 'sans-serif' | 'serif' | 'monospace' | 'sans-serif-medium' | 'custom';
export interface LocalLyricFonts { version: 1; fonts: Partial<Record<LyricScript, LyricFont>>; }
const text = (value: unknown, max = 1024): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validMetadataPatch(raw: unknown): raw is SongMetadataPatch {
  return object(raw) && Object.keys(raw).every((key) => METADATA_FIELDS.includes(key as MetadataField)
    && (['year', 'track', 'discNumber'].includes(key) ? Number.isInteger(raw[key]) && Number(raw[key]) >= 0 && Number(raw[key]) <= 99999 : text(raw[key])));
}
export function validCustomizationValue(kind: CustomizationKind, raw: unknown): boolean {
  if (!object(raw) || raw.version !== 1) return false;
  const keys = kind === 'lyric-edit' ? ['version', 'recording', 'base', 'lyrics', 'updatedAt']
    : kind === 'song-metadata' ? ['version', 'patch', 'original', 'albumId', 'artistId']
      : kind === 'artist-alias' ? ['version', 'artistId', 'canonical', 'aliases'] : ['version', 'fonts'];
  if (Object.keys(raw).some((key) => !keys.includes(key))) return false;
  if (kind === 'lyric-edit') return text(raw.recording, 8000) && validLyricDocument(raw.base) && validLyricDocument(raw.lyrics) && typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt);
  if (kind === 'song-metadata') return validMetadataPatch(raw.patch) && validMetadataPatch(raw.original)
    && (raw.albumId === undefined || text(raw.albumId)) && (raw.artistId === undefined || text(raw.artistId));
  if (kind === 'artist-alias') return text(raw.artistId) && text(raw.canonical) && !!raw.canonical.trim() && Array.isArray(raw.aliases)
    && raw.aliases.length <= 50 && raw.aliases.every((name) => text(name) && !!name.trim());
  return object(raw.fonts) && Object.entries(raw.fonts).every(([script, font]) => LYRIC_SCRIPTS.includes(script as LyricScript)
    && ['inherit', 'sans-serif', 'serif', 'monospace', 'sans-serif-medium', 'custom'].includes(String(font)));
}
