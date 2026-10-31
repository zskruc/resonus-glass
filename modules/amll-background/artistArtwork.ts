import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type ArtistArtworkResult = {
  /** Blur-only field. Scene opacity belongs to the renderer's single mask. */
  textureUri: string;
  width: number;
  height: number;
  lowerMean: string;
  lowerEdgeMean: string;
  lowerCenterMean: string;
  average: string;
  /** Robust upper-corner scene sample before cover-cropping; clothing stays in the field only. */
  sourceBackground: string;
  /** Uncropped source: row-major 16×16 regional RGB means, 1536 lowercase hex chars. */
  sourceFingerprint: string;
  sourceWidth: number;
  sourceHeight: number;
};

type ArtistArtworkModule = {
  prepareArtistArtwork?: (
    localUri: string, heroAspectRatio: number, extensionRatio: number,
  ) => Promise<ArtistArtworkResult | null>;
};

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<ArtistArtworkModule>('ResonusAmllBackground')
  : null;

/** Local artwork only. Cache/network policy remains with the caller's resolver. */
export async function prepareArtistArtwork(
  localUri: string, heroAspectRatio: number, extensionRatio: number,
): Promise<ArtistArtworkResult | null> {
  if (!native?.prepareArtistArtwork || !/^(file|content):/i.test(localUri) ||
      !Number.isFinite(heroAspectRatio) || heroAspectRatio <= 0 ||
      !Number.isFinite(extensionRatio) || extensionRatio < 0) return null;
  try { return await native.prepareArtistArtwork(localUri, heroAspectRatio, extensionRatio); }
  catch { return null; }
}
