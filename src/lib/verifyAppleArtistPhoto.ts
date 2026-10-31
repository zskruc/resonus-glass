import { Image } from 'expo-image';

import { CACHED_COVER } from '@/api/data';
import { appleArtworkAssetKey, type AppleArtistPhotoCandidate } from '@/lib/appleArtistArtwork';
import { artistPhotoFingerprintsMatch, isArtistPhotoFingerprint } from '@/lib/artistPhotoFingerprint';
import { prepareArtistArtwork } from '../../modules/amll-background/artistArtwork';
import { resolveArtworkLocalUri } from '../../modules/amll-background/artworkSource';

/** Public candidate bytes use the same bounded native sampling as the displayed local photo. */
export async function verifyAppleArtistPhoto(candidate: AppleArtistPhotoCandidate, sourceFingerprint: string,
  allowNetwork: () => boolean): Promise<boolean> {
  if (!isArtistPhotoFingerprint(sourceFingerprint) || appleArtworkAssetKey(candidate.uri) !== candidate.assetKey
    || candidate.width <= 0 || candidate.height <= 0 || Math.max(candidate.width, candidate.height) > 600 || !allowNetwork()) return false;
  const local = await resolveArtworkLocalUri(candidate.uri, CACHED_COVER, {
    cachePath: (uri) => Image.getCachePathAsync(uri), prefetch: (uri) => Image.prefetch(uri, 'disk'), allowNetwork,
  });
  if (!local || !allowNetwork()) return false;
  const prepared = await prepareArtistArtwork(local, 1, 0);
  return !!prepared && allowNetwork() && artistPhotoFingerprintsMatch(sourceFingerprint, prepared.sourceFingerprint);
}
