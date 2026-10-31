/** One cached static image field and its palette always belong to the same photo/crop. */
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CACHED_COVER } from '@/api/data';
import { getCachedAppleArtistArtwork, resolveAppleArtistArtwork } from '@/lib/appleArtistArtwork';
import { verifyAppleArtistPhoto } from '@/lib/verifyAppleArtistPhoto';
import { buildVoltaArtistPalette, pickVoltaArtistSeed, VOLTA_ARTIST_FALLBACK,
  VOLTA_ARTIST_PALETTE_CACHE_LIMIT, type ArtistImageColors, type VoltaArtistPalette } from '@/lib/voltaArtistPalette';
import { prepareArtistArtwork } from '../../modules/amll-background/artistArtwork';
import { resolveArtworkLocalUri } from '../../modules/amll-background/artworkSource';

export interface VoltaArtistArtwork {
  palette: VoltaArtistPalette;
  /** The exact local photograph used to prepare this palette/field pair. */
  sourceUri?: string;
  textureUri?: string;
  /** Content proof for verifying official metadata behind opaque server image URLs. */
  sourceFingerprint?: string;
  /** The current request has completed, including a safe unavailable/failure fallback. */
  ready: boolean;
}

const PENDING: VoltaArtistArtwork = Object.freeze({ palette: VOLTA_ARTIST_FALLBACK, ready: false });
const UNAVAILABLE: VoltaArtistArtwork = Object.freeze({ palette: VOLTA_ARTIST_FALLBACK, ready: true });
type PreparedArtwork = Readonly<{ artwork: VoltaArtistArtwork; colors: ArtistImageColors }>;
const artworks = new Map<string, PreparedArtwork>();
const pending = new Map<string, Promise<PreparedArtwork | null>>();

function normalizedRatio(value: number, fallback: number, allowZero = false): number {
  return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)
    ? Math.max(allowZero ? 0 : 0.0001, Math.round(value * 10000) / 10000) : fallback;
}

function cachedArtwork(key: string): PreparedArtwork | undefined {
  const cached = artworks.get(key);
  if (cached) { artworks.delete(key); artworks.set(key, cached); }
  return cached;
}

function sameArtwork(first: PreparedArtwork, second: PreparedArtwork): boolean {
  return first.artwork.sourceUri === second.artwork.sourceUri && first.artwork.textureUri === second.artwork.textureUri
    && first.artwork.sourceFingerprint === second.artwork.sourceFingerprint
    && (['sourceBackground', 'lowerMean', 'lowerEdgeMean', 'lowerCenterMean', 'average'] as const).every((role) => first.colors[role] === second.colors[role]);
}

function loadArtwork(key: string, cacheOnly: boolean, read: () => Promise<PreparedArtwork | null>): Promise<PreparedArtwork | null> {
  const cached = cachedArtwork(key);
  // An offline consumer must never initiate a new network-capable request by
  // sharing a resolver whose policy belongs to another online component.
  const pendingKey = `${key}|${cacheOnly ? 'local' : 'online'}`;
  const previous = pending.get(pendingKey);
  if (previous) return previous;
  // Revisit validation is cheap in native's disk/memory cache. The JS cache
  // may outlive an evicted PNG, so it must not skip this effect-owned check.
  const request = Promise.resolve().then(read).catch(() => null).then((result) => {
    if (result) {
      const previous = artworks.get(key);
      if (previous && sameArtwork(previous, result)) result = previous;
      artworks.set(key, result);
      while (artworks.size > VOLTA_ARTIST_PALETTE_CACHE_LIMIT) artworks.delete(artworks.keys().next().value!);
    } else if (artworks.get(key) === cached) artworks.delete(key);
    return result;
  }).finally(() => {
    if (pending.get(pendingKey) === request) pending.delete(pendingKey);
  });
  pending.set(pendingKey, request);
  return request;
}

