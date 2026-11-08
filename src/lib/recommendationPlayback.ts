import type { Song } from '@/api/subsonic';

/** Never play a persisted path/URL; resolve the chosen day’s IDs afresh. */
export async function resolveRecommendationQueue(
  saved: readonly Song[], start: number,
  resolve: (songs: readonly Song[], current: () => boolean) => Promise<Map<string, Song>>,
  current: () => boolean,
): Promise<{ songs: Song[]; index: number } | null> {
  if (!current() || !saved[start]) return null;
  const resolved = await resolve(saved, current);
  if (!current()) return null;
  const songs = saved.flatMap((entry) => {
    const song = resolved.get(entry.id);
    return song?.id === entry.id && !song.url && !song.podcastChannelId && !song.unavailable ? [song] : [];
  });
  const index = songs.findIndex((song) => song.id === saved[start].id);
  // The requested track disappeared: do not silently play a different one.
  return index < 0 ? null : { songs, index };
}
