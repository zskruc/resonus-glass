import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { downloadedPlaylistIds } from '@/api/data';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useOfflineQueue } from '@/store/offlineQueue';

/** SQL IDs only, never a network fetch of every playlist or a full-song catalogue scan. */
export function useDownloadedPlaylistState() {
  const owner = useAuthStore((state) => state.auth);
  const files = useDownloads((state) => state.files);
  const hydrated = useDownloads((state) => state.hydrated);
  const edits = useOfflineQueue((state) => state.data.playlists);
  const profile = profileScopeId();
  const client = useQueryClient();
  useEffect(() => {
    if (owner && hydrated) void client.invalidateQueries({ queryKey: ['downloadedPlaylists', profile] });
  }, [owner, hydrated, files, edits, profile, client]);
  useEffect(() => client.getQueryCache().subscribe((event) => {
    // Membership can change with the same number of downloaded files. A fresh
    // playlist query queues its mirror write before this success event arrives.
    if (event.type === 'updated' && event.action.type === 'success'
      && ['playlist', 'playlists'].includes(String(event.query.queryKey[0]))) {
      void client.invalidateQueries({ queryKey: ['downloadedPlaylists', profile] });
    }
  }), [client, profile]);
  return useQuery({ queryKey: ['downloadedPlaylists', profile], queryFn: () => downloadedPlaylistIds(profile),
    enabled: !!owner && hydrated });
}

export function useDownloadedPlaylists(): Set<string> | undefined { return useDownloadedPlaylistState().data; }
