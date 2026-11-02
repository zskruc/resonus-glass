/** Static local album atmosphere adapted from Primuse (MIT, © 2026 Welape). */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type PrimuseAlbumArtworkResult = {
  textureUri: string;
  width: number;
  height: number;
  /** Transparent Gaussian halo expands the core artwork around its unchanged center. */
  textureScale: number;
  /** Primuse's chromatic accent; achromatic artwork uses #000000 as neutral. */
  primary: string;
};

type AlbumArtworkModule = {
  preparePrimuseAlbumArtwork?: (localUri: string, blurRatio: number) => Promise<PrimuseAlbumArtworkResult | null>;
};

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<AlbumArtworkModule>('ResonusAmllBackground') : null;

/** The caller resolves cache/network policy; native never opens a remote URI. */
export async function preparePrimuseAlbumArtwork(
  localUri: string, blurRatio: number,
): Promise<PrimuseAlbumArtworkResult | null> {
  if (!native?.preparePrimuseAlbumArtwork || !/^(file|content):/i.test(localUri) ||
      !Number.isFinite(blurRatio) || blurRatio < 0 || blurRatio > 0.25) return null;
  try { return await native.preparePrimuseAlbumArtwork(localUri, blurRatio); }
  catch { return null; }
}
