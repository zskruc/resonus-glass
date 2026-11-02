/** Genre-based discovery without downloading the whole server catalogue. */
import type { Album } from '@/api/subsonic';
import { getAllAlbums, getAlbumsByGenre, getGenres } from '@/api/data';
import { isAudiobookAlbum, isAudiobookGenre } from './audiobook';
import { profileScopeId, useAuthStore } from '@/store/auth';

export async function getAudiobookAlbums(): Promise<Album[]> {
  const scope = profileScopeId(), offline = useAuthStore.getState().offline;
  const owns = () => profileScopeId() === scope && useAuthStore.getState().offline === offline;
  if (offline) {
    const albums = await getAllAlbums();
    if (!owns()) throw new Error('Audiobook profile changed');
    return albums.filter(isAudiobookAlbum).sort((a, b) => a.name.localeCompare(b.name));
  }
  const genres = await getGenres();
  if (!owns()) throw new Error('Audiobook profile changed');
  const names = [...new Set(genres.filter((genre) => isAudiobookGenre(genre.value)).map((genre) => genre.value))];
  const albums = new Map<string, Album>();
  let cursor = 0;
  // Two streams, finite pages, no per-genre unbounded Promise.all fan-out.
  await Promise.all(Array.from({ length: Math.min(2, names.length) }, async () => {
    while (cursor < names.length) {
      const name = names[cursor++];
      const seenInGenre = new Set<string>();
      for (let page = 0; page < 50; page++) {
        if (!owns()) throw new Error('Audiobook profile changed');
        const rows = await getAlbumsByGenre(name, 200, page * 200);
        if (!owns()) throw new Error('Audiobook profile changed');
        let added = 0;
        for (const album of rows) {
          if (!seenInGenre.has(album.id)) { seenInGenre.add(album.id); added++; }
          if (!albums.has(album.id)) albums.set(album.id, album);
        }
        if (rows.length < 200 || added === 0) break;
        if (page === 49) throw new Error('Audiobook catalogue exceeds discovery limit');
      }
    }
  }));
  return [...albums.values()].sort((a, b) => a.name.localeCompare(b.name));
}
