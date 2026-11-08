import { useEffect } from 'react';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLyricDisplay } from '@/store/lyricDisplay';

export function useLyricDisplayMode() {
  useAuthStore((state) => state.auth);
  useAuthStore((state) => state.offline);
  const profile = profileScopeId();
  const mode = useLyricDisplay((state) => state.profile === profile ? state.mode : 'both');
  useEffect(() => { void useLyricDisplay.getState().hydrate(profile, () => profileScopeId() === profile); }, [profile]);
  return mode;
}
