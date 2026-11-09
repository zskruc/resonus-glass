/** Local music counts are owned by the same profile as its library. */
import { create } from 'zustand';
import { AppState } from 'react-native';

import { hashKey } from '@/lib/localLibrary';
import { createProfilePlayCounts } from '@/lib/profilePlayCounts';
import { deleteItem, getItem, setItemStrict } from '@/lib/storage';
import { profileScopeId } from './auth';

interface PlayCountsState {
  profile: string | null;
  counts: Record<string, number>;
  hydrated: boolean;
  bump: (songId: string) => void;
  hydrate: () => Promise<void>;
  flush: () => Promise<void>;
}

const scope = () => profileScopeId() === 'default' ? 'default' : hashKey(profileScopeId());
const controller = createProfilePlayCounts({
  read: getItem, write: setItemStrict, remove: deleteItem, currentProfile: scope,
  publish: (counts, hydrated) => usePlayCounts.setState({ counts, hydrated, profile: hydrated ? scope() : null }),
});
export const usePlayCounts = create<PlayCountsState>(() => ({
  counts: {}, hydrated: false, profile: null,
  bump: (id) => controller.bump(scope(), id),
  hydrate: () => controller.hydrate(scope()),
  flush: () => controller.flush(),
}));
/** Do not lend a previous account's in-memory counts to a newly selected profile. */
export function ownedPlayCounts(): Readonly<Record<string, number>> {
  const state = usePlayCounts.getState();
  return state.hydrated && state.profile === scope() ? state.counts : {};
}
AppState.addEventListener('change', (state) => {
  if (state !== 'active') void controller.flush();
});

export const exportLocalPlayCounts = (current: () => boolean) => controller.exportCounts(scope(), current);
export const importLocalPlayCounts = (counts: unknown, current: () => boolean) => controller.importCounts(scope(), counts, current);
export const clearLocalPlayCountsProfile = (profile: string) => controller.clear(profile === 'default' ? 'default' : hashKey(profile));
