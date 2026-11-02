import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { getDownloadShelf, useDownloads } from '@/store/downloads';
import type { Album } from '@/api/data';

/** Album metadata only: opening a library must not deserialize every song. */
export function useDownloadShelf() {
  const owner = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const files = useDownloads((s) => s.files);
  const hydrated = useDownloads((s) => s.hydrated);
  const profile = profileScopeId();
  const client = useQueryClient();
  const shelf = useQuery({
    queryKey: ['downloadShelf', profile],
    queryFn: () => getDownloadShelf(),
    enabled: !!owner && hydrated,
  });
  useEffect(() => {
    if (owner && hydrated) void client.invalidateQueries({ queryKey: ['downloadShelf', profile] });
  }, [files, profile, owner, hydrated, client]);
  const counts = useMemo(() => new Map(shelf.data?.albums.map((album) => [album.id, album.songCount ?? 0])), [shelf.data]);
  const availability = useMemo(() => ({
    unavailable: (album: Album) => !!owner && offline && !!shelf.data && !counts.has(album.id),
    downloaded: (album: Album) => (counts.get(album.id) ?? 0) >= (album.songCount || Infinity),
  }), [shelf.data, owner, offline, counts]);
  return { ...shelf, albums: shelf.data?.albums ?? [], ...availability };
}
