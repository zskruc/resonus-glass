import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Album, Artist, Song } from '@/api/subsonic';
import { metadataCustomizationRevision, customizationScope, subscribeCustomizations } from '@/lib/localCustomizations';
import { applyAlbumDisplay, applyArtistDisplay, applySongDisplay } from '@/lib/localMetadata';
import { scopeKey, useLocalMetadata } from '@/store/localMetadata';
import { useAuthStore } from '@/store/auth';

export function useMetadataHydration() {
  const auth = useAuthStore((state) => state.auth), source = useAuthStore((state) => state.offlineSource), offline = useAuthStore((state) => state.offline);
  const revision = useSyncExternalStore(subscribeCustomizations, metadataCustomizationRevision), previous = useRef(revision);
  const { profile, source: sourceKey } = customizationScope();
  useEffect(() => { const force = previous.current !== revision; previous.current = revision; void useLocalMetadata.getState().hydrate({ profile, source: sourceKey }, force); }, [auth, source, offline, profile, sourceKey, revision]);
}
function snapshot() { const state = useLocalMetadata.getState(); return state.scope === scopeKey(customizationScope()) ? state : { songs: {}, aliases: [] }; }
export function displaySong(song: Song): Song { const state = snapshot(); return applySongDisplay(song, state.songs, state.aliases); }
export function displayArtist(artist: Artist): Artist { return applyArtistDisplay(artist, snapshot().aliases); }
export function displayAlbum(album: Album): Album { const state = snapshot(); return applyAlbumDisplay(album, state.songs, state.aliases); }
export function useDisplaySong<T extends Song | null | undefined>(song: T): T {
  const { songs, aliases, scope } = useLocalMetadata();
  return useMemo(() => song && scope === scopeKey(customizationScope()) ? applySongDisplay(song, songs, aliases) as T : song, [song, songs, aliases, scope]);
}
export function useDisplayArtist<T extends Artist | null | undefined>(artist: T): T {
  const { aliases, scope } = useLocalMetadata();
  return useMemo(() => artist && scope === scopeKey(customizationScope()) ? applyArtistDisplay(artist, aliases) as T : artist, [artist, aliases, scope]);
}
export function useDisplayAlbum<T extends Album | null | undefined>(album: T): T {
  const { songs, aliases, scope } = useLocalMetadata();
  return useMemo(() => album && scope === scopeKey(customizationScope()) ? applyAlbumDisplay(album, songs, aliases) as T : album, [album, songs, aliases, scope]);
}
