/** A static, cache-only copy of the very photograph scrolling beneath the bar. */
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { artistHeaderCopyGeometry, artistHeaderLocalSource, artistPhotoParallax } from '@/lib/artistHeaderTransition';
import { VoltaDetailHeroFade } from './VoltaDetailHeroFade';

interface Props {
  color: string;
  height: number;
  width: number;
  photoHeight: number;
  extensionHeight: number;
  uri?: string;
  sourceUri?: string;
  textureUri?: string;
  scrollY: SharedValue<number>;
  opacity: SharedValue<number>;
}

export const VoltaArtistHeaderBackdrop = memo(function VoltaArtistHeaderBackdrop({ color, height, width,
  photoHeight, extensionHeight, uri, sourceUri, textureUri, scrollY, opacity }: Props) {
  const source = artistHeaderLocalSource(sourceUri);
  const texture = artistHeaderLocalSource(textureUri);
  const small = artistHeaderCopyGeometry(width, photoHeight, extensionHeight, PixelRatio.get());
  const identity = JSON.stringify([source, texture, width, photoHeight, extensionHeight, small.scale]);
  const request = useMemo(() => ({ identity }), [identity]);
  const live = useRef<typeof request | undefined>(undefined);
  const [displayed, setDisplayed] = useState<{ request: typeof request; layers: number; failed: boolean }>();
  useLayoutEffect(() => { live.current = request; return () => { live.current = undefined; }; }, [request]);
  const expected = (source ? 1 : 0) | (texture ? 2 : 0);
  // Never cover a pending/failed photo with a flat palette. Let the real page
  // show through until this same-source, fully decoded composite is available.
  const ready = expected ? (!uri || !!source) && displayed?.request === request && !displayed.failed && displayed.layers === expected : !uri;
  const layerDisplay = (layer: 'sharp' | 'field') => {
    if (live.current !== request) return;
    setDisplayed((previous) => ({ request,
      layers: (previous?.request === request ? previous.layers : 0) | (layer === 'sharp' ? 1 : 2),
      failed: previous?.request === request && previous.failed }));
  };
  const layerError = () => {
    if (live.current === request) setDisplayed({ request, layers: 0, failed: true });
  };
  const fade = useAnimatedStyle(() => ({ opacity: ready ? opacity.get() : 0 }), [ready, opacity]);
  const position = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollY.get() }],
  }), [scrollY]);
  const parallax = useAnimatedStyle(() => ({
    transform: [{ translateY: artistPhotoParallax(scrollY.get(), photoHeight) * small.scale }],
  }), [scrollY, photoHeight, small.scale]);
  // Match both the page's outer clip and the photo's inner parallax. Only
  // transforms change; their static masks stay <=240 physical pixels wide.
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={[styles.frame, { width, height: height + 56 }, fade]}>
    <MaskedView androidRenderingMode="hardware" style={StyleSheet.absoluteFill} maskElement={
      <LinearGradient colors={['#FFFFFFFF', '#FFFFFFFF', '#FFFFFF00']}
        locations={[0, height / (height + 56), 1]} style={StyleSheet.absoluteFill} />
    }>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
      <Animated.View style={[styles.photo, position]}>
        <View style={{ width: small.width, height: small.photoHeight + small.extensionHeight,
          transformOrigin: 'top left', transform: [{ scale: 1 / small.scale }] }}>
          <VoltaDetailHeroFade key={identity} uri={undefined} sourceUri={source} textureUri={texture}
            width={small.width} height={small.photoHeight} extensionHeight={small.extensionHeight}
            imageStyle={parallax} backgroundColor={color} blurRadius={2} fieldTransition={0} sharpTransition={0}
            onLayerDisplay={layerDisplay} onLayerError={layerError} />
        </View>
      </Animated.View>
    </MaskedView>
  </Animated.View>;
});

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, left: 0, overflow: 'hidden' },
  photo: { position: 'absolute', top: 0, left: 0 },
});
