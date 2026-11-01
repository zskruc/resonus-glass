/** A persistent scene plane: list recycling cannot clip the photo's fading tail. */
import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { artistHeaderPhotoOffset } from '@/lib/artistHeaderTransition';
import { useDetailHeroReporter } from '@/components/DetailHeroScene';
import { VoltaDetailHeroFade } from './VoltaDetailHeroFade';

const STATIC_IMAGE_STYLE = {};

interface Props {
  uri?: string;
  sourceUri?: string;
  textureUri?: string;
  cacheOnly?: boolean;
  prepared?: boolean;
  width: number;
  height: number;
  extensionHeight: number;
  backgroundColor: string;
  scrollY: SharedValue<number>;
  onError?: () => void;
}

export const VoltaArtistScrollBackdrop = memo(function VoltaArtistScrollBackdrop({
  scrollY, width, height, extensionHeight, ...source
}: Props) {
  const reportReady = useDetailHeroReporter();
  // Move the completed photograph, field and static masks together. Moving
  // only their pixels inside a fixed clip would cut a still-visible fade.
  const position = useAnimatedStyle(() => ({
    transform: [{ translateY: artistHeaderPhotoOffset(scrollY.get(), height) }],
  }));
  return <Animated.View pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.plane, { width, height: height + extensionHeight }, position]}>
    <VoltaDetailHeroFade {...source} uri={source.uri} width={width} height={height}
      extensionHeight={extensionHeight} imageStyle={STATIC_IMAGE_STYLE} onReadyChange={reportReady} />
  </Animated.View>;
});

const styles = StyleSheet.create({
  plane: { position: 'absolute', top: 0, left: 0 },
});
