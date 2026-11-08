import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Album, Song } from '../src/api/subsonic';
import { sortArtistSongs, artistSongSortPreference } from '../src/lib/artistSongSort';
import { gatherArtistSongs } from '../src/lib/artistSongCatalog';

const ids = (songs: Song[]) => songs.map((song) => song.id);
const track = (id: string, values: Partial<Song> = {}): Song => ({ id, title: id, ...values });
const album = (id: string, values: Partial<Album> = {}): Album => ({ id, name: id, ...values });
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('artist sorting keeps ties stable, uses the maximum real play count and leaves missing values last in both directions', () => {
  const songs = [track('a', { duration: 200, playCount: 5 }), track('b', { duration: 200, playCount: 2 }), track('c'), track('d', { duration: 100, playCount: 0 })];
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'duration', dir: 'asc' })), ['d', 'a', 'b', 'c']);
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'duration', dir: 'desc' })), ['a', 'b', 'd', 'c']);
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'plays', dir: 'desc' }, { counts: { a: 1, b: 8 } })), ['b', 'a', 'd', 'c']);
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'plays', dir: 'asc' }, { counts: { a: 1, b: 8 } })), ['d', 'a', 'b', 'c']);
  assert.deepEqual(ids(songs), ['a', 'b', 'c', 'd'], 'sorting never mutates the cached source order');
  assert.equal(sortArtistSongs(songs, { field: 'recent', dir: 'asc' }), songs);
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'recent', dir: 'desc' })), ['d', 'c', 'b', 'a']);
});

test('date added uses actual song.created, while release sort accepts real partial release tags and album metadata', () => {
  const songs = [track('older', { created: '2020-04-12T12:00:00Z', albumId: 'one' }),
    track('newer', { created: '2024-06-02T12:00:00Z', originalReleaseDate: { year: 2000, month: 2, day: 29 } }),
    track('missing', { albumId: 'two', addedAt: Date.now(), starred: '2030-01-01T00:00:00Z' }),
    track('invalid', { created: '2024-02-31T12:00:00Z', year: 1990 })];
  const albums = [album('one', { originalReleaseDate: { year: 1998, month: 3 }, created: '2030-01-01T00:00:00Z' }), album('two', { created: '2040-01-01T00:00:00Z' })];
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'addedDate', dir: 'desc' }, { albums })), ['newer', 'older', 'missing', 'invalid']);
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'addedDate', dir: 'asc' }, { albums })), ['older', 'newer', 'missing', 'invalid']);
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'releaseDate', dir: 'asc' }, { albums })), ['invalid', 'older', 'newer', 'missing']);
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'releaseDate', dir: 'desc' }, { albums })), ['newer', 'older', 'invalid', 'missing']);
});

test('alphabetical reverse and album disc order preserve the real selected queue order', () => {
  const songs = [track('z', { title: 'Zulu' }), track('a', { title: 'Alpha' }), track('empty', { title: '' })];
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'alpha', dir: 'asc' }, { language: 'en' })), ['a', 'z', 'empty']);
  assert.deepEqual(ids(sortArtistSongs(songs, { field: 'alpha', dir: 'desc' }, { language: 'en' })), ['z', 'a', 'empty']);
  const ordered = sortArtistSongs([track('disc2', { album: 'Record', discNumber: 2, track: 1 }), track('disc1', { album: 'Record', discNumber: 1, track: 2 })], { field: 'album', dir: 'desc' });
  assert.deepEqual(ids(ordered), ['disc1', 'disc2']);
  const queue = { songs: ordered, index: ordered.findIndex((song) => song.id === 'disc2') };
  assert.equal(queue.songs[queue.index].id, 'disc2');
  const sameName = [track('a2', { album: 'Same', albumId: 'a', track: 2 }), track('b1', { album: 'Same', albumId: 'b', track: 1 }),
    track('a1', { album: 'Same', albumId: 'a', track: 1 }), track('b2', { album: 'Same', albumId: 'b', track: 2 })];
  assert.deepEqual(ids(sortArtistSongs(sameName, { field: 'album', dir: 'asc' })), ['a1', 'a2', 'b1', 'b2']);
  assert.deepEqual(ids(sortArtistSongs(sameName, { field: 'album', dir: 'desc' })), ['b1', 'b2', 'a1', 'a2']);
  assert.equal(artistSongSortPreference({ field: 'unexpected', dir: 'desc' }).field, 'recent');
});

test('the complete catalog loader bounds requests to four, deduplicates identities and retains album running order', async () => {
  let active = 0, maximum = 0;
  const albums = Array.from({ length: 10 }, (_, index) => album(String(index)));
  const songs = await gatherArtistSongs(albums, async (record) => {
    active++; maximum = Math.max(maximum, active); await turn(); active--;
    return [track(`song-${record.id}`), track('shared')];
  }, () => true);
  assert.equal(maximum, 4); assert.equal(songs.length, 11);
  assert.deepEqual(ids(songs).slice(0, 4), ['song-0', 'shared', 'song-1', 'song-2']);
  assert.equal(songs[0].albumId, '0', 'a getAlbum membership is a real album relationship');
});

test('a failed or canceled catalog never resolves as a falsely complete partial cache', async () => {
  let resolved = false;
  try { await gatherArtistSongs([album('bad')], async () => { throw undefined; }, () => true); resolved = true; } catch {}
  assert.equal(resolved, false, 'even undefined rejection is a real failure');
  let current = true, reads = 0;
  const releases: (() => void)[] = [];
  const work = gatherArtistSongs(Array.from({ length: 8 }, (_, index) => album(String(index))), async (record) => {
    reads++; await new Promise<void>((resolve) => releases.push(resolve)); return [track(record.id)];
  }, () => current);
  current = false; releases.forEach((release) => release());
  await assert.rejects(work, /owner changed/); assert.equal(reads, 4, 'cancellation stops admission of the remaining albums');
});
