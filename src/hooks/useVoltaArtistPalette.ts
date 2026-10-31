/** Palette extraction owned by the displayed artist photo, never by scrolling. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';

import { CACHED_COVER, COVER } from '@/api/data';
import { buildVoltaArtistPalette, VOLTA_ARTIST_FALLBACK, VoltaArtistPaletteCache,
  type ArtistImageColors, type VoltaArtistPalette } from '@/lib/voltaArtistPalette';

const FAILURE_COLOR = '#010203';

function colorRoles(result: ArtistImageColors | undefined | null): ArtistImageColors | null {
  if (!result) return null;
  const roles: ArtistImageColors = { platform: result.platform };
  for (const key of ['background', 'dominant', 'average', 'muted', 'darkMuted', 'primary'] as const) {
    const color = (result as unknown as Record<string, unknown>)[key];
    if (typeof color === 'string' && color.toLowerCase() !== FAILURE_COLOR) roles[key] = color;
  }
  return roles;
}

async function readArtistColors(uri: string): Promise<ArtistImageColors | null> {
  const { getColors, cache } = await import('react-native-image-colors');
  // Reuse a native raw palette that an existing cover consumer already read.
  // New artist results stay in our bounded cache instead of the dependency's
  // unbounded process-global dictionary.
  const result = cache.getItem(uri) ?? await getColors(uri, { fallback: FAILURE_COLOR, cache: false, quality: 'low', pixelSpacing: 10 });
  return colorRoles(result);
}

async function readOfflineArtistColors(source: string, displayedUri: string): Promise<ArtistImageColors | null> {
  const { cache } = await import('react-native-image-colors');
  const shared = cache.getItem(source) ?? cache.getItem(displayedUri);
  if (shared) return colorRoles(shared);
  if (/^(?:file:|content:|data:image\/)/.test(displayedUri) || displayedUri.startsWith('/')) return readArtistColors(displayedUri);
  // A remote portrait can still be visible while the profile is offline.
  // Cache inspection never fetches it; only a confirmed local file is decoded.
  const paths = await Promise.all([...new Set([displayedUri, source])].map((uri) => Image.getCachePathAsync(uri).catch(() => undefined)));
  const path = paths.find(Boolean);
  return path ? readArtistColors(path.startsWith('file://') ? path : `file://${path}`) : null;
}

const palettes = new VoltaArtistPaletteCache(readArtistColors);

export function useVoltaArtistPalette(uri?: string, offline = false): VoltaArtistPalette {
  // Subsonic/Jellyfin permit a small copy of exactly the same picture. External
  // photo URLs are kept intact: arbitrary CDN path rewriting can select a
  // different photo or fail; those are sampled once and then cached by URI.
  const source = uri && !uri.startsWith(CACHED_COVER)
    ? uri.replace(/([?&](?:size|fillWidth|fillHeight)=)\d+/g, (_match, prefix: string) => `${prefix}${COVER.thumb}`)
    : undefined;
  const cached = source ? palettes.peek(source) : undefined;
  const [applied, setApplied] = useState<{ source: string; sample: ArtistImageColors }>();
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    if (!source) return;
    let active = true;
    void palettes.load(source, offline ? (key) => readOfflineArtistColors(key, uri!) : undefined).then((sample) => {
      if (active && token === generation.current && sample && sample !== cached) setApplied({ source, sample });
    });
    return () => { active = false; };
  }, [source, uri, offline, cached]);
  const sample = cached ?? (applied && applied.source === source ? applied.sample : undefined);
  return useMemo(() => sample ? buildVoltaArtistPalette(sample) : VOLTA_ARTIST_FALLBACK, [sample]);
}
