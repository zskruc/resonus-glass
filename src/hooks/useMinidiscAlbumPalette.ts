/** One bounded raw artwork read per album; no extraction during scrolling. */
import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { CACHED_COVER, COVER } from '@/api/data';
import { useAuthStore } from '@/store/auth';
import { useThemeMode } from '@/theme';
import { buildMinidiscAlbumPalette } from '@/lib/minidiscAlbumPalette';
import { artworkColorCache } from '@/lib/artworkColorCache';
import { BoundedCache } from '@/lib/boundedCache';

const seeds = new BoundedCache<string, string>(64);
const pending = new Map<string, Promise<string | undefined>>();
const FAILURE = '#010203';

async function readSeed(source: string, displayed: string, offline: boolean): Promise<string | undefined> {
  const { getColors, cache } = await import('react-native-image-colors');
  const shared = artworkColorCache.peek(source);
  const fallback = shared?.fallback ?? FAILURE;
  let sample = shared?.colors ?? cache.getItem(source);
  if (!sample) {
    let local = /^(?:file:|content:|data:image\/)/.test(displayed) ? displayed : undefined;
    if (offline || useAuthStore.getState().offline) {
      const path = local ?? await Image.getCachePathAsync(displayed).catch(() => undefined);
      if (!path) return undefined;
      local = path.startsWith('/') ? `file://${path}` : path;
    }
    // A low-quality seed stays local to Minidisc; it must not replace a
    // full player palette's higher-quality sample in the shared cache.
    sample = await getColors(local ?? source, { fallback: FAILURE, cache: false, quality: 'low', pixelSpacing: 10 });
  }
  const candidates = sample.platform === 'ios' ? [sample.background, sample.primary, sample.secondary]
    : sample.platform === 'android' ? [sample.dominant, sample.average, sample.muted] : [sample.dominant, sample.vibrant];
  return candidates.find((value) => value && value !== fallback && /^#[\da-f]{6}$/i.test(value));
}

export function useMinidiscAlbumPalette(uri?: string, offline = false) {
  const mode = useThemeMode();
  const source = uri && !uri.startsWith(CACHED_COVER)
    ? uri.replace(/([?&](?:size|fillWidth|fillHeight)=)\d+/g, `$1${COVER.thumb}`) : undefined;
  const [resolved, setResolved] = useState<{ source: string; seed: string }>();
  const cached = source ? seeds.get(source) : undefined;
  useEffect(() => {
    if (!source || !uri || cached) return;
    let active = true;
    let request = pending.get(source);
    if (!request) {
      request = readSeed(source, uri, offline).catch(() => undefined);
      pending.set(source, request);
      const owned = request;
      void request.then((seed) => {
        if (seed) {
          seeds.set(source, seed);
        }
      }).finally(() => { if (pending.get(source) === owned) pending.delete(source); });
    }
    void request.then((seed) => { if (active && seed) setResolved({ source, seed }); });
    return () => { active = false; };
  }, [source, uri, cached, offline]);
  const seed = cached ?? (resolved && resolved.source === source ? resolved.seed : undefined);
  return useMemo(() => buildMinidiscAlbumPalette(seed, mode === 'dark'), [seed, mode]);
}
