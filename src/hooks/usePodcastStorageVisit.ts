import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState } from 'react-native';

import * as Db from '@/lib/podcastDb';
import { hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { protectPodcastStorageChannel } from '@/lib/podcastStorageLease';
import { profileScopeId, useAuthStore } from '@/store/auth';

/** Actual visible visits, not background feed refreshes, extend retention. */
export function usePodcastStorageVisit(channelId: string | undefined) {
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const offline = useAuthStore((state) => state.offline), automaticOffline = useAuthStore((state) => state.autoOffline);
  useFocusEffect(useCallback(() => {
    if (!channelId) return;
    const scope = hashKey(profile), owns = captureLyricOwner(profile);
    let active = true;
    const sameProfile = () => owns() && profileScopeId() === profile && useAuthStore.getState().auth === auth;
    const current = () => active && sameProfile();
    const release = protectPodcastStorageChannel(scope, channelId);
    void Db.touchChannel(scope, channelId, Date.now(), current).catch(() => {});
    const state = AppState.addEventListener('change', () => {
      if (current()) void Db.touchChannel(scope, channelId, Date.now(), current).catch(() => {});
    });
    return () => {
      active = false; state.remove();
      // The last visible read matters too when a page stayed open for days.
      if (sameProfile()) void Db.touchChannel(scope, channelId, Date.now(), sameProfile).catch(() => {});
      release();
    };
  // A policy change restarts a visit canceled by the shared ownership epoch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, profile, auth, offline, automaticOffline]));
}
