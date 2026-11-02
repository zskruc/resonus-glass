/** Continue is bound to this album/account and never seeks a newer queue. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Album, Song } from '@/api/subsonic';
import { audiobookAlbum, audiobookResumeStart } from '@/lib/audiobook';
import { formatDuration } from '@/lib/format';
import { useT } from '@/i18n';
import { audiobookProfileScope, useAlbumProgress, useAlbumProgressByAlbum } from '@/store/albumProgress';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';

export function useAudiobookResume(album: Album | undefined, songs: Song[], sourceHref: string) {
  const t = useT();
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const enabled = useSettings((state) => state.saveAudiobookProgress);
  const rewind = useSettings((state) => state.audiobookContinueRewindSec);
  const progress = useAlbumProgressByAlbum(auth, offline);
  const audiobook = !!album && audiobookAlbum(album, songs);
  const start = useMemo(() => audiobookResumeStart(songs, album ? progress[album.id] : undefined, rewind),
    [songs, album, progress, rewind]);
  const owner = audiobookProfileScope(auth, offline);
  const binding = useMemo(() => ({ album, songs, owner, sourceHref }), [album, songs, owner, sourceHref]);
  const live = useRef<typeof binding | null>(binding);
  useLayoutEffect(() => { live.current = binding; return () => { live.current = null; }; }, [binding]);
  useEffect(() => { void useAlbumProgress.getState().hydrate().catch(() => {}); }, []);
  const resume = useCallback(async () => {
    if (!start || !album || !enabled || !audiobook || live.current !== binding || audiobookProfileScope() !== owner) return;
    const loading = usePlayerStore.getState().playQueue(songs, start.index, album.name, sourceHref, { ordered: true });
    const queue = usePlayerStore.getState().queue;
    const ok = await loading;
    const current = usePlayerStore.getState();
    if (!ok || live.current !== binding || audiobookProfileScope() !== owner || current.sourceHref !== sourceHref
      || current.queue !== queue || current.queue[current.index]?.id !== songs[start.index]?.id) return;
    current.seekTo(start.positionSec);
    useAlbumProgress.getState().remember(owner, album.id, songs[start.index].id, start.positionSec, true);
  }, [start, album, enabled, audiobook, binding, owner, songs, sourceHref]);
  const onPress = useCallback(() => { void resume().catch(() => useToast.getState().show(t("Couldn't play the song"))); }, [resume, t]);
  return { audiobook, resumeAction: enabled && audiobook && start ? {
    label: t('Continue playing'), detail: `${songs[start.index].title} · ${formatDuration(start.positionSec)}`, onPress,
  } : undefined };
}
