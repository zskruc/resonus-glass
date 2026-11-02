import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import type { Album, Song } from '@/api/subsonic';
import { selectFrequentlyPlayedSongs, songMatchesFrequentArtist } from '@/lib/frequentlyPlayed';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { usePlayCounts } from '@/store/playCounts';

const EMPTY: readonly Song[] = [];

/** Supplements the existing twenty top-track candidates with song lists this
 * account already loaded. It never fetches a discography to build a sidebar. */
export function useArtistFrequentCandidates(
  artistId: string, artistName: string | undefined, albums: readonly Album[] | undefined,
  topSongs: readonly Song[] | undefined, focused: boolean,
): readonly Song[] {
  const client = useQueryClient();
  useAuthStore((state) => state.auth);
  const counts = usePlayCounts((state) => state.counts);
  const profile = profileScopeId();
  const [revision, setRevision] = useState(0);
  const albumIds = useMemo(() => new Set(albums?.map((album) => album.id) ?? []), [albums]);
  useEffect(() => {
    if (!focused || !artistName) return;
    let active = true, scheduled = false;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (!active || profileScopeId() !== profile || scheduled) return;
      if (event.type !== 'removed' && (event.type !== 'updated' || event.action.type !== 'success')) return;
      const key = event.query.queryKey;
      if (!(key[0] === 'album' && typeof key[1] === 'string' && albumIds.has(key[1]))
        && !(key[0] === 'artistSongs' && key[1] === artistId)) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (active && profileScopeId() === profile) setRevision((value) => value + 1);
      });
    });
    return () => { active = false; unsubscribe(); };
    // Subscriptions are effect-owned; only matching album data can redraw this
    // small section, and the personal count store redraws the section itself.
  }, [client, artistId, artistName, albumIds, profile, focused]);

  return useMemo(() => {
    if (!artistName) return EMPTY;
    // An already-opened full artist list supersedes its constituent album
    // queries. Stream the candidates instead of retaining or sorting another
    // copy of a potentially large discography just to show five rows.
    let allSongs: Song[] | undefined, updatedAt = -1;
    for (const query of client.getQueryCache().findAll({ queryKey: ['artistSongs', artistId] })) {
      if (Array.isArray(query.state.data) && query.state.data.length && query.state.dataUpdatedAt > updatedAt) {
        allSongs = query.state.data; updatedAt = query.state.dataUpdatedAt;
      }
    }
    function* known(): Generator<Song> {
      yield* topSongs ?? [];
      if (allSongs) yield* allSongs;
      else for (const id of albumIds) {
        const cached = client.getQueryData<{ songs: Song[] }>(['album', id]);
        if (cached?.songs) yield* cached.songs;
      }
    }
    function* belonging(): Generator<Song> {
      for (const song of known()) if (songMatchesFrequentArtist(song, artistId, artistName)) yield song;
    }
    return selectFrequentlyPlayedSongs(belonging(), counts);
    // The cache is external to React: revision invalidates it on writes, focus
    // catches writes made without a subscription, and profile isolates reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, artistId, artistName, albumIds, topSongs, counts, profile, focused, revision]);
}
