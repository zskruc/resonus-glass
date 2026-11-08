import type { Album, Song } from '@/api/subsonic';

export const ARTIST_SONG_SORT_OPTIONS = [
  { key: 'recent', label: 'By album' }, { key: 'plays', label: 'Play count' },
  { key: 'addedDate', label: 'Date added' }, { key: 'releaseDate', label: 'Release date' },
  { key: 'duration', label: 'Duration' }, { key: 'alpha', label: 'Alphabetical' },
  { key: 'album', label: 'Album' }, { key: 'downloaded', label: 'Downloaded' },
] as const;
export type ArtistSongSortField = typeof ARTIST_SONG_SORT_OPTIONS[number]['key'];
export type ArtistSongSort = { field: ArtistSongSortField; dir: 'asc' | 'desc' };
export const DEFAULT_ARTIST_SONG_SORT: ArtistSongSort = { field: 'recent', dir: 'asc' };

export function artistSongSortPreference(value: { field?: string; dir?: string } | undefined): ArtistSongSort {
  return value && ARTIST_SONG_SORT_OPTIONS.some((option) => option.key === value.field)
    ? { field: value.field as ArtistSongSortField, dir: value.dir === 'desc' ? 'desc' : 'asc' } : DEFAULT_ARTIST_SONG_SORT;
}
export function defaultArtistSongSortDirection(field: ArtistSongSortField): ArtistSongSort['dir'] {
  return field === 'plays' || field === 'addedDate' || field === 'releaseDate' ? 'desc' : 'asc';
}
type DateParts = { year?: number; month?: number; day?: number };
function dateValue(parts?: DateParts): number | undefined {
  const year = parts?.year, month = parts?.month, day = parts?.day;
  if (!Number.isInteger(year) || year! < 1000 || year! > 9999) return;
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) return;
  if (day !== undefined && (month === undefined || !Number.isInteger(day) || day < 1 || day > new Date(Date.UTC(year!, month, 0)).getUTCDate())) return;
  // Unknown month/day remain unknown precision rather than invented Jan 1.
  return year! * 10000 + (month ?? 0) * 100 + (day ?? 0);
}
function createdValue(created?: string): number | undefined {
  if (typeof created !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(created)) return;
  const [year, month, day] = created.slice(0, 10).split('-').map(Number);
  if (dateValue({ year, month, day }) === undefined) return;
  const value = Date.parse(created); return Number.isFinite(value) ? value : undefined;
}
function playCount(song: Song, counts: Readonly<Record<string, number>>): number | undefined {
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const values = [song.playCount, counts[song.id]].filter(valid);
  return values.length ? Math.max(...values) : undefined;
}

/** Sort keys are prepared once per item, outside the O(n log n) comparator. */
export function sortArtistSongs(source: readonly Song[], sort: ArtistSongSort, options: {
  albums?: readonly Album[]; counts?: Readonly<Record<string, number>>; files?: Readonly<Record<string, string>>; language?: string;
} = {}): Song[] {
  if (sort.field === 'recent') return sort.dir === 'desc' ? [...source].reverse() : source as Song[];
  const albums = new Map(options.albums?.map((album) => [album.id, album]) ?? []);
  const collator = new Intl.Collator(options.language, { sensitivity: 'base', numeric: true });
  const direction = sort.dir === 'desc' ? -1 : 1;
  const rows = source.map((song, index) => {
    const album = song.albumId ? albums.get(song.albumId) : undefined;
    let key: string | number | undefined;
    if (sort.field === 'alpha') key = song.title.trim() || undefined;
    if (sort.field === 'album') key = song.album?.trim() || album?.name.trim() || undefined;
    if (sort.field === 'plays') key = playCount(song, options.counts ?? {});
    // `addedAt` is local file mtime. Album.created and favourite time are not
    // the track's library-added date, so none of them may stand in for it.
    if (sort.field === 'addedDate') key = createdValue(song.created);
    if (sort.field === 'releaseDate') key = dateValue(song.originalReleaseDate) ?? dateValue(song.releaseDate)
      ?? dateValue(album?.originalReleaseDate) ?? dateValue(album?.releaseDate)
      ?? dateValue({ year: song.year }) ?? dateValue({ year: album?.year });
    if (sort.field === 'duration') key = typeof song.duration === 'number' && Number.isFinite(song.duration) && song.duration > 0 ? song.duration : undefined;
    if (sort.field === 'downloaded') key = options.files?.[song.id] || song.localUri ? 0 : 1;
    return { song, index, key };
  });
  rows.sort((a, b) => {
    if (a.key === undefined || b.key === undefined) return a.key === b.key ? a.index - b.index : a.key === undefined ? 1 : -1;
    const order = typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : collator.compare(String(a.key), String(b.key));
    const albumGroup = sort.field === 'album' ? collator.compare(a.song.albumId ?? '', b.song.albumId ?? '') : 0;
    // An album keeps its own disc/track running order in both directions.
    const track = sort.field === 'album' ? (a.song.discNumber ?? 0) - (b.song.discNumber ?? 0) || (a.song.track ?? 0) - (b.song.track ?? 0) : 0;
    return direction * order || direction * albumGroup || track || a.index - b.index;
  });
  return rows.map((row) => row.song);
}
