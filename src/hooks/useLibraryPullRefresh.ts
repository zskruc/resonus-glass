import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';

/** Background refetches keep the list; the spinner belongs only to a pull. */
export function useLibraryPullRefresh(...queries: { refetch: () => Promise<{ isError: boolean }> }[]) {
  const profile = profileScopeId(), owner = useAuthStore((s) => s.auth);
  const [refreshingFor, setRefreshingFor] = useState<{ profile: string; owner: typeof owner } | null>(null);
  const active = useRef<object | null>(null);
  useEffect(() => () => { active.current = null; }, [profile, owner]);
  const toast = useToast((s) => s.show), t = useT();
  const onRefresh = async () => {
    if (active.current) return;
    const ticket = {}; active.current = ticket; setRefreshingFor({ profile, owner });
    const results = await Promise.allSettled(queries.map((query) => Promise.resolve().then(() => query.refetch())));
    if (active.current !== ticket || profileScopeId() !== profile || useAuthStore.getState().auth !== owner) return;
    active.current = null; setRefreshingFor(null);
    if (results.some((result) => result.status === 'rejected' || result.value.isError)) toast(t("Couldn't refresh your library."));
  };
  return { refreshing: refreshingFor?.profile === profile && refreshingFor.owner === owner, onRefresh };
}
