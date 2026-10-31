/** A scan belongs to the account/source that opened it; rendering never triggers analysis. */
/* eslint-disable react-hooks/set-state-in-effect -- Reset the source-bound snapshot before an explicit asynchronous catalogue read. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { readMusicCatalog, type MusicCatalog } from '@/lib/musicToolsCatalog';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLibraries } from '@/store/libraries';

export function useMusicToolsCatalog() {
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const source = useAuthStore((state) => state.offlineSource);
  const folders = useLibraries((state) => state.disabled);
  const scope = profileScopeId();
  const generation = useRef(0);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ auth: typeof auth; offline: boolean; source: typeof source;
    folders: typeof folders; scope: string; loading: boolean; count: number; error: boolean; catalog?: MusicCatalog }>();
  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    const current = () => active && generation.current === token && profileScopeId() === scope;
    setState({ auth, offline, source, folders, scope, loading: true, count: 0, error: false });
    void readMusicCatalog({ isCurrent: current, onProgress: (count) => {
      if (current()) setState((previous) => previous ? { ...previous, count } : previous);
    } }).then((catalog) => {
      if (current()) setState({ auth, offline, source, folders, scope, loading: false, count: catalog.songs.length, error: false, catalog });
    }, () => {
      if (current()) setState({ auth, offline, source, folders, scope, loading: false, count: 0, error: true });
    });
    return () => { active = false; };
  }, [auth, offline, source, folders, scope, revision]);
  const matches = state?.auth === auth && state.offline === offline && state.source === source && state.folders === folders && state.scope === scope;
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { catalog: matches ? state.catalog : undefined, loading: !matches || state.loading,
    count: matches ? state.count : 0, error: matches && state.error, scope, refresh };
}
