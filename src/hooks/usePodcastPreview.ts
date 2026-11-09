import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { directoryLookup, getStoredChannel, refreshChannel, type PodcastChannel } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { readPodcastPreview } from '@/lib/podcastPreview';
import { profileScopeId, useAuthStore } from '@/store/auth';

const REVALIDATE_AFTER_MS = 30 * 60_000;

/** Directory navigation has already happened. This work belongs to the visible detail. */
export function usePodcastPreview(token: string | undefined) {
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId(), focused = useIsFocused();
  const [accountEpoch, setAccountEpoch] = useState(0), [networkEpoch, setNetworkEpoch] = useState(0);
  useEffect(() => {
    let scope = profileScopeId();
    return useAuthStore.subscribe((next, before) => {
      const nextScope = profileScopeId();
      if (next.auth !== before.auth || nextScope !== scope || !next.auth && next.offlineSource !== before.offlineSource)
        setAccountEpoch((value) => value + 1);
      if (next.offline !== before.offline || next.autoOffline !== before.autoOffline)
        setNetworkEpoch((value) => value + 1);
      scope = nextScope;
    });
  }, []);
  const handoff = useMemo(() => ({ token, auth, profile, accountEpoch }), [token, auth, profile, accountEpoch]);
  const seed = useMemo(() => handoff.token ? readPodcastPreview(handoff.token) : undefined, [handoff]);
  const [attempt, setAttempt] = useState(0);
  const context = useMemo(() => ({ seed, token, auth, profile }), [seed, token, auth, profile]);
  const [state, setState] = useState<{ context: typeof context; channel?: PodcastChannel; pending: boolean; error: boolean }>();
  const metadata = useMemo<PodcastChannel | undefined>(() => seed?.current() ? {
    id: seed.id, title: seed.show.title, author: seed.show.author, imageUrl: seed.show.imageUrl,
    description: seed.show.summary, feedUrl: seed.show.feedUrl, episodeCount: seed.show.episodeCount,
  } : undefined, [seed]);

  useEffect(() => {
    if (!token || !seed || !focused) return;
    const controller = new AbortController(), owns = captureLyricOwner(profile);
    let active = true;
    const samePage = () => active && !controller.signal.aborted && profileScopeId() === profile && useAuthStore.getState().auth === auth;
    const current = () => samePage() && owns() && seed.current();
    const options = { expectedProfile: profile, signal: controller.signal, current };
    // The seed is rendered synchronously; no request owns navigation or its back button.
    const work = async () => {
      await Promise.resolve();
      if (!current()) throw new Error('Podcast preview owner changed');
      setState((before) => ({ context, channel: before?.context === context ? before.channel : undefined, pending: true, error: false }));
      let feed = seed.show.feedUrl;
      if (!feed) {
        if (isManualOffline()) throw new Error('Podcast preview is unavailable offline');
        const show = await directoryLookup(seed.show.id, { country: seed.country, signal: controller.signal });
        if (!current()) return;
        feed = show?.feedUrl;
      }
      if (!feed) throw new Error('Podcast has no feed');
      const cached = await getStoredChannel(feed, options);
      if (!current()) return;
      if (cached) setState({ context, channel: cached, pending: false, error: false });
      if (isManualOffline()) {
        if (!cached) throw new Error('Podcast preview is unavailable offline');
        return;
      }
      const stale = !!cached?.error || !cached?.refreshedAt || Date.now() - cached.refreshedAt >= REVALIDATE_AFTER_MS
        || (seed.show.latestReleaseAt ?? 0) > (cached.lastPublishedAt ?? 0);
      if (cached && !stale) return;
      if (samePage()) setState((before) => ({ context, channel: before?.context === context ? before.channel : undefined, pending: true, error: false }));
      const refreshed = await refreshChannel(feed, options);
      if (current()) setState({ context, channel: refreshed, pending: false, error: false });
    };
    void work().catch(() => {
      if (samePage()) setState((before) => ({ context, channel: before?.context === context ? before.channel : undefined, pending: false, error: true }));
    }).finally(() => {
      // An aborted owner may not publish data, but still releases its own busy state.
      if (samePage()) setState((before) => before?.context === context && before.pending ? { ...before, pending: false } : before);
    });
    return () => { active = false; controller.abort(); };
  }, [context, seed, token, focused, auth, profile, attempt, networkEpoch]);

  const value = state?.context === context ? state : undefined;
  return {
    metadata, channel: value?.channel,
    pending: !!token && !!seed && (value?.pending ?? true),
    error: !!token && (!seed || value?.error === true),
    retry: useCallback(() => setAttempt((before) => before + 1), []),
    clearError: useCallback(() => setState((before) => before?.context === context && before.error ? { ...before, error: false } : before), [context]),
  };
}
