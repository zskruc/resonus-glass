import { useCallback, useSyncExternalStore } from 'react';

import { playlistCoverUrl } from '@/api/data';
import { localCoverUrl, subscribeLocalCover } from '@/lib/localLibrary';
import { useAuthStore } from '@/store/auth';

/** Only this playlist repaints when its durable HD copy becomes available. */
export function usePlaylistCover(id: string | undefined): string | undefined {
  const owner = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const subscribe = useCallback((listener: () => void) => subscribeLocalCover(id, listener), [id]);
  const snapshot = useCallback(() => !owner && !offline ? localCoverUrl(id) : playlistCoverUrl(id), [id, owner, offline]);
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
