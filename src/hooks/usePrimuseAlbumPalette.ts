/** Static album preparation is owned by the displayed cover, never by scroll frames. */
import { Image } from 'expo-image';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CACHED_COVER } from '@/api/data';
import { useRouteImageLease } from '@/components/RouteImageResources';
import { buildPrimuseAlbumPalette, type PrimuseAlbumPalette } from '@/lib/primuseAlbumPalette';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useThemeMode } from '@/theme';
import { preparePrimuseAlbumArtwork } from '../../modules/amll-background/albumArtwork';
import { resolveArtworkLocalUri } from '../../modules/amll-background/artworkSource';

type PreparedAlbum = Readonly<{ sourceUri: string; textureUri: string; textureScale: number; primary: string }>;
const prepared = new Map<string, PreparedAlbum>();
const pending = new Map<string, Promise<PreparedAlbum | null>>();
const CAPACITY = 48;
const DEFAULT_BLUR_RATIO = 20 / 520;

export interface PrimuseAlbumArtwork {
  palette: PrimuseAlbumPalette;
  sourceUri?: string;
  textureUri?: string;
  /** Includes native blur's transparent halo while preserving the core cover size. */
  textureScale: number;
  /** A recovered file can have the same URI; remount only its failed decoder. */
  textureRevision: number;
  /** Current local preparation has settled, including a safe neutral failure. */
  ready: boolean;
  onArtworkLoad: (loadedUri: string) => void;
  onArtworkError: (failedUri?: string) => void;
  onTextureError: (failedUri: string) => void;
}

function cached(key: string): PreparedAlbum | undefined {
  const previous = prepared.get(key);
  if (previous) { prepared.delete(key); prepared.set(key, previous); }
  return previous;
}

function load(key: string, phase: 'probe' | 'displayed' | 'recovery', read: () => Promise<PreparedAlbum | null>): Promise<PreparedAlbum | null> {
  // An image display event must not join the initial cache-miss probe: its
  // image may have been written just after that probe looked in the cache.
  const pendingKey = `${key}|${phase}`;
  const shared = pending.get(pendingKey);
  if (shared) return shared;
  const previous = prepared.get(key);
  // Revalidate native's small disk cache on a revisit. A JS URI must not keep
  // an evicted texture alive forever; valid native hits do not decode again.
  const request = Promise.resolve().then(read).catch(() => null).then((result) => {
    if (result) {
      if (previous?.sourceUri === result.sourceUri && previous.textureUri === result.textureUri
        && previous.textureScale === result.textureScale && previous.primary === result.primary) result = previous;
      prepared.delete(key); prepared.set(key, result);
      while (prepared.size > CAPACITY) prepared.delete(prepared.keys().next().value!);
    } else if (prepared.get(key) === previous) prepared.delete(key);
    return result;
  }).finally(() => { if (pending.get(pendingKey) === request) pending.delete(pendingKey); });
  pending.set(pendingKey, request);
  return request;
}

