/** Explicit, cancellable catalogue reads shared by smart lists, matching and analysis. */
import { getCatalogSongPage } from '@/api/data';
import type { Song } from '@/api/subsonic';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLibraries } from '@/store/libraries';

export interface MusicCatalog {
  songs: Song[];
  scope: string;
  offline: boolean;
  checkedAt: number;
}
export interface CatalogReadOptions {
  onProgress?: (count: number) => void;
  isCurrent?: () => boolean;
}

/** Short pages may be server caps, not end-of-library. Only an empty page ends a source. */
export async function collectCatalogPages(
  page: (count: number, offset: number, source: number) => Promise<{ songs: Song[]; sourceCount: number }>,
  current: () => boolean,
  progress?: (count: number) => void,
): Promise<Song[]> {
  const songs = new Map<string, Song>();
  let sources = 1;
  let expectedSources: number | undefined;
  for (let source = 0; source < sources; source++) {
    let offset = 0;
    const seen = new Set<string>();
    while (true) {
      if (!current()) throw new Error('Catalogue read cancelled');
      const result = await page(200, offset, source);
      if (!current()) throw new Error('Catalogue read cancelled');
      if (!Number.isInteger(result.sourceCount) || result.sourceCount < 1 || result.sourceCount > 1000) throw new Error('Invalid catalogue source count');
      if (expectedSources !== undefined && result.sourceCount !== expectedSources) throw new Error('Catalogue sources changed');
      expectedSources = result.sourceCount;
      sources = result.sourceCount;
      if (result.songs.length === 0) break;
      let added = 0;
      for (const song of result.songs) {
        if (!song.id || seen.has(song.id)) continue;
        seen.add(song.id); songs.set(song.id, song); added++;
      }
      if (!added) throw new Error('The server repeated a catalogue page');
      offset += result.songs.length;
      progress?.(songs.size);
      // Never silently publish a capped partial catalogue as complete.
      if (songs.size > 250_000 || offset > 500_000) throw new Error('The catalogue is too large for this analysis');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return [...songs.values()];
}

/** No completed-result cache: servers without a revision must not reuse stale scans. */
export async function readMusicCatalog(options: CatalogReadOptions = {}): Promise<MusicCatalog> {
  const owner = useAuthStore.getState();
  const scope = profileScopeId();
  const folders = useLibraries.getState().disabled;
  const current = () => {
    const active = useAuthStore.getState();
    return (!options.isCurrent || options.isCurrent()) && !active.hydrating
      && active.auth === owner.auth && active.offline === owner.offline
      && active.offlineSource === owner.offlineSource && profileScopeId() === scope
      && useLibraries.getState().disabled === folders;
  };
  const songs = await collectCatalogPages(getCatalogSongPage, current, options.onProgress);
  if (!current()) throw new Error('Catalogue read cancelled');
  return { songs, scope, offline: owner.offline, checkedAt: Date.now() };
}
