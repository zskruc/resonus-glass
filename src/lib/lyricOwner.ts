import { profileScopeId, useAuthStore } from '@/store/auth';

let epoch = 0, subscribed = false;
/** Installed lazily: auth imports profile cleanup during application startup. */
export function captureLyricOwner(expectedProfile = profileScopeId()): () => boolean {
  if (!subscribed) {
    subscribed = true;
    useAuthStore.subscribe((next, before) => {
      if (next.auth !== before.auth || next.offlineSource !== before.offlineSource
        || next.offline !== before.offline || next.autoOffline !== before.autoOffline) epoch++;
    });
  }
  const token = epoch;
  return () => epoch === token && profileScopeId() === expectedProfile;
}
