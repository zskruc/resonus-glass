/** Listening presentation uses the existing per-profile podcast catalog and progress. */
import type { PodcastEpisode } from '@/api/subsonic';
import { episodePlayed, episodeResumeAt } from './episodeResume';
import { hashKey } from './localLibrary';
import { captureLyricOwner } from './lyricOwner';
import * as Db from './podcastDb';
import { profileScopeId, useAuthStore } from '@/store/auth';

export type PodcastEpisodeFilter = 'all' | 'unplayed' | 'progress' | 'downloaded';
export type PodcastProgress = { positionSec: number; durationSec: number };
export type { PodcastLibraryFilter, PodcastLibraryEpisode } from './podcastDb';
export const PODCAST_LIBRARY_PAGE_SIZE = 80;

export function podcastListeningState(episode: PodcastEpisode, saved?: PodcastProgress, livePosition?: number) {
  const duration = saved?.durationSec && Number.isFinite(saved.durationSec) && saved.durationSec > 0
    ? saved.durationSec : Number.isFinite(episode.duration) ? Math.max(0, episode.duration ?? 0) : 0;
  const value = livePosition ?? saved?.positionSec ?? 0;
  const position = Number.isFinite(value) ? Math.max(0, duration > 0 ? Math.min(duration, value) : value) : 0;
  const played = episodePlayed(position, duration), resume = episodeResumeAt(position, duration);
  return { position, duration, played, resume, inProgress: resume > 0,
    fraction: duration > 0 ? Math.min(1, position / duration) : 0, remaining: duration > 0 ? Math.max(0, duration - position) : undefined };
}

export function filterPodcastEpisodes(episodes: PodcastEpisode[], filter: PodcastEpisodeFilter, progress: Map<string, PodcastProgress>, files: Record<string, string>, season?: number | 'other') {
  return episodes.filter((episode) => {
    const actualSeason = (episode as PodcastEpisode & { season?: number }).season;
    if (season === 'other' ? actualSeason !== undefined : season !== undefined && actualSeason !== season) return false;
    const state = podcastListeningState(episode, progress.get(episode.id));
    return filter === 'all' || filter === 'downloaded' && !!files[episode.id]
      || filter === 'unplayed' && !state.played || filter === 'progress' && state.inProgress;
  });
}

function ownership(profile: string, signal?: AbortSignal) {
  const auth = useAuthStore.getState().auth, current = captureLyricOwner(profile);
  return () => { if (signal?.aborted || !current() || profileScopeId() !== profile || useAuthStore.getState().auth !== auth) throw new Error('Podcast library owner changed'); };
}
export async function readPodcastShowProgress(channelId: string, profile: string, signal?: AbortSignal): Promise<Map<string, PodcastProgress>> {
  const check = ownership(profile, signal); check();
  const rows = await Db.listEpisodeProgress(hashKey(profile), channelId); check();
  return new Map(rows.map((row) => [row.id, { positionSec: row.positionSec, durationSec: row.durationSec }]));
}
export async function readPodcastLibrary(filter: Db.PodcastLibraryFilter, offset: number, profile: string, signal?: AbortSignal, search = ''): Promise<Db.PodcastLibraryEpisode[]> {
  const check = ownership(profile, signal); check();
  const rows = await Db.listLibraryEpisodes(hashKey(profile), filter, PODCAST_LIBRARY_PAGE_SIZE, offset, search); check(); return rows;
}
