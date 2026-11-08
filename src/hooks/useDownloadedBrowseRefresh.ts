import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { DOWNLOADED_BROWSE_KEYS } from '@/lib/downloadedBrowse';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';

export function useDownloadedBrowseRefresh(enabled: boolean | undefined) {
  const owner = useAuthStore((state) => state.auth);
  const source = useAuthStore((state) => state.offlineSource);
  const files = useDownloads((state) => state.files);
  const hydrated = useDownloads((state) => state.hydrated);
  const client = useQueryClient();
  const profile = profileScopeId();
  useEffect(() => {
    if (!enabled || !hydrated) return;
    for (const key of DOWNLOADED_BROWSE_KEYS) void client.invalidateQueries({ queryKey: [key, profile] });
  }, [enabled, owner, source, files, hydrated, client, profile]);
  return profile;
}
