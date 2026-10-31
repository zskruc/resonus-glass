/** One cached static image field and its palette always belong to the same photo/crop. */
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CACHED_COVER } from '@/api/data';
import { getCachedAppleArtistArtwork, resolveAppleArtistArtwork } from '@/lib/appleArtistArtwork';
import { verifyAppleArtistPhoto } from '@/lib/verifyAppleArtistPhoto';
import { profileScopeId, useAuthStore } from '@/store/auth';
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
  useAuthStore((state) => state.auth);
  const profile = profileScopeId();
  const aspect = normalizedRatio(aspectRatio, 1);
  const extension = normalizedRatio(extensionRatio, 0.25, true);
  const cacheOnly = offline || !!uri?.startsWith(CACHED_COVER);
  const source = uri?.startsWith(CACHED_COVER) ? uri.slice(CACHED_COVER.length) : uri;
  const remote = !!source && /^https?:\/\//i.test(source);
  const fullKey = source ? JSON.stringify([profile, source, aspect, extension, 'artist-field-4-exact-1', 'exact']) : undefined;
  const key = source && cacheOnly && remote
    ? JSON.stringify([profile, source, aspect, extension, 'artist-field-4-exact-1', 'local']) : fullKey;
  const policy = useRef<{ uri?: string; profile: string; offline: boolean; artistName?: string; sourceFingerprint?: string }>({ uri, profile, offline, artistName });
  const generation = useRef(0);
  const metadataGeneration = useRef(0);
  const [applied, setApplied] = useState<{ key: string; result: PreparedArtwork | null }>();
  const [metadata, setMetadata] = useState<{ uri: string; profile: string; artistName: string | undefined; sourceFingerprint?: string; backgroundColor: string }>();
  // Offline may reuse a previously prepared full photograph. The reverse
  // would let a lower-size offline fallback suppress the next online upgrade.
  const cached = key ? (cacheOnly && fullKey ? artworks.get(fullKey) : undefined) ?? artworks.get(key) : undefined;
  const entry = cached ?? (applied?.key === key ? applied?.result : undefined);
  const sourceFingerprint = entry?.artwork.sourceFingerprint;
  const official = getCachedAppleArtistArtwork(uri, artistName, sourceFingerprint);
  const artworkBackground = official?.backgroundColor
    ?? (metadata && metadata.profile === profile && metadata.uri === uri && metadata.artistName === artistName
      && metadata.sourceFingerprint === sourceFingerprint ? metadata.backgroundColor : undefined);

  useEffect(() => { policy.current = { uri, profile, offline, artistName, sourceFingerprint }; }, [uri, profile, offline, artistName, sourceFingerprint]);

  useEffect(() => {
    const token = ++generation.current;
    if (!uri || !key) return;
    let active = true;
    void loadArtwork(key, cacheOnly || !remote, async () => {
      const localUri = await resolveArtworkLocalUri(cacheOnly && !uri.startsWith(CACHED_COVER) ? CACHED_COVER + uri : uri, CACHED_COVER, {
        cachePath: (source) => Image.getCachePathAsync(source),
        prefetch: (source) => Image.prefetch(source, 'disk'),
        // The policy is deliberately re-read after asynchronous cache checks.
        allowNetwork: () => profileScopeId() === profile && policy.current.profile === profile
          && policy.current.uri === uri && !policy.current.offline,
      }, { quality: 'exact' });
      if (!localUri || profileScopeId() !== profile || policy.current.uri !== uri
        || remote && !uri.startsWith(CACHED_COVER) && policy.current.offline !== offline) return null;
      const sample = await prepareArtistArtwork(localUri, aspect, extension);
      if (profileScopeId() !== profile || remote && !uri.startsWith(CACHED_COVER) && policy.current.offline !== offline
        || !sample || !/^(?:file|content):/i.test(sample.textureUri)
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
  }, [uri, key, profile, offline, cacheOnly, remote, aspect, extension]);

  useEffect(() => {
    const token = ++metadataGeneration.current;
    if (!uri) return;
    let active = true;
    // Independent public metadata never delays the local photograph/field.
    const permitted = () => profileScopeId() === profile && policy.current.profile === profile
      && policy.current.uri === uri && !policy.current.offline
      && policy.current.artistName === artistName && policy.current.sourceFingerprint === sourceFingerprint;
    void resolveAppleArtistArtwork(uri, artistName, offline, permitted, sourceFingerprint ? {
      sourceFingerprint,
      verify: (candidate, mayContinue) => verifyAppleArtistPhoto(candidate, sourceFingerprint,
        () => permitted() && mayContinue()),
    } : undefined).then((result) => {
      if (active && token === metadataGeneration.current && profileScopeId() === profile && result) {
        setMetadata({ uri, profile, artistName, sourceFingerprint, backgroundColor: result.backgroundColor });
      }
    }).catch(() => { /* Optional metadata failure leaves the photo-derived palette intact. */ });
    return () => { active = false; };
  }, [uri, profile, artistName, offline, sourceFingerprint]);

  const fallback = !key || applied?.key === key ? UNAVAILABLE : PENDING;
  return useMemo(() => {
    if (!entry) return fallback;
    if (!artworkBackground) return entry.artwork;
    return Object.freeze({ ...entry.artwork, palette: buildVoltaArtistPalette({ ...entry.colors, artworkBackground }) });
  }, [entry, artworkBackground, fallback]);
}
