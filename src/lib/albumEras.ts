import type { Album } from '@/api/subsonic';

export const ERA_PAGE_SIZE = 200;
export const ERA_MAX_PAGES = 500;
export interface AlbumEraPage { offset: number; albums: Album[] }
export type AlbumEraSelection = { kind: 'unknown' } | { kind: 'year'; year: number } | { kind: 'decade'; year: number };

/** Original release year takes precedence over a reissue's year; 0/malformed years are unknown. */
export function albumReleaseYear(album: Album): number | undefined {
  return [album.originalReleaseDate?.year, album.releaseDate?.year, album.year]
    .find((year): year is number => typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 9999);
}
export function parseAlbumEra(value: unknown): AlbumEraSelection | undefined {
  if (value === 'unknown') return { kind: 'unknown' };
  if (typeof value !== 'string') return;
  if (/^\d{4}s$/.test(value) && Number(value.slice(0, 4)) >= 1000 && Number(value.slice(0, 4)) % 10 === 0) return { kind: 'decade', year: Number(value.slice(0, 4)) };
  if (/^\d{4}$/.test(value) && Number(value) >= 1000) return { kind: 'year', year: Number(value) };
}
function samePage(a: AlbumEraPage, b: AlbumEraPage) {
  return a.albums.length === b.albums.length && a.albums.every((album, index) => album.id === b.albums[index].id);
}
/** A repeated full page is a server pagination fault, never a successful full-library count. */
export function albumEraPageIssue(pages: readonly AlbumEraPage[]): 'repeated' | 'limit' | undefined {
  const last = pages.at(-1);
  if (!last || last.albums.length < ERA_PAGE_SIZE) return;
  if (pages.slice(0, -1).some((page) => samePage(page, last))) return 'repeated';
  if (pages.length >= ERA_MAX_PAGES) return 'limit';
}
export function nextAlbumEraPage(last: AlbumEraPage, pages: readonly AlbumEraPage[]): number | undefined {
  return last.albums.length === ERA_PAGE_SIZE && !albumEraPageIssue(pages) ? last.offset + ERA_PAGE_SIZE : undefined;
}
export function albumEraIndex(pages: readonly AlbumEraPage[]) {
  const unique = new Map<string, Album>();
  for (const page of pages) for (const album of page.albums) if (album.id) unique.set(album.id, album);
  const byYear = new Map<number, Album[]>(), unknown: Album[] = [], byDecade = new Map<number, Album[]>();
  for (const album of unique.values()) {
    const year = albumReleaseYear(album);
    if (year === undefined) { unknown.push(album); continue; }
    let yearAlbums = byYear.get(year);
    if (!yearAlbums) { yearAlbums = []; byYear.set(year, yearAlbums); }
    yearAlbums.push(album);
    const decade = Math.floor(year / 10) * 10;
    let decadeAlbums = byDecade.get(decade);
    if (!decadeAlbums) { decadeAlbums = []; byDecade.set(decade, decadeAlbums); }
    decadeAlbums.push(album);
  }
  return { count: unique.size, byYear, byDecade, unknown };
}
export function albumsInEra(index: ReturnType<typeof albumEraIndex>, selection: AlbumEraSelection): Album[] {
  return selection.kind === 'unknown' ? index.unknown : selection.kind === 'year'
    ? index.byYear.get(selection.year) ?? [] : index.byDecade.get(selection.year) ?? [];
}