export function usePrimuseAlbumPalette(
  uri?: string, offline = false, blurRatio = DEFAULT_BLUR_RATIO,
): PrimuseAlbumArtwork {
  useAuthStore((state) => state.auth);
  const globalOffline = useAuthStore((state) => state.offline);
  const mode = useThemeMode();
  const lease = useRouteImageLease();
  const profile = profileScopeId();
  const ratio = Number.isFinite(blurRatio) ? Math.round(Math.max(0, Math.min(0.25, blurRatio)) * 1_000_000) / 1_000_000 : DEFAULT_BLUR_RATIO;
  const source = uri?.startsWith(CACHED_COVER) ? uri.slice(CACHED_COVER.length) : uri;
  const cacheOnly = offline || globalOffline || !!uri?.startsWith(CACHED_COVER);
  const key = source ? JSON.stringify([profile, source, ratio, cacheOnly ? 'local' : 'exact', 'primuse-album-2']) : undefined;
  const identity = useMemo(() => ({ key, uri, profile, cacheOnly, lease }), [key, uri, profile, cacheOnly, lease]);
  const initial = () => ({ identity, entry: key && lease.active ? cached(key) : undefined,
    settled: false, artworkFailed: false, displayed: false, revision: 0,
    textureRevision: 0, textureFailed: false, recovered: false });
  const [stored, setStored] = useState(initial);
  // Retain only this mounted asset/lease's last good preparation. A failed
  // revalidation clears the shared warm cache for future visitors, but cannot
  // remove pixels which this still-active scene has already painted.
  const state = stored.identity === identity ? stored : initial();
  if (stored.identity !== identity) setStored(state);
  const request = useMemo(() => ({ identity, revision: state.revision }), [identity, state.revision]);
  const live = useRef<typeof identity | null>(identity);
  useLayoutEffect(() => { live.current = identity; return () => { live.current = null; }; }, [identity]);
  const current = () => live.current === identity && lease.active && profileScopeId() === profile;
  const entry = lease.active && !state.artworkFailed ? state.entry : undefined;

  const onArtworkLoad = useCallback((loadedUri: string) => {
    if (!key || loadedUri !== uri || !current()) return;
    // Expo may send both metadata and display notifications for one bitmap.
    // They wake a cold cache miss once, not once per event or page redraw.
    setStored((value) => value.identity !== identity || value.displayed && !value.artworkFailed ? value
      : { ...value, displayed: true, artworkFailed: false, settled: !!value.entry,
        revision: value.revision + 1 });
  // Identity also owns callbacks during A→B→A and lease reacquisition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const onArtworkError = useCallback((failedUri?: string) => {
    if (!key || !current() || failedUri !== undefined && failedUri !== uri) return;
    setStored((value) => value.identity !== identity || value.artworkFailed ? value
      : { ...value, artworkFailed: true, settled: true, entry: undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const onTextureError = useCallback((failedUri: string) => {
    if (!key || !current()) return;
    setStored((value) => {
      if (value.identity !== identity || value.entry?.textureUri !== failedUri || value.textureFailed) return value;
      if (prepared.get(key)?.textureUri === failedUri) prepared.delete(key);
      // One local regeneration per lease. A second renderer/file failure
      // settles to the readable gradient, never a retry/render loop.
      return { ...value, textureFailed: true, recovered: true,
        revision: value.revision + (value.recovered ? 0 : 1) };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    if (!uri || !source || !key || state.artworkFailed || !lease.active) return;
    let active = true;
    const phase = state.textureFailed && state.recovered ? 'recovery' : state.displayed ? 'displayed' : 'probe';
    void load(key, phase, async () => {
      // Cover owns the only image request. This resolver only inspects its
      // local cache, including offline-only markers and older cached sizes.
      // A cache miss is retried by the cover's load/display callback above.
      const resolveLocal = () => resolveArtworkLocalUri(cacheOnly ? CACHED_COVER + source : source, CACHED_COVER, {
        cachePath: (candidate) => Image.getCachePathAsync(candidate),
        prefetch: async () => false,
        allowNetwork: () => false,
      }, { quality: 'exact' });
      let local = await resolveLocal();
      // onDisplay can precede Expo's encoded disk-cache write. Give that same
      // completed request two bounded local-only probes, never another fetch.
      if (phase !== 'probe') for (const delay of [32, 96]) {
        if (local || profileScopeId() !== profile) break;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        local = await resolveLocal();
      }
      // Shared local work belongs to the immutable profile/asset key, not to
      // the lifetime of its first subscriber. A replacement subscriber must
      // not inherit a cancelled owner's cache miss or discard a valid result.
      if (!local || profileScopeId() !== profile) return null;
      const result = await preparePrimuseAlbumArtwork(local, ratio);
      const textureScale = result?.textureScale ?? 1;
      if (profileScopeId() !== profile || !result || !/^(?:file|content):/i.test(result.textureUri)
        || !Number.isFinite(result.width) || result.width <= 0 || !Number.isFinite(result.height) || result.height <= 0
        || !Number.isFinite(textureScale) || textureScale < 1 || textureScale > 3
        || !/^#[\da-f]{6}$/i.test(result.primary)) return null;
      return Object.freeze({ sourceUri: local, textureUri: result.textureUri, textureScale, primary: result.primary });
    }).then((result) => {
      if (!active || !current()) return;
      setStored((value) => value.identity !== identity || value.revision !== request.revision ? value
        : { ...value, entry: result ?? value.entry, settled: true,
          textureFailed: result ? false : value.textureFailed,
          textureRevision: value.textureRevision + (result && phase === 'recovery' ? 1 : 0) });
    });
    return () => { active = false; };
  // The immutable request owns the phase; its completion must not schedule
  // another preparation merely because settled/entry changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, state.artworkFailed]);

  const palette = useMemo(() => buildPrimuseAlbumPalette(entry?.primary, mode === 'dark'), [entry?.primary, mode]);
  return { palette, sourceUri: entry?.sourceUri, textureUri: state.textureFailed ? undefined : entry?.textureUri,
    textureScale: entry?.textureScale ?? 1, textureRevision: state.textureRevision,
    ready: !key || state.artworkFailed || !!entry || state.settled,
    onArtworkLoad, onArtworkError, onTextureError };
}
