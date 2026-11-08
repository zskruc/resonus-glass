import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { folderSetKey, hashKey } from '@/lib/localLibrary';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { indexDownloadedLyricsPage, indexSavedLyricsPage, searchCachedLyrics } from '@/lib/lyricLibraryDb';
import { activeServerDir } from '@/store/downloads';
import { lyricMatchQuery } from '@/lib/lyricDocuments';
import { currentRecommendationSongs } from '@/lib/recommendationPlaybackSource';

/** The search itself is an indexed, capped SQL request. Only the first visit
 * upgrades older saved documents in yielded batches, independent of typing. */
export function useCachedLyricSearch(query: string) {
  const owner = useAuthStore((state) => state.auth);
  const offline = useAuthStore((state) => state.offline), source = useAuthStore((state) => state.offlineSource);
  const sourceKey = source ? `${source.mode}:${source.mode === 'folder' ? folderSetKey(source.uris) : ''}` : 'server';
  const profile = profileScopeId(), focused = useIsFocused(), client = useQueryClient();
  const [indexing, setIndexing] = useState(false);
  useEffect(() => {
    if (!focused || profile === 'default') return;
    let stopped = false;
    const owns = captureLyricOwner(profile), current = () => !stopped && owns();
    void (async () => {
      await Promise.resolve();
      if (!current()) return;
      setIndexing(true);
      let changed = false, published = Date.now();
      const dir = activeServerDir();
      const steps = [() => indexSavedLyricsPage(hashKey(profile), current),
        ...(dir ? [() => indexDownloadedLyricsPage(hashKey(profile), dir, current)] : [])];
      for (const step of steps) {
        let more = true;
        while (current() && more) {
          more = await step(); changed = true;
          if (current() && Date.now() - published > 1000) {
            published = Date.now(); void client.invalidateQueries({ queryKey: ['cachedLyricSearch', profile] });
          }
          // Yield to touches/navigation between 20-song SQL/file pages.
          if (more) await new Promise<void>((resolve) => setTimeout(resolve, 24));
        }
      }
      if (current() && changed) void client.invalidateQueries({ queryKey: ['cachedLyricSearch', profile] });
    })().catch(() => {}).finally(() => { if (current()) setIndexing(false); });
    return () => { stopped = true; };
  }, [profile, owner, offline, sourceKey, focused, client]);
  const result = useQuery({ queryKey: ['cachedLyricSearch', profile, offline, sourceKey, query],
    queryFn: async ({ signal }) => {
      const owns = captureLyricOwner(profile);
      const current = () => owns() && !signal.aborted;
      const matches = await searchCachedLyrics(hashKey(profile), query, current);
      // The SQL index is historical metadata. Resolve only these <=20 IDs
      // against the active local-folder/download catalog before showing them.
      const songs = await currentRecommendationSongs(matches.map((match) => match.song), current);
      if (!current()) throw new Error('Lyrics profile changed');
      return matches.flatMap((match) => { const song = songs.get(match.song.id); return song && !song.unavailable ? [{ ...match, song }] : []; });
    },
    enabled: focused && profile !== 'default' && !!lyricMatchQuery(query), staleTime: 0 });
  return { ...result, indexing: focused && indexing };
}
