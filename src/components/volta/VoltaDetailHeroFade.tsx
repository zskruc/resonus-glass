/**
 * A static, photo-derived artist backdrop inspired by Volta's artist layout.
 * The lower field is prepared once from the same crop as the sharp photo.
 * Its real edge extension and progressive 2D blur replace stretched stripes.
 */
import MaskedView from '@react-native-masked-view/masked-view';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';

import { CACHED_COVER } from '@/api/data';
import { isArtistImageTraceEnabled } from '../../../modules/liquid-glass';

// Remember only small identities, never ImageRefs/bitmaps. Glide owns the
// bounded decoded-image cache; a revisit does not need a fixed entry fade.
const displayedPhotos = new Set<string>();
let imageRequestSequence = 0;
function rememberPhoto(uri: string) {
  displayedPhotos.delete(uri);
  displayedPhotos.add(uri);
  while (displayedPhotos.size > 64) displayedPhotos.delete(displayedPhotos.values().next().value!);
}
function localPhoto(uri?: string) {
  return uri && /^(?:file|content):/i.test(uri) ? uri : undefined;
}
function photoSource(uri: string | undefined, sourceUri: string | undefined, cacheOnly: boolean) {
  if (!uri || cacheOnly || uri.startsWith(CACHED_COVER)) return localPhoto(uri) ?? localPhoto(sourceUri);
  // The processing file may be a smaller cached variant. Its arrival must
  // never replace the logical full-size image in an online photograph view.
  return uri;
}
type ImageRequest = Readonly<{ uri?: string; sequence: number; owner?: ImageRequest }>;
function imageTrace(request: ImageRequest, layer: 'sharp' | 'field', event: string, details = '') {
  if (isArtistImageTraceEnabled) console.info(`[ResonusArtistImage] ${layer} ${event} request=${request.sequence} time=${Date.now()}${details}`);
}

interface Props {
  uri: string | undefined;
  /** The exact cached local photograph used to generate the field. */
  sourceUri?: string;
  /** Offline views may use only the prepared local source, never its URL. */
  cacheOnly?: boolean;
  /** Prepared blur field. The common outer mask supplies the only final fade. */
  textureUri?: string;
  width: number;
  height: number;
  extensionHeight?: number;
  imageStyle: AnimatedStyle<ViewStyle>;
  backgroundColor?: string;
  onError?: () => void;
  /** A small static navigation copy may blur its cached photograph at decode. */
  blurRadius?: number;
  fieldTransition?: number;
  /** Navigation's hidden static copy needs no entry animation. */
  sharpTransition?: number;
  onLayerDisplay?: (layer: 'sharp' | 'field') => void;
  onLayerError?: (layer: 'sharp' | 'field') => void;
}

