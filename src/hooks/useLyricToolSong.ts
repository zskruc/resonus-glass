/** Pins a tool to the song/account that opened it, even if playback advances. */
import { useEffect, useState } from 'react';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useLyricToolTarget } from '@/store/lyricToolTarget';

export function useLyricToolSong() {
  useAuthStore((state) => state.auth);
  useAuthStore((state) => state.offline);
  const [target] = useState(() => {
    const handoff = useLyricToolTarget.getState();
    const profile = profileScopeId();
    return { profile, session: handoff.session,
      song: handoff.profile === profile && handoff.song ? handoff.song : currentSong(usePlayerStore.getState()),
    };
  });
  useEffect(() => () => useLyricToolTarget.getState().clear(target.session), [target]);
  return { ...target, song: profileScopeId() === target.profile ? target.song : null };
}
