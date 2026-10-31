/** Verified optional artist-title PNGs; ordinary names remain the fallback. */
import { Image, type ImageRef } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';

import { CACHED_COVER } from '@/api/data';
import { appleArtworkAssetKey, getCachedAppleArtistArtwork, resolveAppleArtistArtwork,
  type AppleArtistNameArtwork } from '@/lib/appleArtistArtwork';
import { isArtistPhotoFingerprint } from '@/lib/artistPhotoFingerprint';
import { verifyAppleArtistPhoto } from '@/lib/verifyAppleArtistPhoto';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { resolveArtworkLocalUri } from '../../modules/amll-background/artworkSource';

type SavedArtwork = Readonly<{ key: string; artistId: string; savedAt: number; artwork: AppleArtistNameArtwork }>;
export type LoadedArtistNameArtwork = Readonly<{ image: ImageRef; width: number; height: number }>;
const MAX_ENTRIES = 64;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const metadataFile = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}resonus-artist-name-artwork-v1.json` : undefined;
const records = new Map<string, SavedArtwork>();
let hydration: Promise<void> | undefined;
let writes = Promise.resolve();

function cacheKey(uri?: string, name?: string, sourceFingerprint?: string): string | undefined {
  const asset = appleArtworkAssetKey(uri);
  const normalized = name?.normalize('NFKC').trim().toLowerCase();
  const identity = asset ?? (isArtistPhotoFingerprint(sourceFingerprint) ? `fingerprint:${sourceFingerprint.toLowerCase()}` : undefined);
  return uri && identity && normalized && normalized.length <= 160 ? JSON.stringify([normalized, identity]) : undefined;
}

function validArtwork(value: unknown): value is AppleArtistNameArtwork {
  if (!value || typeof value !== 'object') return false;
  const art = value as AppleArtistNameArtwork;
  if (typeof art.uri !== 'string' || art.uri.length > 4096 || !Number.isInteger(art.width) || !Number.isInteger(art.height)
    || art.width <= 0 || art.height <= 0 || art.width > 30_000 || art.height > 30_000) return false;
  try {
    const url = new URL(art.uri);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && /(?:^|\.)mzstatic\.com$/i.test(url.hostname) && url.pathname.endsWith('.png');
  } catch { return false; }
}

function remember(record: SavedArtwork) {
  records.delete(record.key); records.set(record.key, record);
  while (records.size > MAX_ENTRIES) records.delete(records.keys().next().value!);
}

function hydrate(): Promise<void> {
  return hydration ??= (async () => {
    if (!metadataFile) return;
    try {
      const source = await FileSystem.readAsStringAsync(metadataFile);
      if (source.length > 256_000) return;
      const saved = JSON.parse(source);
      if (saved?.version !== 1 || !Array.isArray(saved.records)) return;
      for (const row of saved.records.slice(-MAX_ENTRIES)) {
        if (typeof row?.key !== 'string' || row.key.length > 2048 || !/^\d{1,20}$/.test(row.artistId)
          || !Number.isFinite(row.savedAt) || !validArtwork(row.artwork)) continue;
        const identity = JSON.parse(row.key);
        if (!Array.isArray(identity) || identity.length !== 2 || typeof identity[0] !== 'string'
          || typeof identity[1] !== 'string' || (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(identity[1])
            && !(identity[1].startsWith('fingerprint:') && isArtistPhotoFingerprint(identity[1].slice(12))))) continue;
        remember(Object.freeze({ key: row.key, artistId: row.artistId, savedAt: row.savedAt,
          artwork: Object.freeze({ ...row.artwork }) }));
      }
    } catch { /* Missing/evicted optional metadata retains plain artist text. */ }
  })();
}

function persist() {
  if (!metadataFile) return;
  // Serial writes keep rapid artist switches from saving an older snapshot.
  writes = writes.catch(() => {}).then(() => FileSystem.writeAsStringAsync(metadataFile,
    JSON.stringify({ version: 1, records: [...records.values()] }))).catch(() => {});
}

/** The ThumbHash alpha header rejects opaque, empty or uniform decoded masks. */
function usableMask(value: string): boolean {
  try {
    if (value.length > 128) return false;
    const bytes = globalThis.atob(value);
    return bytes.length >= 20 && !!(bytes.charCodeAt(2) & 128)
      && (bytes.charCodeAt(5) & 15) < 15 && (bytes.charCodeAt(5) >> 4) > 0;
  } catch { return false; }
}

export function useAppleArtistNameArtwork(uri?: string, artistName?: string, offline = false,
  sourceFingerprint?: string): LoadedArtistNameArtwork | undefined {
  useAuthStore((state) => state.auth);
  const profile = profileScopeId();
  const key = cacheKey(uri, artistName, sourceFingerprint);
  const binding = key ? JSON.stringify([key, uri, offline, profile]) : undefined;
  const policy = useRef({ binding, offline });
  const generation = useRef(0);
  const [loaded, setLoaded] = useState<{ binding: string; value: LoadedArtistNameArtwork }>();
  useEffect(() => { policy.current = { binding, offline }; }, [binding, offline]);
  useEffect(() => {
    const token = ++generation.current;
    if (!key || !binding || !uri) return;
    let active = true;
    let owned: ImageRef | undefined;
    const allowNetwork = () => active && policy.current.binding === binding && !policy.current.offline
      && !uri.startsWith(CACHED_COVER) && profileScopeId() === profile;
    void (async () => {
      await hydrate();
      if (!active) return;
      let saved = records.get(key);
      if (!saved || !offline && Date.now() - saved.savedAt > MAX_AGE) {
        const metadata = getCachedAppleArtistArtwork(uri, artistName, sourceFingerprint)
          ?? await resolveAppleArtistArtwork(uri, artistName, offline, allowNetwork,
            isArtistPhotoFingerprint(sourceFingerprint) ? { sourceFingerprint,
              verify: (candidate, mayContinue) => verifyAppleArtistPhoto(candidate, sourceFingerprint,
                () => allowNetwork() && mayContinue()) } : undefined);
        if (!active || token !== generation.current || profileScopeId() !== profile) return;
        if (metadata) {
          if (!metadata.nameArtwork || !validArtwork(metadata.nameArtwork)) {
            if (records.delete(key)) persist();
            return;
          }
          saved = Object.freeze({ key, artistId: metadata.artistId, savedAt: Date.now(), artwork: metadata.nameArtwork });
          remember(saved); persist();
        }
      }
      if (!saved || !active || profileScopeId() !== profile) return;
      const local = await resolveArtworkLocalUri(saved.artwork.uri, CACHED_COVER, {
        cachePath: (source) => Image.getCachePathAsync(source),
        prefetch: (source) => Image.prefetch(source, 'disk'), allowNetwork,
      });
      if (!local || !active) return;
      // Retain the official silver/color texture. A template tint would erase it.
      const image = await Image.loadAsync(local, { maxWidth: 1000, maxHeight: 400 });
      let accepted = false;
      try {
        if (image.isAnimated || !usableMask(await Image.generateThumbhashAsync(image))) return;
        if (!active || token !== generation.current || profileScopeId() !== profile) return;
        accepted = true; owned = image;
        setLoaded({ binding, value: Object.freeze({ image, width: saved.artwork.width, height: saved.artwork.height }) });
      } finally { if (!accepted) image.release(); }
    })().catch(() => { /* A failed optional logo never hides the artist's name. */ });
    return () => { active = false; owned?.release(); owned = undefined; };
  }, [key, binding, uri, artistName, offline, sourceFingerprint, profile]);
  return loaded?.binding === binding ? loaded?.value : undefined;
}
