import { profileScopeId, useAuthStore } from '@/store/auth';

/** A local SQL result belongs to the account/source which requested it, including A→B→A. */
let epoch = 0;
useAuthStore.subscribe((state, before) => {
  if (state.auth !== before.auth || state.offlineSource !== before.offlineSource) epoch++;
});
export async function guardDownloadedRead<T>(read: () => Promise<T>, expectedScope = profileScopeId()): Promise<T> {
  if (expectedScope !== profileScopeId()) throw new Error('Downloaded browse profile changed');
  const token = epoch, scope = expectedScope;
  const result = await read();
  if (token !== epoch || scope !== profileScopeId()) throw new Error('Downloaded browse profile changed');
  return result;
}

/** Exact prefixes only; normal online lists do not refetch for each downloaded song. */
export const DOWNLOADED_BROWSE_KEYS = ['downloadedAlbums', 'searchDownloadedAlbums', 'downloadedArtists',
  'downloadedArtistAlbumList', 'downloadedSongs', 'searchDownloadedSongs'] as const;
