import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useDetailHeroReporter } from '@/components/DetailHeroScene';
import { useRouteImageLease } from '@/components/RouteImageResources';

const NO_EVENTS = { coverDisplayed: () => {}, fieldDisplayed: () => {} };
const SceneContext = createContext(NO_EVENTS);
export function usePrimuseAlbumScene() { return useContext(SceneContext); }

/** The cover, prepared tint and static field appear/leave as one scene. */
export function PrimuseAlbumScene({ enabled, uri, textureUri, prepared, children }: {
  enabled: boolean; uri?: string; textureUri?: string; prepared: boolean; children: ReactNode;
}) {
  const lease = useRouteImageLease();
  const report = useDetailHeroReporter();
  const cover = useMemo(() => ({ uri, lease, enabled }), [uri, lease, enabled]);
  const field = useMemo(() => ({ textureUri, lease, enabled }), [textureUri, lease, enabled]);
  const live = useRef<{ cover: typeof cover; field: typeof field } | null>({ cover, field });
  const [shownCover, setShownCover] = useState<typeof cover>();
  const [shownField, setShownField] = useState<typeof field>();
  const [revealedCover, setRevealedCover] = useState<typeof cover>();
  useLayoutEffect(() => {
    live.current = { cover, field };
    return () => { live.current = null; };
  }, [cover, field]);
  const coverDisplayed = useCallback(() => {
    if (live.current?.cover === cover) setShownCover(cover);
  }, [cover]);
  const fieldDisplayed = useCallback(() => {
    if (live.current?.field === field) setShownField(field);
  }, [field]);
  const complete = lease.active && prepared && (!uri || shownCover === cover)
    && (!textureUri || shownField === field);
  const ready = lease.active && (revealedCover === cover || complete);
  if (complete && revealedCover !== cover) setRevealedCover(cover);
  useLayoutEffect(() => { if (enabled) report?.(ready); }, [enabled, report, ready]);
  const events = useMemo(() => ({ coverDisplayed, fieldDisplayed }), [coverDisplayed, fieldDisplayed]);
  // Always retain this provider, including other album styles. Changing a
  // presentation must not replace the parent or remount FlashList.
  return <SceneContext.Provider value={events}>{children}</SceneContext.Provider>;
}
