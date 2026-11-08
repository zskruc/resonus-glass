import type { Album, Song } from '@/api/subsonic';

/** Complete, stable album order with at most four requests, no partial catalog publication. */
export async function gatherArtistSongs(albums: readonly Album[], read: (album: Album) => Promise<readonly Song[]>, current: () => boolean): Promise<Song[]> {
  const parts: (readonly Song[])[] = new Array(albums.length);
  let next = 0, failed = false, failure: unknown;
  const check = () => { if (!current()) throw new Error('Artist catalog owner changed'); };
  const worker = async () => {
    while (next < albums.length && !failed) {
      check(); const index = next++;
      try { parts[index] = await read(albums[index]); check(); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, albums.length) }, worker));
  check(); if (failed) throw failure;
  const seen = new Set<string>(), songs: Song[] = [];
  for (let index = 0; index < parts.length; index++) for (const song of parts[index] ?? []) {
    if (!song.id || seen.has(song.id)) continue;
    seen.add(song.id); songs.push(song.albumId ? song : { ...song, albumId: albums[index].id });
  }
  return songs;
}
