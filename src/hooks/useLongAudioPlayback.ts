/** Resume/bookmark navigation is bound to the tapped profile, item and queue. */
import type { Song } from '@/api/subsonic';
import { getSong } from '@/api/data';
import { currentSong, longAudioPlaybackSample, playbackUserSeekVersion, usePlayerStore } from '@/store/player';
import { longAudioScope } from '@/store/longAudio';

export async function playLongAudioAt(song: Song, seconds: number, scope: string): Promise<boolean> {
  if (longAudioScope() !== scope || !Number.isFinite(seconds) || seconds < 0) return false;
  const before = usePlayerStore.getState();
  const beforeQueue = before.queue, beforeIndex = before.index;
  const seekVersion = playbackUserSeekVersion();
  const accepted = longAudioPlaybackSample();
  if (currentSong(before)?.id === song.id && accepted?.song.id === song.id && accepted.scope === scope) {
    before.seekTo(Math.min(seconds, song.duration || Infinity));
    if (!before.isPlaying) before.toggle();
    return true;
  }
  const playable = await getSong(song.id);
  if (!playable || longAudioScope() !== scope || playbackUserSeekVersion() !== seekVersion
    || usePlayerStore.getState().queue !== beforeQueue || usePlayerStore.getState().index !== beforeIndex) return false;
  const loading = usePlayerStore.getState().playQueue([playable], 0, song.title, undefined, { ordered: true });
  const queue = usePlayerStore.getState().queue;
  const ok = await loading;
  const now = usePlayerStore.getState();
  if (!ok || longAudioScope() !== scope || playbackUserSeekVersion() !== seekVersion || now.queue !== queue || currentSong(now)?.id !== song.id) return false;
  now.seekTo(Math.min(seconds, playable.duration || Infinity));
  return true;
}
