import type { Album, Song } from '@/api/subsonic';

export const ARTIST_SONG_PREVIEW_LIMIT = 7;
/** Corrupt/empty discographies must not turn a small preview into a full walk. */
export const ARTIST_SONG_PREVIEW_ALBUM_BUDGET = 12;

export function firstArtistSongs(songs: Iterable<Song>): Song[] {
  const found: Song[] = [], seen = new Set<string>();
  for (const song of songs) {
    if (!song?.id || seen.has(song.id)) continue;
    seen.add(song.id); found.push(song);
    if (found.length === ARTIST_SONG_PREVIEW_LIMIT) break;
  }
  return found;
}

/** Reads in the same album/track order as the full list, never popular songs.
 * Sequential reads also avoid starting extra albums once the seventh exists. */
export async function loadArtistSongPreview(albums: readonly Album[], options: {
  current: () => boolean;
  complete: () => readonly Song[] | undefined;
  read: (album: Album) => Promise<readonly Song[]>;
}): Promise<Song[]> {
  const check = () => { if (!options.current()) throw new Error('Artist preview changed'); };
  check();
  const complete = options.complete();
  if (complete) return firstArtistSongs(complete);
  const found: Song[] = [], songs = new Set<string>(), visited = new Set<string>();
  let reads = 0;
  for (const album of albums) {
    check();
    if (!album.id || visited.has(album.id)) continue;
    visited.add(album.id);
    if (reads++ >= ARTIST_SONG_PREVIEW_ALBUM_BUDGET) break;
    // An unread album is a gap in the running order, so let Retry handle it
    // instead of labeling songs from later records as the first seven.
    const tracks = await options.read(album);
    check();
    for (const song of tracks) {
      if (!song?.id || songs.has(song.id)) continue;
      songs.add(song.id); found.push(song);
      if (found.length === ARTIST_SONG_PREVIEW_LIMIT) return found;
    }
  }
  return found;
}
