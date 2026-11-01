import type { ImageColorsResult } from 'react-native-image-colors';

import { BoundedCache } from './boundedCache';

export const ARTWORK_COLOR_CACHE_LIMIT = 256;
type Sample = Readonly<{ colors: ImageColorsResult; fallback: string }>;

/** Share small raw palettes across appearances without the dependency's unlimited dictionary. */
export function createArtworkColorCache(capacity = ARTWORK_COLOR_CACHE_LIMIT) {
  const completed = new BoundedCache<string, Sample>(capacity);
  const pending = new Map<string, Promise<Sample | null>>();
  return {
    peek: (source: string) => completed.get(source),
    load(source: string, fallback: string, read: () => Promise<ImageColorsResult | null>): Promise<Sample | null> {
      const cached = completed.get(source);
      if (cached) return Promise.resolve(cached);
      const previous = pending.get(source);
      if (previous) return previous;
      const request = Promise.resolve().then(read).then((colors) => {
        if (!colors) return null;
        // Keep the original reader's sentinel when another appearance joins.
        const sample = Object.freeze({ colors, fallback });
        completed.set(source, sample);
        return sample;
      }).finally(() => { if (pending.get(source) === request) pending.delete(source); });
      pending.set(source, request);
      return request;
    },
  };
}

export const artworkColorCache = createArtworkColorCache();
