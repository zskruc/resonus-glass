/**
 * A static, photo-derived artist backdrop inspired by Volta's artist layout.
 * The lower field is prepared once from the same crop as the sharp photo.
 * Its real edge extension and progressive 2D blur replace stretched stripes.
 */
import MaskedView from '@react-native-masked-view/masked-view';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';

import { CACHED_COVER } from '@/api/data';

interface Props {
  uri: string | undefined;
  /** The exact cached local photograph used to generate the field. */
  sourceUri?: string;
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
  onLayerDisplay?: (layer: 'sharp' | 'field') => void;
  onLayerError?: (layer: 'sharp' | 'field') => void;
}

export const VoltaDetailHeroFade = memo(function VoltaDetailHeroFade({
  uri, sourceUri, textureUri, width, height, imageStyle,
  backgroundColor = 'transparent', extensionHeight = 0, onError,
  blurRadius = 0, fieldTransition = 160, onLayerDisplay, onLayerError,
}: Props) {
  const totalHeight = height + extensionHeight;
  const fadeStart = Math.min(0.99, height * 0.52 / Math.max(1, totalHeight));
  // Cache-only markers are never handed to an image loader as network URLs.
  const sharpUri = sourceUri ?? (uri?.startsWith(CACHED_COVER) ? undefined : uri);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0,
      width, height: totalHeight, backgroundColor, overflow: 'hidden' }}>
      <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS
        style={[{ width, height: totalHeight }, imageStyle]}>
        <MaskedView androidRenderingMode="hardware" style={{ width, height: totalHeight }} maskElement={
          <LinearGradient colors={['#FFFFFFFF', '#FFFFFFFF', '#FFFFFF00']}
            locations={[0, fadeStart, 1]} style={StyleSheet.absoluteFill} />
        }>
        {textureUri ? (
          <Image source={{ uri: textureUri }} recyclingKey={textureUri}
            contentFit="fill" transition={fieldTransition} blurRadius={blurRadius}
            onDisplay={onLayerDisplay ? () => onLayerDisplay('field') : undefined}
            onError={onLayerError ? () => onLayerError('field') : undefined}
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
            <Image source={{ uri: sharpUri }} recyclingKey={uri}
              contentFit="cover" transition={0} blurRadius={blurRadius}
              onDisplay={onLayerDisplay ? () => onLayerDisplay('sharp') : undefined}
              onError={onError || onLayerError ? () => { onError?.(); onLayerError?.('sharp'); } : undefined}
              style={{ width, height }} />
          </MaskedView>
        ) : null}
        </MaskedView>
      </Animated.View>
    </View>
  );
});
