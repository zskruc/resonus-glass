import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getAlbumList } from '@/api/data';
import * as Local from '@/lib/localQueries';
import { guardDownloadedRead } from '@/lib/downloadedBrowse';
import { ERA_PAGE_SIZE, albumEraIndex, albumEraPageIssue, nextAlbumEraPage } from '@/lib/albumEras';
import { hashKey } from '@/lib/localLibrary';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { enabledFolderIds, useLibraries } from '@/store/libraries';
import { useDownloads } from '@/store/downloads';

const fileSnapshots = new Map<string, Readonly<Record<string, string>>>();

/** Requested only by the era screens. Metadata pages are cached; no song catalogue or artwork prefetch. */
export function useAlbumEras(downloaded = false) {
  const owner = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const source = useAuthStore((state) => state.offlineSource);
  useLibraries((state) => state.disabled);
  useLibraries((state) => state.folders);
  const files = useDownloads((state) => state.files);
  const profile = profileScopeId();
  // The subscriptions above are intentional: library switches change the data set without changing account.
  const libraryKey = enabledFolderIds(owner)?.slice().sort().join(',') ?? '*';
  const scope = `${profile}|${offline ? 'offline' : 'online'}|${downloaded ? 'downloads' : 'all'}|${libraryKey}|${hashKey(JSON.stringify(source))}`;
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['albumEras', scope],
    queryFn: async ({ pageParam, signal }) => {
      const check = () => {
        if (signal.aborted || profileScopeId() !== profile || useAuthStore.getState().auth !== owner
          || useAuthStore.getState().offline !== offline || useAuthStore.getState().offlineSource !== source
          || (enabledFolderIds(owner)?.slice().sort().join(',') ?? '*') !== libraryKey) throw new Error('Album era library changed');
      };
      check();
      const albums = await guardDownloadedRead(() => (downloaded || offline ? Local.getAlbumList : getAlbumList)('alphabeticalByName', ERA_PAGE_SIZE, pageParam), profile);
      check();
      return { offset: pageParam, albums };
    },
    initialPageParam: 0,
    getNextPageParam: nextAlbumEraPage,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    enabled: !!owner || offline,
  });
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) void fetchNextPage().catch(() => {});
  }, [hasNextPage, isFetching, isError, fetchNextPage]);
  useEffect(() => {
    const before = fileSnapshots.get(scope);
    fileSnapshots.delete(scope); fileSnapshots.set(scope, files);
    while (fileSnapshots.size > 32) fileSnapshots.delete(fileSnapshots.keys().next().value!);
    if (before && before !== files && owner && (offline || downloaded)) void client.invalidateQueries({ queryKey: ['albumEras', scope] });
  }, [files, owner, offline, downloaded, client, scope]);
  const index = useMemo(() => albumEraIndex(query.data?.pages ?? []), [query.data]);
  const issue = albumEraPageIssue(query.data?.pages ?? []);
  const complete = !!query.data && !query.hasNextPage && !query.isFetching && !query.isError && !issue;
  return { ...query, index, issue, complete,
    restart: () => client.resetQueries({ queryKey: ['albumEras', scope] }),
  };
}
