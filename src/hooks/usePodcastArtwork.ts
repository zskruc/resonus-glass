import { useCallback, useMemo, useState } from 'react';

import type { PodcastChannel } from '@/api/subsonic';
import { podcastArtworkCandidates } from '@/lib/podcastArtwork';
import { profileScopeId, useAuthStore } from '@/store/auth';

/** A detail opening keeps the photograph the user selected. RSS enrichment and
 * a disk-cache alias are data updates, not new visual scenes. */
export function usePodcastArtwork(
  channel: PodcastChannel, presentationIdentity: string, offline: boolean, initialArtworkUri?: string,
) {
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const request = useMemo(() => ({ presentationIdentity, profile, auth, offline }), [presentationIdentity, profile, auth, offline]);
  const candidates = podcastArtworkCandidates(channel, initialArtworkUri, offline);
  const fresh = (): { request: typeof request; uri: string | undefined; failed: boolean; fallbackUsed: boolean } =>
    ({ request, uri: candidates[0], failed: false, fallbackUsed: false });
  const [stored, setStored] = useState(fresh);
  let state = stored.request === request ? stored : fresh();
  // An opening with no directory picture may acquire its first RSS picture.
  // A failed picture may try one different source, including one arriving later.
  const candidate = state.failed ? candidates.find((uri) => uri !== state.uri) : candidates[0];
  if ((!state.uri && candidate) || (state.failed && !state.fallbackUsed && candidate)) {
    state = { ...state, uri: candidate, failed: false, fallbackUsed: state.failed || state.fallbackUsed };
  }
  if (state !== stored) setStored(state);
  const uri = state.uri;
  const onError = useCallback(() => {
    setStored((before) => before.request !== request || before.uri !== uri || before.failed ? before : { ...before, failed: true });
  }, [request, uri]);
  return { uri, onError };
}
