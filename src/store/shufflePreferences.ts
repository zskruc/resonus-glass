import { create } from 'zustand';

import { hashKey, folderSetKey } from '@/lib/localLibrary';
import { createShufflePreference, type ShufflePreferenceSnapshot } from '@/lib/shufflePreference';
import { deleteItem, getItem, setItemStrict } from '@/lib/storage';
import type { ShuffleMode } from '@/lib/weightedShuffle';
import { profileScopeId, useAuthStore } from './auth';

/** Local folder collections have separate histories just like server profiles. */
export function recommendationProfileScope(): string {
  const raw = profileScopeId(), source = useAuthStore.getState().offlineSource;
  return hashKey(raw === 'local' && source?.mode === 'folder' ? `${raw}:${folderSetKey(source.uris)}` : raw);
}
const controller = createShufflePreference({ profile: recommendationProfileScope, read: getItem, write: setItemStrict, remove: deleteItem,
  publish: (snapshot) => useShufflePreferences.setState(snapshot) });
export const useShufflePreferences = create<ShufflePreferenceSnapshot & { hydrate(): Promise<void>; setMode(mode: ShuffleMode): Promise<void> }>(() => ({
  profile: '', mode: 'uniform', hydrated: false, error: false, hydrate: controller.hydrate, setMode: controller.setMode,
}));
let initialized = false;
export const getShuffleMode = (): ShuffleMode => initialized ? controller.getMode() : 'uniform';
/** Called after auth initialization; importing from the player has no side effects. */
export function initShufflePreferences(): void {
  if (initialized) return;
  initialized = true;
  let observed = recommendationProfileScope();
  useAuthStore.subscribe(() => {
    const next = recommendationProfileScope();
    if (next !== observed) { observed = next; void controller.hydrate(); }
  });
  void controller.hydrate();
}

export const exportShufflePreference = (current: () => boolean) => { initShufflePreferences(); return controller.exportMode(current); };
export const importShufflePreference = (mode: ShuffleMode, current: () => boolean) => { initShufflePreferences(); return controller.importMode(mode, current); };
export const clearShufflePreferenceProfile = (profile: string) => controller.clear(hashKey(profile));
