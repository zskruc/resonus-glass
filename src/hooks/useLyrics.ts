/**
 * Lyrics for the current song, as a query.
 *
 * Where they come from is not decided here: `getSongLyrics` in the data layer
 * chooses between the file on the phone, the server and LRCLIB, the same way
 * every other query chooses. What is left here is what React Query needs — a
 * key, when it is worth asking at all, and warming it in advance.
 *
 * `prefetchLyrics` warms the query when each song starts playing, so the lyrics
 * card appears instantly when opening the player.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { getSongLyrics } from '@/api/data';
import type { Song, SubsonicAuth } from '@/api/backend';
import { queryClient } from '@/lib/query';
import { normalizeLyricOffset, shiftSongLyrics } from '@/lib/lyricTiming';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLyricOffsets } from '@/store/lyricOffsets';
import { type LyricsSource, useSettings } from '@/store/settings';

function lyricsQueryOptions(song: Song, source: LyricsSource, profile = profileScopeId()) {
  return {
    // The source goes in the key: changing it triggers a retry.
    queryKey: ['lyrics', song.id, source, profile] as const,
    // A song's lyrics don't change: don't re-fetch for the entire session.
    staleTime: Infinity,
    queryFn: () => getSongLyrics(song, source),
  };
}

/** Does it make sense to fetch lyrics for this song in the current state? */
function canFetch(song: Song | undefined, auth: SubsonicAuth | null): song is Song {
  return !!song && !song.url && (!!song.localUri || !!auth);
}

export function useLyrics(song?: Song) {
  const auth = useAuthStore((s) => s.auth);
  useAuthStore((s) => s.offline);
  const profile = profileScopeId();
  const source = useSettings((s) => s.lyricsSource);
  const offset = useLyricOffsets((s) => s.profile === profile ? normalizeLyricOffset(s.offsets[song?.id ?? '']) : 0);
  useEffect(() => { void useLyricOffsets.getState().hydrate(profile); }, [profile]);
  const select = useCallback((lyrics: Awaited<ReturnType<typeof getSongLyrics>>) => shiftSongLyrics(lyrics, offset), [offset]);
  const enabled = canFetch(song, auth);
  return useQuery({
    ...lyricsQueryOptions(song ?? ({ id: '' } as Song), source, profile),
    select,
    enabled,
  });
}

/** Prefetches the lyrics in the background (when the song starts playing). */
export function prefetchLyrics(song: Song | undefined): void {
  const auth = useAuthStore.getState().auth;
  if (!canFetch(song, auth)) return;
  const source = useSettings.getState().lyricsSource;
  void queryClient.prefetchQuery(lyricsQueryOptions(song, source));
}
