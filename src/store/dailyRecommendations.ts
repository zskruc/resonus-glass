import { create } from 'zustand';

import { getAlbum, getAlbumList, getRandomSongs } from '@/api/data';
import { createDailyRecommendations, type DailyRecommendationsState } from '@/lib/dailyRecommendations';
import { loadRecommendationCandidates } from '@/lib/recommendationCandidates';
import { getItem, setItemStrict } from '@/lib/storage';
import { useAuthStore } from './auth';
import { ownedPlayCounts, usePlayCounts } from './playCounts';
import { recommendationProfileScope } from './shufflePreferences';

const controller = createDailyRecommendations({ profile: recommendationProfileScope, owner: () => useAuthStore.getState(), now: () => new Date(),
  read: getItem, write: setItemStrict, publish: (snapshot) => useDailyRecommendations.setState(snapshot),
  candidates: async (current) => {
    // hydrated alone does not identify the account during a profile handoff.
    // The count controller rejects a read overtaken by another profile.
    await usePlayCounts.getState().hydrate();
    return loadRecommendationCandidates({ randomSongs: getRandomSongs, albums: getAlbumList, album: getAlbum,
      counts: ownedPlayCounts, now: () => new Date() }, current);
  },
});
let initialized = false;
function initialize() {
  if (initialized) return;
  initialized = true;
  useAuthStore.subscribe((state, previous) => {
    if (state.auth !== previous.auth || state.offline !== previous.offline || state.offlineSource !== previous.offlineSource) controller.invalidate();
  });
}
export const useDailyRecommendations = create<DailyRecommendationsState & { ensure(): Promise<void>; refresh(): Promise<void> }>(() => ({
  profile: '', snapshot: null, loading: false, error: false,
  ensure() { initialize(); return controller.ensure(); }, refresh() { initialize(); return controller.refresh(); },
}));
