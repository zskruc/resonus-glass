import { useMemo, useRef } from 'react';
import type { Album, Song } from '@/api/subsonic';
import { SortSheet } from '@/components/SortSheet';
import { ARTIST_SONG_SORT_OPTIONS, DEFAULT_ARTIST_SONG_SORT, artistSongSortPreference, defaultArtistSongSortDirection, sortArtistSongs, type ArtistSongSortField } from '@/lib/artistSongSort';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { hashKey } from '@/lib/localLibrary';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useSortPrefs } from '@/store/sortPrefs';
import { useDownloads } from '@/store/downloads';
import { usePlayCounts } from '@/store/playCounts';

const EMPTY_FILES: Record<string, string> = {};
const EMPTY_COUNTS: Readonly<Record<string, number>> = {};
export function useArtistSongSort(source: Song[], artistId: string, albums: readonly Album[], language: string) {
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const key = `artistSongs:${hashKey(profile)}:${artistId}`;
  const stored = useSortPrefs((state) => state.prefs[key] ?? state.prefs[`artistSongs:${artistId}`]);
  const { field, dir } = artistSongSortPreference(stored);
  const openRef = useRef<() => void>(() => {});
  const files = useDownloads((state) => field === 'downloaded' ? state.files : EMPTY_FILES);
  const countScope = profile === 'default' ? 'default' : hashKey(profile);
  const counts = usePlayCounts((state) => field === 'plays' && state.hydrated && state.profile === countScope ? state.counts : EMPTY_COUNTS);
  const songs = useMemo(() => sortArtistSongs(source, { field, dir }, { albums, language, counts, files }), [source, field, dir, albums, language, counts, files]);
  const owns = captureLyricOwner(profile);
  return { songs, openSort: () => openRef.current(), sortSheet: <SortSheet openRef={openRef}
    options={[...ARTIST_SONG_SORT_OPTIONS]} field={field} dir={dir} onPick={(next, pickedDirection) => {
      if (!owns() || profileScopeId() !== profile || useAuthStore.getState().auth !== auth
        || !ARTIST_SONG_SORT_OPTIONS.some((option) => option.key === next)) return;
      const nextField = next as ArtistSongSortField;
      useSortPrefs.getState().setPref(key, { field: nextField, dir: nextField === field ? pickedDirection : defaultArtistSongSortDirection(nextField) }, DEFAULT_ARTIST_SONG_SORT, true);
    }} /> };
}
