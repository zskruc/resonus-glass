/** Episode ordering and the exact, device-owned scope of a bulk download. */
import type { PodcastChannel, PodcastEpisode } from '@/api/subsonic';

export type PodcastEpisodeOrder = 'recent' | 'added' | 'alpha';

/** A show can use oldest-first without changing another show or account. */
export function podcastEpisodeSortKey(profile: string, channelId: string): string {
  return `podcast:${JSON.stringify([profile, channelId])}`;
}

export function podcastEpisodeOrder(field: string | undefined): PodcastEpisodeOrder {
  return field === 'added' || field === 'alpha' ? field : 'recent';
}

/** Unknown dates stay at the end in either direction; ties retain feed order. */
export function sortPodcastEpisodes(
  source: PodcastEpisode[], order: PodcastEpisodeOrder, language?: string,
): PodcastEpisode[] {
  const date = (episode: PodcastEpisode) => Number.isFinite(episode.publishedAt) && episode.publishedAt! > 0
    ? episode.publishedAt! : null;
  return source.map((episode, index) => ({ episode, index })).sort((a, b) => {
    if (order === 'alpha') return a.episode.title.localeCompare(b.episode.title, language) || a.index - b.index;
    const left = date(a.episode), right = date(b.episode);
    if (left === null || right === null) return left === right ? a.index - b.index : left === null ? 1 : -1;
    return (order === 'added' ? left - right : right - left) || a.index - b.index;
  }).map(({ episode }) => episode);
}

export function podcastDownloadSelection(
  channelId: string, episodes: PodcastEpisode[], files: Readonly<Record<string, string>>,
): { pending: PodcastEpisode[]; seconds: number; unknownDuration: number; downloadable: number } {
  const seen = new Set<string>();
  const pending: PodcastEpisode[] = [];
  let seconds = 0, unknownDuration = 0, downloadable = 0;
  for (const episode of episodes) {
    if (episode.channelId !== channelId || !/^https?:\/\//i.test(episode.url ?? '') || seen.has(episode.id)) continue;
    seen.add(episode.id);
    downloadable++;
    if (files[episode.id]) continue;
    pending.push(episode);
    if (typeof episode.duration === 'number' && Number.isFinite(episode.duration) && episode.duration > 0) seconds += episode.duration;
    else unknownDuration++;
  }
  return { pending, seconds, unknownDuration, downloadable };
}

export interface PodcastDownloadRequest {
  readonly channel: PodcastChannel;
  readonly episodes: PodcastEpisode[];
  readonly owner: unknown;
}

/**
 * Preparation never starts transfers. A confirmation owns exactly the show,
 * account and opening that produced it; files that completed while it was
 * visible are excluded again at admission, without a new feed request.
 */
export function createPodcastDownloadConfirmation(deps: {
  owner(): unknown;
  allowed(): boolean;
  episodes(channelId: string): Promise<PodcastEpisode[]>;
  files(): Readonly<Record<string, string>>;
  download(channel: PodcastChannel, episodes: PodcastEpisode[]): Promise<void>;
}) {
  let active: object | null = null;
  return {
    cancel() { active = null; },
    owns(request: PodcastDownloadRequest) { return active === request && request.owner === deps.owner(); },
    async prepare(channel: PodcastChannel): Promise<PodcastDownloadRequest | null> {
      if (!deps.allowed()) { active = null; return null; }
      const ticket = { channel, owner: deps.owner() };
      active = ticket;
      const episodes = await deps.episodes(channel.id);
      if (active !== ticket || ticket.owner !== deps.owner() || !deps.allowed()) return null;
      const request = { ...ticket, episodes };
      active = request;
      return request;
    },
    async confirm(request: PodcastDownloadRequest): Promise<boolean> {
      if (active !== request || request.owner !== deps.owner() || !deps.allowed()) return false;
      active = null;
      const { pending } = podcastDownloadSelection(request.channel.id, request.episodes, deps.files());
      if (!pending.length) return false;
      // download() enters the common native-protected queue synchronously,
      // before its returned promise waits for the transfers to finish.
      await deps.download(request.channel, pending);
      return true;
    },
  };
}
