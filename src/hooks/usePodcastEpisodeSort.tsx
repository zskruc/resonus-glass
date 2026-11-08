import { useMemo, useRef } from 'react';

import type { PodcastEpisode } from '@/api/subsonic';
import { SortSheet } from '@/components/SortSheet';
import { podcastEpisodeOrder, podcastEpisodeSortKey, sortPodcastEpisodes } from '@/lib/podcastPresentation';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useSortPrefs } from '@/store/sortPrefs';

export function usePodcastEpisodeSort(source: PodcastEpisode[], channelId: string, language: string, serial = false) {
  const profile = useAuthStore(() => profileScopeId());
  const key = podcastEpisodeSortKey(profile, channelId);
  const defaultField = serial ? 'added' : 'recent';
  const field = useSortPrefs((state) => podcastEpisodeOrder(state.prefs[key]?.field ?? defaultField));
  const openRef = useRef<() => void>(() => {});
  const episodes = useMemo(() => sortPodcastEpisodes(source, field, language), [source, field, language]);
  return {
    episodes,
    openSort: () => openRef.current(),
    sortSheet: <SortSheet key={key} openRef={openRef} field={field}
      options={[{ key: 'recent', label: 'Newest first' }, { key: 'added', label: 'Oldest first' }, { key: 'alpha', label: 'Alphabetical' }]}
      onPick={(next) => {
        if (profileScopeId() === profile) useSortPrefs.getState().setPref(key, { field: podcastEpisodeOrder(next), dir: 'asc' }, { field: defaultField, dir: 'asc' });
      }} />,
  };
}
