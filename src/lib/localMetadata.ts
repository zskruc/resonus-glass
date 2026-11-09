import type { Album, Artist, Song } from '@/api/subsonic';
import type { LocalArtistAlias, LocalSongMetadata, SongMetadataPatch } from './localCustomizationModels';
import { METADATA_FIELDS } from './localCustomizationModels';
import { rememberSourceSong, sourceSong } from './sourceSongMetadata';
export { sourceSong } from './sourceSongMetadata';

const aliasIndexes = new WeakMap<object, { ids: Map<string, string>; names: Map<string, string> }>();
const albumIndexes = new WeakMap<object, Map<string, string>>();
export function metadataFields(song: Song): SongMetadataPatch {
  return Object.fromEntries(METADATA_FIELDS.filter((field) => song[field] !== undefined).map((field) => [field, song[field]]));
}
export function aliasName(name: string | undefined, artistId: string | undefined, aliases: readonly LocalArtistAlias[]): string | undefined {
  if (!name) return name;
  // Exact names/IDs explicitly entered by the user only; no fuzzy matching.
  let index = aliasIndexes.get(aliases);
  if (!index) { index = { ids: new Map(), names: new Map() };
    for (const entry of aliases) { index.ids.set(entry.artistId, entry.canonical); for (const value of [entry.canonical, ...entry.aliases]) index.names.set(value, entry.canonical); }
    aliasIndexes.set(aliases, index);
  }
  return (artistId ? index.ids.get(artistId) : undefined) ?? index.names.get(name) ?? name;
}
export function applySongDisplay(song: Song, corrections: Readonly<Record<string, LocalSongMetadata>>, aliases: readonly LocalArtistAlias[]): Song {
  const raw = sourceSong(song), patch = corrections[raw.id]?.patch;
  const artist = aliasName(patch?.artist ?? raw.artist, raw.artistId, aliases);
  if (!patch && artist === raw.artist) return raw;
  const displayed = { ...raw, ...patch, ...(artist === undefined ? {} : { artist }) };
  rememberSourceSong(displayed, raw); return displayed;
}
export function applyArtistDisplay(artist: Artist, aliases: readonly LocalArtistAlias[]): Artist {
  const name = aliasName(artist.name, artist.id, aliases);
  return !name || name === artist.name ? artist : { ...artist, name };
}
export function applyAlbumDisplay(album: Album, corrections: Readonly<Record<string, LocalSongMetadata>>, aliases: readonly LocalArtistAlias[]): Album {
  let index = albumIndexes.get(corrections);
  if (!index) { const names = new Map<string, Set<string>>(); index = new Map();
    for (const correction of Object.values(corrections)) if (correction.albumId && correction.patch.album !== undefined) {
      const values = names.get(correction.albumId) ?? new Set<string>(); values.add(correction.patch.album); names.set(correction.albumId, values);
    }
    for (const [id, values] of names) if (values.size === 1) index.set(id, [...values][0]);
    albumIndexes.set(corrections, index);
  }
  const name = index.get(album.id) ?? album.name;
  const artist = aliasName(album.artist, album.artistId, aliases);
  return name === album.name && artist === album.artist ? album : { ...album, name, ...(artist === undefined ? {} : { artist }) };
}
export function validateAliasOverlap(entries: readonly LocalArtistAlias[], candidate: LocalArtistAlias): void {
  const names = new Set([candidate.canonical, ...candidate.aliases]);
  if (entries.some((entry) => entry.artistId !== candidate.artistId && [entry.canonical, ...entry.aliases].some((name) => names.has(name)))) {
    throw new Error('An exact alias already belongs to another artist');
  }
}
/** Explicit preview over already loaded metadata, never a library/network walk. */
export function aliasImpactPreview(values: Iterable<unknown>, candidate: LocalArtistAlias): { samples: string[]; inspected: number; bounded: boolean } {
  const samples = new Set<string>(); let inspected = 0, bounded = false;
  const matches = (id: unknown, name: unknown) => typeof name === 'string'
    && (id === candidate.artistId || candidate.aliases.includes(name) || name === candidate.canonical);
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || inspected >= 10000) { if (inspected >= 10000) bounded = true; return; }
    inspected++;
    const row = value as Record<string, unknown>;
    if (typeof row.name === 'string' && matches(row.id, row.name)) samples.add(`${row.name} → ${candidate.canonical}`);
    if (matches(row.artistId, row.artist)) samples.add(`${String(row.title ?? row.name ?? row.id)} · ${String(row.artist)} → ${candidate.canonical}`);
  };
  for (const value of values) {
    if (inspected >= 10000) { bounded = true; break; }
    if (Array.isArray(value)) { for (const item of value) { visit(item); if (inspected >= 10000) break; } }
    else if (value && typeof value === 'object') {
      const data = value as Record<string, unknown>; visit(data.artist); visit(data.album);
      for (const field of ['songs', 'artists', 'albums']) if (Array.isArray(data[field])) for (const item of data[field]) { visit(item); if (inspected >= 10000) break; }
    }
  }
  return { samples: [...samples].slice(0, 30), inspected, bounded };
}
