/** Profile-owned RSS progress. Native player integrations capture both owner
 * and version at load time; manual marking invalidates already queued ticks. */
import type { Song } from '@/api/subsonic';
import { profileScopeId } from '@/store/auth';
import { hashKey } from './localLibrary';
import { queryClient } from './query';
import * as Db from './podcastDb';
import { episodeResumeAt } from './episodeResume';

const versions = new Map<string, number>();
let sequence = 0;
const writes = new Map<string, { position: number; duration: number; at: number }>();
const key = (song: Song, owner: string) => `${owner}|${song.id}`;

export function podcastProgressVersion(song: Song, owner = profileScopeId()): number {
  const id = key(song, owner);
  // Re-admission always gets a fresh monotonic identity, never the old default
  // zero. Evicting an inactive episode therefore cannot revive a late callback.
  const version = versions.get(id) ?? ++sequence;
  versions.delete(id); versions.set(id, version);
  while (versions.size > 512) versions.delete(versions.keys().next().value!);
  return version;
}

export function ownsPodcastProgress(song: Song, owner: string, version: number): boolean {
  return !!song.podcastChannelId && profileScopeId() === owner && podcastProgressVersion(song, owner) === version;
}

/** Throws for a superseded read so its caller never seeks an old episode. */
export async function readPodcastResume(song: Song, owner = profileScopeId(), version = podcastProgressVersion(song, owner)): Promise<number> {
  if (!song.podcastChannelId) return 0;
  if (!ownsPodcastProgress(song, owner, version)) throw new Error('Podcast progress superseded');
  const saved = await Db.getEpisodeProgress(hashKey(owner), song.id);
  if (!ownsPodcastProgress(song, owner, version)) throw new Error('Podcast progress superseded');
  return saved ? episodeResumeAt(saved.positionSec, saved.durationSec || song.duration || 0) : 0;
}

export async function writePodcastProgress(
  song: Song, positionSec: number, durationSec: number, owner = profileScopeId(),
  version = podcastProgressVersion(song, owner), force = false,
): Promise<void> {
  const current = () => ownsPodcastProgress(song, owner, version);
  if (!current() || !Number.isFinite(positionSec) || positionSec < 0 || !Number.isFinite(durationSec) || durationSec < 0) return;
  const duration = durationSec || song.duration || 0;
  const position = duration > 0 ? Math.min(positionSec, duration) : positionSec;
  const id = key(song, owner), previous = writes.get(id), now = Date.now();
  if (!force && previous && now - previous.at < 5000 && position < duration && duration === previous.duration) return;
  await Db.saveEpisodeProgress(hashKey(owner), { id: song.id, channelId: song.podcastChannelId!, positionSec: position, durationSec: duration }, current);
  if (!current()) return;
  writes.delete(id); writes.set(id, { position, duration, at: now });
  while (writes.size > 128) writes.delete(writes.keys().next().value!);
}

export async function markPodcastPlayed(song: Song, played: boolean): Promise<void> {
  if (!song.podcastChannelId) return;
  const owner = profileScopeId(), id = key(song, owner);
  const version = ++sequence;
  versions.set(id, version); writes.delete(id);
  const current = () => ownsPodcastProgress(song, owner, version);
  if (played) await writePodcastProgress(song, song.duration || 1, song.duration || 1, owner, version, true);
  else await Db.clearEpisodeProgress(hashKey(owner), song.id, current);
  if (current()) {
    void queryClient.invalidateQueries({ queryKey: ['podcastPlayed'] });
    void queryClient.invalidateQueries({ queryKey: ['podcastFavoriteChannels'] });
    void queryClient.invalidateQueries({ queryKey: ['podcastFavoriteEpisodes'] });
  }
}
