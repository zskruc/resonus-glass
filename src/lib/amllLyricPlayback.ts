import { canApplyPlayerSeek } from './playerSeek';

export interface AmllLyricPlaybackSnapshot {
  songId?: string;
  isPlaying: boolean;
  active: boolean;
  foreground: boolean;
}

/** The adapter reads the real current player/visibility state at call time. */
export interface AmllLyricPlaybackActions {
  read: () => AmllLyricPlaybackSnapshot;
  seekTo: (seconds: number) => void;
  /** Called only after a second live read confirms this song is still paused. */
  resume: () => void;
}

/** Seek this song, then start it if paused; never toggle already-playing audio off. */
export function seekAndPlayAmllLyricLine(
  expectedSong: string | undefined,
  seconds: number,
  actions: AmllLyricPlaybackActions,
): boolean {
  if (!Number.isFinite(seconds) || seconds < 0) return false;
  const maySeek = (snapshot: AmllLyricPlaybackSnapshot) => canApplyPlayerSeek(
    expectedSong, snapshot.songId, snapshot.active, snapshot.foreground,
  );
  if (!maySeek(actions.read())) return false;
  actions.seekTo(seconds);
  // A seek may synchronously replace a source or deliver a playback callback.
  // Re-check it before resuming rather than replaying the pre-seek play state.
  const after = actions.read();
  if (maySeek(after) && !after.isPlaying) actions.resume();
  return true;
}
