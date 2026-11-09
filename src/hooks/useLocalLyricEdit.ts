import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Song, SongLyrics } from '@/api/subsonic';
import { lyricRecordingKey } from '@/lib/lyricDocuments';
import { captureCustomizationOwner, customizationRevision, customizationScope, readLocalCustomization, subscribeCustomizations } from '@/lib/localCustomizations';
import type { LocalLyricEdit } from '@/lib/localCustomizationModels';
import { validCustomizationValue } from '@/lib/localCustomizationModels';
import { useAuthStore } from '@/store/auth';

export function useLocalLyricEdit(song?: Song) {
  const auth = useAuthStore((state) => state.auth), source = useAuthStore((state) => state.offlineSource);
  useAuthStore((state) => state.offline);
  const scope = customizationScope(), client = useQueryClient();
  const recording = song ? lyricRecordingKey(song) : '';
  const key = useMemo(() => ['localLyricEdit', scope.profile, scope.source, song?.id, recording], [scope.profile, scope.source, song?.id, recording]);
  const revision = useSyncExternalStore(subscribeCustomizations, customizationRevision), previous = useRef(revision);
  const result = useQuery({ queryKey: key, enabled: !!song && scope.profile !== 'default', staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const current = captureCustomizationOwner(scope, () => !signal.aborted);
      const value = await readLocalCustomization<LocalLyricEdit>(scope, 'lyric-edit', song!.id, current);
      return value && validCustomizationValue('lyric-edit', value) && value.recording === recording ? value : null;
    } });
  useEffect(() => { if (revision !== previous.current) { previous.current = revision; void client.invalidateQueries({ queryKey: key, exact: true }); } }, [revision, key, client, auth, source]);
  return { ...result, scope };
}
export function editedLyrics(source: SongLyrics | null | undefined, edit: LocalLyricEdit | null | undefined): SongLyrics | null | undefined {
  return edit?.lyrics ?? source;
}
