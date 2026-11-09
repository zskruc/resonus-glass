import { getAlbum } from '@/api/data';
import type { Song } from '@/api/subsonic';
import { captureLyricOwner } from './lyricOwner';
import { savedListeningSong } from './listeningTools';
import { currentListeningSource, mutateListeningSource, useListeningTools } from '@/store/listeningTools';

export async function setSongShuffleLink(song: Song, direction: 'next' | 'previous', enabled: boolean): Promise<boolean> {
  const owns = captureLyricOwner(); await useListeningTools.getState().load(); if (!owns()) return false;
  const matches = (edge: NonNullable<ReturnType<typeof currentListeningSource>>['links'][number]) => edge.direction === direction
    && (direction === 'next' ? edge.from.id === song.id : edge.to.id === song.id);
  if (!enabled) return mutateListeningSource((value) => ({ ...value, links: value.links.filter((edge) => !matches(edge)) }));
  if (!song.albumId || song.url || song.podcastChannelId) return false;
  const album = await getAlbum(song.albumId); if (!owns()) return false;
  const tracks = album.songs.map((track, index) => ({ track, index })).sort((a, b) => (a.track.discNumber ?? 1) - (b.track.discNumber ?? 1)
    || (a.track.track ?? a.index + 1) - (b.track.track ?? b.index + 1) || a.index - b.index).map(({ track }) => track);
  const index = tracks.findIndex((track) => track.id === song.id), neighbour = tracks[index + (direction === 'next' ? 1 : -1)];
  if (index < 0 || !neighbour) return false;
  const anchor = savedListeningSong({ ...song, albumId: song.albumId }), other = savedListeningSong({ ...neighbour, albumId: song.albumId });
  if (!anchor || !other) return false;
  const edge = { from: direction === 'next' ? anchor : other, to: direction === 'next' ? other : anchor, direction };
  if (!owns()) return false;
  return mutateListeningSource((value) => {
    const rest = value.links.filter((item) => !matches(item));
    if (rest.some((item) => item.from.id === edge.from.id && item.to.id !== edge.to.id || item.to.id === edge.to.id && item.from.id !== edge.from.id)) throw new Error('A song already has another link');
    return { ...value, links: [...rest, edge] };
  });
}
