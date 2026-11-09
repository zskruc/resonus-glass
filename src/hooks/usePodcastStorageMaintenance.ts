import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { createPodcastMaintenanceScheduler } from '@/lib/podcastMaintenanceScheduler';
import { runPodcastMaintenance } from '@/lib/podcastStorage';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { profileScopeId, useAuthStore } from '@/store/auth';

/** No periodic wakeups: an already-restored foreground session may tidy once. */
export function usePodcastStorageMaintenance(enabled: boolean) {
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const [epoch, setEpoch] = useState(0);
  useEffect(() => useAuthStore.subscribe((next, before) => {
    if (next.auth !== before.auth || next.offline !== before.offline || next.autoOffline !== before.autoOffline
      || next.offlineSource !== before.offlineSource) setEpoch((value) => value + 1);
  }), []);
  useEffect(() => {
    if (!enabled) return;
    const owns = captureLyricOwner(profile); let active = true;
    const scheduler = createPodcastMaintenanceScheduler({
      foreground: () => active && AppState.currentState === 'active',
      run: (signal) => runPodcastMaintenance({ expectedProfile: profile, signal,
        current: () => active && !signal.aborted && owns() && profileScopeId() === profile
          && useAuthStore.getState().auth === auth && AppState.currentState === 'active' }),
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') scheduler.foreground(); else scheduler.background();
    });
    scheduler.foreground();
    return () => { active = false; scheduler.dispose(); subscription.remove(); };
  // A batched account/network round trip still invalidates the captured owner.
  }, [enabled, auth, profile, epoch]);
}
