import assert from 'node:assert/strict';
import { test } from 'node:test';
import { albumReleaseYear, albumEraIndex, albumsInEra, parseAlbumEra, albumEraPageIssue, nextAlbumEraPage, ERA_PAGE_SIZE, ERA_MAX_PAGES } from '../src/lib/albumEras';
import type { Album } from '../src/api/subsonic';

const album = (id: string, year?: number): Album => ({ id, name: id, year });
test('release grouping prefers original release, tolerates bad years and keeps unknown years distinct', () => {
  assert.equal(albumReleaseYear({ ...album('reissue', 2024), originalReleaseDate: { year: 1986 } }), 1986);
  assert.equal(albumReleaseYear({ ...album('fallback', 1999), originalReleaseDate: { year: 0 } }), 1999);
  for (const year of [0, NaN, 999, 10_000, 2024.5]) assert.equal(albumReleaseYear(album('bad', year)), undefined);
  const index = albumEraIndex([{ offset: 0, albums: [album('a', 1989), album('b', 1990), album('c'), album('d', 0)] }]);
  assert.equal(index.byDecade.get(1980)?.length, 1); assert.equal(index.byDecade.get(1990)?.length, 1);
  assert.equal(index.unknown.length, 2); assert.equal(index.count, 4);
});
test('page overlap does not double count albums, and a newer metadata row can change its year', () => {
  const index = albumEraIndex([{ offset: 0, albums: [album('a', 1988)] }, { offset: 1, albums: [album('a', 2001), album('b', 2001)] }]);
  assert.equal(index.count, 2); assert.equal(index.byDecade.has(1980), false);
  assert.deepEqual(albumsInEra(index, { kind: 'year', year: 2001 }).map((entry) => entry.id), ['a', 'b']);
  assert.equal(albumsInEra(index, { kind: 'decade', year: 2000 }).length, 2);
});
test('year routes reject malformed values and never confuse unknown with year zero', () => {
  assert.deepEqual(parseAlbumEra('1980s'), { kind: 'decade', year: 1980 });
  assert.deepEqual(parseAlbumEra('1997'), { kind: 'year', year: 1997 });
  assert.deepEqual(parseAlbumEra('unknown'), { kind: 'unknown' });
  for (const value of ['1981s', '0000s', '0000', '1980<script>', 'all', undefined, ['1980']]) assert.equal(parseAlbumEra(value), undefined);
});
test('full pages continue by server offset; a short final page completes even when all its rows overlap', () => {
  const first = { offset: 0, albums: Array.from({ length: ERA_PAGE_SIZE }, (_, index) => album(String(index))) };
  assert.equal(nextAlbumEraPage(first, [first]), ERA_PAGE_SIZE);
  const short = { offset: ERA_PAGE_SIZE, albums: first.albums.slice(0, 10) };
  assert.equal(nextAlbumEraPage(short, [first, short]), undefined); assert.equal(albumEraPageIssue([first, short]), undefined);
});
test('a server repeating a full page and the safety page limit are incomplete indexes, not successful totals', () => {
  const first = { offset: 0, albums: Array.from({ length: ERA_PAGE_SIZE }, (_, index) => album(String(index))) };
  const repeat = { ...first, offset: ERA_PAGE_SIZE };
  assert.equal(albumEraPageIssue([first, repeat]), 'repeated'); assert.equal(nextAlbumEraPage(repeat, [first, repeat]), undefined);
  const pages = Array.from({ length: ERA_MAX_PAGES }, (_, page) => ({ offset: page * ERA_PAGE_SIZE,
    albums: Array.from({ length: ERA_PAGE_SIZE }, (_, index) => album(String(page * ERA_PAGE_SIZE + index))) }));
  assert.equal(albumEraPageIssue(pages), 'limit'); assert.equal(nextAlbumEraPage(pages.at(-1)!, pages), undefined);
});
