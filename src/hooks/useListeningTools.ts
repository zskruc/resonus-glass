import { useEffect } from 'react';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { currentListeningSource, listeningSourceKey, useListeningTools } from '@/store/listeningTools';

export function useListeningToolsSource() {
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offlineSource);
  const offline = useAuthStore((state) => state.offline), automatic = useAuthStore((state) => state.autoOffline);
  const profile = profileScopeId(), source = listeningSourceKey();
  const state = useListeningTools();
  useEffect(() => { void useListeningTools.getState().load().catch(() => {}); }, [profile, source, offline, automatic]);
  return { source: currentListeningSource(), pending: !state.ready || state.profile !== profile, error: state.error,
    retry: () => useListeningTools.getState().load() };
}
