import type { Album, Artist, SearchResult } from '@/api/data';

export type SearchGridKind = 'artists' | 'albums';
export type SearchGridItem =
  | { key: string; kind: 'artist'; artist: Artist }
  | { key: string; kind: 'album'; album: Album };

/** Keep a debounced response out of a newer input, including a cleared box. */
export function currentSearchData<T>(input: string, requested: string, data: T | undefined): T | undefined {
  const query = input.trim();
  return query.length > 1 && query === requested ? data : undefined;
}

/** Identity partitions cached answers and recycled views by account and mode. */
export function searchRequestKey(profile: string, offline: boolean, query: string) {
  return ['search', profile, offline, query] as const;
}

/** A late transport may finish, but cannot publish under a superseded scope. */
export async function readCurrentSearch<T>(query: string, current: () => boolean,
  read: (query: string) => Promise<T>): Promise<T> {
  if (!current()) throw new Error('Search request superseded');
  const result = await read(query);
  if (!current()) throw new Error('Search request superseded');
  return result;
}

/** Only metadata is materialized here. FlatList creates the visible cards. */
export function searchGridItems(kind: SearchGridKind, result: SearchResult | undefined): SearchGridItem[] {
  const seen = new Set<string>();
  if (kind === 'artists') return (result?.artists ?? []).flatMap((artist) => {
    if (seen.has(artist.id)) return [];
    seen.add(artist.id);
    return [{ key: `artist:${artist.id}`, kind: 'artist' as const, artist }];
  });
  return (result?.albums ?? []).flatMap((album) => {
    if (seen.has(album.id)) return [];
    seen.add(album.id);
    return [{ key: `album:${album.id}`, kind: 'album' as const, album }];
  });
}

/** Match the phone's three artists / two albums, adding columns as space grows. */
export function searchGridGeometry(contentWidth: number, kind: SearchGridKind, gap: number) {
  const width = Number.isFinite(contentWidth) ? Math.max(1, contentWidth) : 1;
  const spacing = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  const ideal = kind === 'artists' ? 120 : 180;
  const minimum = kind === 'artists' ? 3 : 2;
  const fit = Math.max(1, Math.floor((width + spacing) / (64 + spacing)));
  const columns = Math.min(8, fit, Math.max(minimum, Math.round(width / ideal)));
  return { columns, cardWidth: Math.max(1, Math.floor((width - spacing * (columns - 1)) / columns)) };
}
