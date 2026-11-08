import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getAlbum } from '@/api/data';
import type { Album, Song } from '@/api/subsonic';
import { loadArtistSongPreview } from '@/lib/artistSongPreview';
import { folderSetKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { profileScopeId, useAuthStore } from '@/store/auth';

const EMPTY: Song[] = [];

/** A bounded artist-page shelf. The partial result never occupies artistSongs. */
export function useArtistSongPreview(artistId: string, albums: readonly Album[], enabled: boolean) {
  const client = useQueryClient(), profile = profileScopeId();
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const source = useAuthStore((state) => state.offlineSource), automatic = useAuthStore((state) => state.autoOffline);
  const sourceKey = source ? `${source.mode}:${source.mode === 'folder' ? folderSetKey(source.uris) : ''}` : 'server';
  const albumIds = albums.map((album) => album.id).join(',');
  const key = useMemo(() => ['artistSongPreview', profile, sourceKey, offline, automatic, artistId, albumIds],
    [profile, sourceKey, offline, automatic, artistId, albumIds]);
  const active = enabled && !!artistId && albums.length > 0;
  const result = useQuery({ queryKey: key, enabled: active, retry: false, gcTime: 5 * 60_000,
    queryFn: ({ signal }) => {
      const owns = captureLyricOwner(profile);
      const current = () => owns() && !signal.aborted && useAuthStore.getState().auth === auth;
      return loadArtistSongPreview(albums, {
        current,
        complete: () => {
          // Local folder changes keep the same profile ID and legacy full-list
          // keys. Those entries cannot prove which folder supplied their paths.
          if (source) return undefined;
          const cached = client.getQueryState<Song[]>(['artistSongs', artistId, albumIds]);
          return cached && !cached.isInvalidated && Array.isArray(cached.data) ? cached.data : undefined;
        },
        read: async (album) => {
          const response = await client.fetchQuery({ queryKey: ['album', album.id],
            // Read local catalogs again when the selected folder set changes;
            // legacy album keys deliberately remain compatible with screens.
            ...(source ? { staleTime: 0 } : {}),
            queryFn: async () => {
              const albumOwns = captureLyricOwner(profile);
              if (!albumOwns() || useAuthStore.getState().auth !== auth) throw new Error('Artist preview changed');
              const data = await getAlbum(album.id);
              if (!albumOwns() || useAuthStore.getState().auth !== auth) throw new Error('Artist preview changed');
              return data;
            } });
          return response.songs;
        },
      });
    } });
  useEffect(() => {
    if (!active) void client.cancelQueries({ queryKey: key, exact: true });
    return () => { void client.cancelQueries({ queryKey: key, exact: true }); };
  }, [client, key, active, auth]);
  return { songs: result.data ?? EMPTY, isPending: active && result.isPending, isError: result.isError, refetch: result.refetch };
}
