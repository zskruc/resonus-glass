import { useEffect, useSyncExternalStore } from 'react';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { getItem, setItemStrict, deleteItem } from '@/lib/storage';
import { hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { defaultDiscoveryPreferences, DiscoveryRepository } from '@/lib/discoveryPreferences';
const key = (profile: string) => `resonus.discovery.v1.${hashKey(profile)}`;
export const discoveryPreferences = new DiscoveryRepository({ current: profileScopeId, owner: () => captureLyricOwner(),
  read: (profile) => getItem(key(profile)), write: (profile, value) => setItemStrict(key(profile), value), remove: (profile) => deleteItem(key(profile)) });
const EMPTY = defaultDiscoveryPreferences();
let observing = false;
function observeOwner() {
  if (observing) return; observing = true;
  useAuthStore.subscribe((next, before) => {
    if (next.auth !== before.auth || next.offlineSource !== before.offlineSource || next.offline !== before.offline || next.autoOffline !== before.autoOffline) {
      const state = discoveryPreferences.getSnapshot();
      if (next.auth !== before.auth || state.profile !== profileScopeId() || !state.loaded) { discoveryPreferences.invalidate(); void discoveryPreferences.load(profileScopeId()); }
    }
  });
}
export function useDiscoveryPreferences() {
  observeOwner();
  useAuthStore((s) => s.auth); useAuthStore((s) => s.offlineSource);
  const profile = profileScopeId();
  const snapshot = useSyncExternalStore(discoveryPreferences.subscribe, discoveryPreferences.getSnapshot);
  useEffect(() => { void discoveryPreferences.load(profile); }, [profile]);
  return { profile, data: snapshot.profile === profile && snapshot.loaded ? snapshot.data : EMPTY,
    loaded: snapshot.profile === profile && snapshot.loaded, error: snapshot.profile === profile && snapshot.error,
    change: (update: Parameters<typeof discoveryPreferences.change>[1]) => discoveryPreferences.change(profile, update) };
}
export const exportDiscoveryPreferences = (profile: string) => discoveryPreferences.exportProfile(profile);
export const importDiscoveryPreferences = (profile: string, value: unknown) => discoveryPreferences.importProfile(profile, value);
export const clearDiscoveryProfile = (profile: string) => discoveryPreferences.clearProfile(profile);
