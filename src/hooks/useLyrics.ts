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
import { useCallback, useEffect, useMemo } from 'react';
import { editedLyrics, useLocalLyricEdit } from './useLocalLyricEdit';

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
    queryFn: (context?: { signal: AbortSignal }) => {
      if (profileScopeId() !== profile || context?.signal.aborted) throw new Error('Lyrics profile changed');
      return getSongLyrics(song, source, { stillCurrent: () => profileScopeId() === profile && !context?.signal.aborted });
    },
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
  const edit = useLocalLyricEdit(song);
  const offset = useLyricOffsets((s) => s.profile === profile ? normalizeLyricOffset(s.offsets[song?.id ?? '']) : 0);
  useEffect(() => { void useLyricOffsets.getState().hydrate(profile); }, [profile]);
  const select = useCallback((lyrics: Awaited<ReturnType<typeof getSongLyrics>>) => ({
    source: lyrics, unshifted: editedLyrics(lyrics, edit.data) ?? null,
    display: shiftSongLyrics(editedLyrics(lyrics, edit.data) ?? null, offset),
  }), [offset, edit.data]);
  const enabled = canFetch(song, auth);
  const query = useQuery({
    ...lyricsQueryOptions(song ?? ({ id: '' } as Song), source, profile),
    select,
    enabled: enabled && !edit.isPending && !edit.data,
  });
  const edited = edit.data?.lyrics;
  const editedDisplay = useMemo(() => edited ? shiftSongLyrics(edited, offset) : undefined, [edited, offset]);
  return { ...query, data: edited ? editedDisplay : query.data?.display,
    isPending: enabled && (edit.isPending || !edited && query.isPending), isError: !edited && query.isError,
    sourceLyrics: query.data?.source ?? edit.data?.base, unshiftedLyrics: edited ?? query.data?.unshifted,
    localEdit: edit.data, localEditPending: edit.isPending, localEditError: edit.isError, customizationScope: edit.scope };
}

/** Prefetches the lyrics in the background (when the song starts playing). */
export function prefetchLyrics(song: Song | undefined): void {
  const auth = useAuthStore.getState().auth;
  if (!canFetch(song, auth)) return;
  const source = useSettings.getState().lyricsSource;
  void queryClient.prefetchQuery(lyricsQueryOptions(song, source));
}
