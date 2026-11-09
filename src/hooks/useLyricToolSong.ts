/** Pins a tool to the song/account that opened it, even if playback advances. */
import { useEffect, useState } from 'react';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useLyricToolTarget } from '@/store/lyricToolTarget';

/** A server's downloaded songs share its source; two local folder sets do not. */
function sourceKey() {
  const { auth, offlineSource } = useAuthStore.getState();
  if (auth) return 'server';
  return offlineSource?.mode === 'folder' ? JSON.stringify(['folder', ...new Set(offlineSource.uris)].sort()) : 'device';
}

export function useLyricToolSong() {
  useAuthStore((state) => state.auth);
  useAuthStore((state) => state.offline);
  useAuthStore((state) => state.offlineSource);
  const [target] = useState(() => {
    const handoff = useLyricToolTarget.getState();
    const profile = profileScopeId();
    return { profile, source: sourceKey(), session: handoff.session,
      song: handoff.profile === profile && handoff.song ? handoff.song : currentSong(usePlayerStore.getState()),
    };
  });
  useEffect(() => () => useLyricToolTarget.getState().clear(target.session), [target]);
  return { ...target, song: profileScopeId() === target.profile && sourceKey() === target.source ? target.song : null };
}
