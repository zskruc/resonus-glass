import type { PodcastChannel, PodcastEpisode, Song } from '@/api/subsonic';

interface EpisodePlaybackSnapshot {
  songId?: string; channelId?: string; queue: unknown; index: number; seekVersion: number; playing: boolean; loading?: boolean;
}
/** Explicit chapter seeks override resume; ordinary Play keeps existing resume
 * and per-show intro policies. Never turn a podcast id into a server song id. */
export async function playPodcastEpisodeAt(episode: PodcastEpisode, channel: PodcastChannel, seconds: number | undefined, actions: {
  current: () => boolean; read: () => EpisodePlaybackSnapshot; available: () => boolean;
  toSong: (episode: PodcastEpisode, channel: PodcastChannel) => Song;
  play: (song: Song, channel: PodcastChannel) => Promise<boolean>; seek: (seconds: number) => void; toggle: () => void;
}): Promise<'played' | 'unavailable' | 'superseded'> {
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 0 || seconds > 604800)) return 'unavailable';
  if (!actions.current()) return 'superseded';
  if (!episode.channelId || episode.channelId !== channel.id || !actions.available()) return 'unavailable';
  const same = (state: EpisodePlaybackSnapshot) => state.songId === episode.id && state.channelId === channel.id;
  const before = actions.read();
  const at = seconds === undefined ? undefined : episode.duration && episode.duration > 0 ? Math.min(seconds, episode.duration) : seconds;
  if (same(before) && (at === undefined || !before.loading)) {
    if (at === undefined) actions.toggle();
    else {
      actions.seek(at);
      const after = actions.read();
      if (actions.current() && same(after) && !after.playing) actions.toggle();
    }
    return 'played';
  }
  const loading = actions.play(actions.toSong(episode, channel), channel);
  const ownQueue = actions.read();
  const loaded = await loading;
  const after = actions.read();
  if (!actions.current() || after.queue !== ownQueue.queue || after.index !== ownQueue.index || !same(after)
    || after.seekVersion !== before.seekVersion) return 'superseded';
  if (!loaded) return 'unavailable';
  if (at !== undefined) actions.seek(at);
  return 'played';
}