export const VoltaDetailHeroFade = memo(function VoltaDetailHeroFade({
  uri, sourceUri, textureUri, width, height, imageStyle, cacheOnly = false,
  backgroundColor = 'transparent', extensionHeight = 0, onError,
  blurRadius = 0, fieldTransition = 160, sharpTransition, onLayerDisplay, onLayerError,
}: Props) {
  const totalHeight = height + extensionHeight;
  const fadeStart = Math.min(0.99, height * 0.52 / Math.max(1, totalHeight));
  const primaryUri = photoSource(uri, sourceUri, cacheOnly);
  const primary = useMemo<ImageRequest>(() => ({ uri: primaryUri, sequence: ++imageRequestSequence }),
    [primaryUri]);
  const [failedPrimary, setFailedPrimary] = useState<ImageRequest>();
  const fallback = localPhoto(sourceUri);
  const sharpUri = failedPrimary === primary && fallback && fallback !== primaryUri ? fallback : primaryUri;
  const sharp = useMemo<ImageRequest>(() => ({ uri: sharpUri, sequence: ++imageRequestSequence, owner: primary }), [primary, sharpUri]);
  const field = useMemo<ImageRequest>(() => ({ uri: textureUri, sequence: ++imageRequestSequence, owner: primary }), [primary, textureUri]);
  const live = useRef<{ sharp: ImageRequest; field: ImageRequest } | undefined>(undefined);
  const [shown, setShown] = useState<{ request: ImageRequest; failed: boolean }>();
  useLayoutEffect(() => {
    live.current = { sharp, field };
    return () => { live.current = undefined; };
  }, [sharp, field]);
  useLayoutEffect(() => { if (sharp.uri) imageTrace(sharp, 'sharp', 'requested'); }, [sharp]);
  const sharpSettled = shown?.request === sharp;
  // A 240px blur field must not briefly stand in for the whole photograph.
  // After a genuine sharp failure it remains a valid last-resort fallback.
  const showField = !sharpUri || sharpSettled;
  // Freeze this request's animation choice. Its onDisplay event remembers the
  // photo for future requests without changing a fade already in progress.
  const transition = useMemo(() => sharpTransition ?? (sharp.uri && displayedPhotos.has(sharp.uri) ? 0 : 120),
    [sharp, sharpTransition]);
  const sharpDisplayed = () => {
    if (live.current?.sharp !== sharp) return;
    if (sharpUri && sharpTransition === undefined) rememberPhoto(sharpUri);
    setShown((previous) => previous?.request === sharp && !previous.failed ? previous : { request: sharp, failed: false });
    imageTrace(sharp, 'sharp', 'displayed');
    onLayerDisplay?.('sharp');
  };
  const sharpFailed = () => {
    if (live.current?.sharp !== sharp) return;
    imageTrace(sharp, 'sharp', 'failed');
    if (sharpUri === primaryUri) setFailedPrimary(primary);
    if (sharpUri === primaryUri && fallback && fallback !== primaryUri) {
      return;
    }
    setShown({ request: sharp, failed: true });
    onError?.();
    onLayerError?.('sharp');
  };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0,
      width, height: totalHeight, backgroundColor, overflow: 'hidden' }}>
      <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS
        style={[{ width, height: totalHeight }, imageStyle]}>
        <MaskedView androidRenderingMode="hardware" style={{ width, height: totalHeight }} maskElement={
          <LinearGradient colors={['#FFFFFFFF', '#FFFFFFFF', '#FFFFFF00']}
            locations={[0, fadeStart, 1]} style={StyleSheet.absoluteFill} />
        }>
        {textureUri && showField ? (
          <Image source={{ uri: textureUri }} recyclingKey={textureUri}
            cachePolicy="memory-disk" contentFit="fill" transition={fieldTransition} blurRadius={blurRadius}
            onLoad={(event) => { if (live.current?.field === field) imageTrace(field, 'field', 'loaded', ` width=${event.source.width} height=${event.source.height} cache=${event.cacheType}`); }}
            onDisplay={() => { if (live.current?.field === field) { imageTrace(field, 'field', 'displayed'); onLayerDisplay?.('field'); } }}
            onError={() => { if (live.current?.field === field) { imageTrace(field, 'field', 'failed'); onLayerError?.('field'); } }}
            style={{ width, height: totalHeight }} />
        ) : null}
        {sharpUri ? (
          <MaskedView androidRenderingMode="hardware"
            style={{ position: 'absolute', left: 0, top: 0, width, height }} maskElement={
              <LinearGradient
                colors={['#FFFFFFFF', '#FFFFFFFF', '#FFFFFF00']}
                locations={[0, 0.55, 0.85]}
                style={StyleSheet.absoluteFill} />
            }>
            <Image source={{ uri: sharpUri }} recyclingKey={sharpUri}
              cachePolicy="memory-disk" priority="high"
              contentFit="cover" transition={transition} blurRadius={blurRadius}
              onLoad={(event) => { if (live.current?.sharp === sharp) imageTrace(sharp, 'sharp', 'loaded', ` width=${event.source.width} height=${event.source.height} cache=${event.cacheType}`); }}
              onDisplay={sharpDisplayed} onError={sharpFailed}
              style={{ width, height }} />
          </MaskedView>
        ) : null}
        </MaskedView>
      </Animated.View>
    </View>
  );
});
