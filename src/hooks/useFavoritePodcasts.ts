import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { listFavoriteChannels, listFavoriteEpisodes, type PodcastChannel, type PodcastEpisode } from '@/api/podcasts';
import { profileScopeId, useAuthStore } from '@/store/auth';

export interface FavoritePodcastItem {
  kind: 'podcast' | 'episode'; id: string; name: string; by?: string;
  href: string; recent: number; added: number;
  channel: PodcastChannel; episode?: PodcastEpisode;
}
export function useFavoritePodcasts() {
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offline);
  const profile = profileScopeId();
  const channels = useQuery({ queryKey: ['podcastFavoriteChannels', profile], queryFn: () => listFavoriteChannels() });
  const episodes = useQuery({ queryKey: ['podcastFavoriteEpisodes', profile], queryFn: () => listFavoriteEpisodes() });
  const refreshChannels = channels.refetch, refreshEpisodes = episodes.refetch;
  useFocusEffect(useCallback(() => {
    void refreshChannels(); void refreshEpisodes();
  }, [refreshChannels, refreshEpisodes]));
  const items = useMemo<FavoritePodcastItem[]>(() => [
    ...(channels.data ?? []).map((channel) => ({ kind: 'podcast' as const, id: channel.id, name: channel.title,
      by: channel.author, href: `/podcast/${channel.id}`, recent: channel.listenedAt, added: channel.favoritedAt, channel })),
    ...(episodes.data ?? []).map(({ episode, channel, listenedAt, favoritedAt }) => ({ kind: 'episode' as const,
      id: episode.id, name: episode.title, by: channel.title, href: `/podcast/${channel.id}`,
      recent: listenedAt, added: favoritedAt, channel, episode })),
  ], [channels.data, episodes.data]);
  return { channels, episodes, items };
}