export function useVoltaArtistArtwork(uri?: string, offline = false, aspectRatio = 1, extensionRatio = 0.25, artistName?: string): VoltaArtistArtwork {
  const aspect = normalizedRatio(aspectRatio, 1);
  const extension = normalizedRatio(extensionRatio, 0.25, true);
  const key = uri ? JSON.stringify([uri, aspect, extension, 'artist-field-4']) : undefined;
  const policy = useRef<{ uri?: string; offline: boolean; artistName?: string; sourceFingerprint?: string }>({ uri, offline, artistName });
  const generation = useRef(0);
  const metadataGeneration = useRef(0);
  const [applied, setApplied] = useState<{ key: string; result: PreparedArtwork | null }>();
  const [metadata, setMetadata] = useState<{ uri: string; artistName: string | undefined; sourceFingerprint?: string; backgroundColor: string }>();
  const cached = key ? artworks.get(key) : undefined;
  const entry = cached ?? (applied?.key === key ? applied?.result : undefined);
  const sourceFingerprint = entry?.artwork.sourceFingerprint;
  const official = getCachedAppleArtistArtwork(uri, artistName, sourceFingerprint);
  const artworkBackground = official?.backgroundColor
    ?? (metadata && metadata.uri === uri && metadata.artistName === artistName
      && metadata.sourceFingerprint === sourceFingerprint ? metadata.backgroundColor : undefined);

  useEffect(() => { policy.current = { uri, offline, artistName, sourceFingerprint }; }, [uri, offline, artistName, sourceFingerprint]);

  useEffect(() => {
    const token = ++generation.current;
    if (!uri || !key) return;
    let active = true;
    void loadArtwork(key, offline || uri.startsWith(CACHED_COVER), async () => {
      const localUri = await resolveArtworkLocalUri(uri, CACHED_COVER, {
        cachePath: (source) => Image.getCachePathAsync(source),
        prefetch: (source) => Image.prefetch(source, 'disk'),
        // The policy is deliberately re-read after asynchronous cache checks.
        allowNetwork: () => policy.current.uri === uri && !policy.current.offline,
      });
      if (!localUri) return null;
      const sample = await prepareArtistArtwork(localUri, aspect, extension);
      if (!sample || !/^(?:file|content):/i.test(sample.textureUri)
        || !(sample.width > 0) || !(sample.height > 0) || !pickVoltaArtistSeed(sample)) return null;
      const colors = Object.freeze({ sourceBackground: sample.sourceBackground,
        lowerMean: sample.lowerMean, lowerEdgeMean: sample.lowerEdgeMean,
        lowerCenterMean: sample.lowerCenterMean, average: sample.average });
      return Object.freeze({ colors, artwork: Object.freeze({ palette: buildVoltaArtistPalette(colors),
        sourceUri: localUri, textureUri: sample.textureUri,
        sourceFingerprint: /^[\da-f]{1536}$/i.test(sample.sourceFingerprint) ? sample.sourceFingerprint : undefined,
        ready: true }) });
    }).then((result) => {
      if (active && token === generation.current) setApplied({ key, result });
    });
    return () => { active = false; };
  }, [uri, key, offline, aspect, extension]);

  useEffect(() => {
    const token = ++metadataGeneration.current;
    if (!uri) return;
    let active = true;
    // Independent public metadata never delays the local photograph/field.
    const permitted = () => policy.current.uri === uri && !policy.current.offline
      && policy.current.artistName === artistName && policy.current.sourceFingerprint === sourceFingerprint;
    void resolveAppleArtistArtwork(uri, artistName, offline, permitted, sourceFingerprint ? {
      sourceFingerprint,
      verify: (candidate, mayContinue) => verifyAppleArtistPhoto(candidate, sourceFingerprint,
        () => permitted() && mayContinue()),
    } : undefined).then((result) => {
      if (active && token === metadataGeneration.current && result) {
        setMetadata({ uri, artistName, sourceFingerprint, backgroundColor: result.backgroundColor });
      }
    }).catch(() => { /* Optional metadata failure leaves the photo-derived palette intact. */ });
    return () => { active = false; };
  }, [uri, artistName, offline, sourceFingerprint]);

  const fallback = !key || applied?.key === key ? UNAVAILABLE : PENDING;
  return useMemo(() => {
    if (!entry) return fallback;
    if (!artworkBackground) return entry.artwork;
    return Object.freeze({ ...entry.artwork, palette: buildVoltaArtistPalette({ ...entry.colors, artworkBackground }) });
  }, [entry, artworkBackground, fallback]);
}
