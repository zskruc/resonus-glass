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
import { useRouteImageLease } from '@/components/RouteImageResources';
import { isArtistImageTraceEnabled } from '../../../modules/liquid-glass';

let imageRequestSequence = 0;
function localPhoto(uri?: string) {
  return uri && /^(?:file|content):/i.test(uri) ? uri : undefined;
}
function photoSource(uri: string | undefined, sourceUri: string | undefined, cacheOnly: boolean) {
  if (!uri || cacheOnly || uri.startsWith(CACHED_COVER)) return localPhoto(uri) ?? localPhoto(sourceUri);
  // The processing file may be a smaller cached variant. Its arrival must
  // never replace the logical full-size image in an online photograph view.
  return uri;
}
type ImageRequest = Readonly<{ uri?: string; sequence: number; owner?: ImageRequest; lease?: object }>;
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
  /** The source/field preparation has settled, including an unavailable fallback. */
  prepared?: boolean;
  /** Readiness of the complete current composite, never just its first image. */
  onReadyChange?: (ready: boolean) => void;
  /** Kept for callers of the static navigation copy; layers always switch together. */
  fieldTransition?: number;
  sharpTransition?: number;
  onLayerDisplay?: (layer: 'sharp' | 'field') => void;
  onLayerError?: (layer: 'sharp' | 'field') => void;
}

export const VoltaDetailHeroFade = memo(function VoltaDetailHeroFade({
  uri, sourceUri, textureUri, width, height, imageStyle, cacheOnly = false,
  backgroundColor = 'transparent', extensionHeight = 0, onError,
  blurRadius = 0, prepared = true, onReadyChange, onLayerDisplay, onLayerError,
}: Props) {
  const imageLease = useRouteImageLease();
  const totalHeight = height + extensionHeight;
  const fadeStart = Math.min(0.99, height * 0.52 / Math.max(1, totalHeight));
  const primaryUri = photoSource(uri, sourceUri, cacheOnly);
  const primary = useMemo<ImageRequest>(() => ({ uri: primaryUri, sequence: ++imageRequestSequence, lease: imageLease }),
    [primaryUri, imageLease]);
  const [failedPrimary, setFailedPrimary] = useState<ImageRequest>();
  const fallback = localPhoto(sourceUri);
  const sharpUri = failedPrimary === primary && fallback && fallback !== primaryUri ? fallback : primaryUri;
  const sharp = useMemo<ImageRequest>(() => ({ uri: sharpUri, sequence: ++imageRequestSequence, owner: primary }), [primary, sharpUri]);
  const field = useMemo<ImageRequest>(() => ({ uri: textureUri, sequence: ++imageRequestSequence, owner: primary }), [primary, textureUri]);
  const live = useRef<{ sharp: ImageRequest; field: ImageRequest; active: boolean } | undefined>(undefined);
  const [shown, setShown] = useState<{ request: ImageRequest; failed: boolean }>();
  const [shownField, setShownField] = useState<{ request: ImageRequest; failed: boolean }>();
  useLayoutEffect(() => {
    live.current = { sharp, field, active: imageLease.active };
    return () => { live.current = undefined; };
  }, [sharp, field, imageLease]);
  useLayoutEffect(() => { if (sharp.uri) imageTrace(sharp, 'sharp', 'requested'); }, [sharp]);
  const ready = imageLease.active && prepared && (!sharpUri || shown?.request === sharp)
    && (!textureUri || shownField?.request === field);
  useLayoutEffect(() => {
    if (live.current?.sharp === sharp && live.current.field === field
      && live.current.active === imageLease.active) onReadyChange?.(ready);
  }, [sharp, field, imageLease, ready, onReadyChange]);
  const sharpDisplayed = () => {
    if (!live.current?.active || live.current.sharp !== sharp) return;
    setShown((previous) => previous?.request === sharp && !previous.failed ? previous : { request: sharp, failed: false });
    imageTrace(sharp, 'sharp', 'displayed');
    onLayerDisplay?.('sharp');
  };
  const sharpFailed = () => {
    if (!live.current?.active || live.current.sharp !== sharp) return;
    imageTrace(sharp, 'sharp', 'failed');
    if (sharpUri === primaryUri) setFailedPrimary(primary);
    if (sharpUri === primaryUri && fallback && fallback !== primaryUri) {
      return;
    }
    setShown({ request: sharp, failed: true });
    onError?.();
    onLayerError?.('sharp');
  };
  const fieldDisplayed = () => {
    if (!live.current?.active || live.current.field !== field) return;
    setShownField((previous) => previous?.request === field && !previous.failed ? previous : { request: field, failed: false });
    imageTrace(field, 'field', 'displayed');
    onLayerDisplay?.('field');
  };
  const fieldFailed = () => {
    if (!live.current?.active || live.current.field !== field) return;
    setShownField({ request: field, failed: true });
    imageTrace(field, 'field', 'failed');
    onLayerError?.('field');
  };
  if (!imageLease.active) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0,
      width, height: totalHeight, backgroundColor, overflow: 'hidden', opacity: ready ? 1 : 0 }}>
      <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS
        style={[{ width, height: totalHeight }, imageStyle]}>
        <MaskedView androidRenderingMode="hardware" style={{ width, height: totalHeight }} maskElement={
          <LinearGradient colors={['#FFFFFFFF', '#FFFFFFFF', '#FFFFFF00']}
            locations={[0, fadeStart, 1]} style={StyleSheet.absoluteFill} />
        }>
        {/* Decode both layers while hidden. Expo Image's onDisplay signals
            drawable assignment even at opacity 0, so neither waits for the other.
            One outer gate reveals the completed photograph and its feather. */}
        {textureUri ? (
          <Image key={field.sequence} source={{ uri: textureUri }} recyclingKey={textureUri}
            cachePolicy="memory-disk" contentFit="fill" transition={0} blurRadius={blurRadius}
            onLoad={(event) => { if (live.current?.active && live.current.field === field) imageTrace(field, 'field', 'loaded', ` width=${event.source.width} height=${event.source.height} cache=${event.cacheType}`); }}
            onDisplay={fieldDisplayed} onError={fieldFailed}
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
            <Image key={sharp.sequence} source={{ uri: sharpUri }} recyclingKey={sharpUri}
              cachePolicy="memory-disk" priority="high"
              contentFit="cover" transition={0} blurRadius={blurRadius}
              onLoad={(event) => { if (live.current?.active && live.current.sharp === sharp) imageTrace(sharp, 'sharp', 'loaded', ` width=${event.source.width} height=${event.source.height} cache=${event.cacheType}`); }}
              onDisplay={sharpDisplayed} onError={sharpFailed}
              style={{ width, height }} />
          </MaskedView>
        ) : null}
        </MaskedView>
      </Animated.View>
    </View>
  );
});
