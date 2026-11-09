/** Presentation candidates only; ownership and the one-fallback budget belong to the route. */
import { CACHED_COVER } from '@/api/data';
import type { PodcastChannel } from '@/api/subsonic';

function artworkUri(input: string | undefined): { uri: string; local: boolean } | undefined {
  if (typeof input !== 'string') return;
  const value = input.trim();
  const cacheOnly = value.startsWith(CACHED_COVER);
  const source = cacheOnly ? value.slice(CACHED_COVER.length) : value;
  if (/[\u0000-\u001f\u007f]/.test(source)) return;
  try {
    const url = new URL(source);
    if (url.username || url.password) return;
    const local = url.protocol === 'file:' || url.protocol === 'content:';
    if (local) {
      // Cache markers describe remote image-cache keys, never local files.
      if (cacheOnly || !/^(?:file|content):\/\//i.test(source) || !url.pathname || url.protocol === 'content:' && !url.host) return;
      return { uri: source, local: true };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    return { uri: cacheOnly ? CACHED_COVER + source : source, local: false };
  } catch { return; }
}

/**
 * Keep the tapped catalog's art ahead of later RSS/cache updates online.
 * Offline, every local file precedes cache-only remote keys; no HTTP request
 * is handed to Cover merely because that image was once shown online.
 */
export function podcastArtworkCandidates(
  channel: Pick<PodcastChannel, 'imageUrl' | 'artFile'>, preferredUri: string | undefined, offline: boolean,
): string[] {
  const candidates = [preferredUri, channel.imageUrl, channel.artFile]
    .map(artworkUri).filter((value): value is NonNullable<typeof value> => value !== undefined);
  const ordered = offline ? [
    ...candidates.filter((value) => value.local).map((value) => value.uri),
    ...candidates.filter((value) => !value.local).map((value) => value.uri.startsWith(CACHED_COVER)
      ? value.uri : CACHED_COVER + value.uri),
  ] : candidates.map((value) => value.uri);
  return [...new Set(ordered)];
}
