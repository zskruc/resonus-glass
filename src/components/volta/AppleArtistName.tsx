/** The existing text owns layout/accessibility; verified title artwork is an overlay. */
import { Image, type ImageRef } from 'expo-image';
import { useLayoutEffect, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { useAppleArtistNameArtwork } from '@/hooks/useAppleArtistNameArtwork';
import { artistNameVisualFrame } from '@/lib/artistHeaderTransition';

interface Props {
  name: string;
  uri?: string;
  offline: boolean;
  sourceFingerprint?: string;
  width: number;
  bottomPadding: number;
  artworkAspect?: SharedValue<number>;
  textStyle: ComponentProps<typeof Text>['style'];
  animationStyle: ComponentProps<typeof Animated.View>['style'];
  onLayout: (event: LayoutChangeEvent) => void;
}

export function AppleArtistName({ name, uri, offline, sourceFingerprint, width, bottomPadding, artworkAspect,
  textStyle, animationStyle, onLayout }: Props) {
  const loaded = useAppleArtistNameArtwork(uri, name, offline, sourceFingerprint);
  const [failed, setFailed] = useState<ImageRef>();
  const [layout, setLayout] = useState({ y: 0, height: 0 });
  // ImageRef already owns validated, decoded pixels. Waiting for an onDisplay
  // bridge event while painting it necessarily exposes the plain name too.
  const shown = !!loaded && failed !== loaded.image;
  const aspect = shown ? loaded.width / loaded.height : 0;
  useLayoutEffect(() => { artworkAspect?.set(aspect); }, [artworkAspect, aspect]);
  // Image children must receive a real Yoga layout, not UI-runtime-only width
  // changes. Only the enclosing opacity participates in the scroll animation.
  const visual = artistNameVisualFrame(layout, width, bottomPadding, aspect);
  const frame = { left: visual.x, top: visual.y - layout.y, width: visual.width, height: visual.height };
  const origin = { top: layout.y, height: layout.height, opacity: layout.height > 0 ? 1 : 0 };
  const measure = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setLayout((previous) => previous.y === y && previous.height === height ? previous : { y, height });
    // The screen still publishes the same measurement to its header worklet.
    onLayout(event);
  };
  return <>
    <Text pointerEvents="none" onLayout={measure} numberOfLines={2}
      style={[textStyle, styles.ruler]} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name}
    </Text>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, animationStyle]} accessible={false}>
      <View style={[styles.overlay, origin]} accessible importantForAccessibility="yes"
        accessibilityRole="header" accessibilityLabel={name}>
        {shown ? <View style={[styles.artwork, frame]}>
          <Image source={loaded.image} contentFit="contain" transition={0} style={StyleSheet.absoluteFill}
            accessible={false} onError={() => setFailed(loaded.image)} />
        </View> : <Text pointerEvents="none" numberOfLines={2} style={textStyle} accessible={false}>{name}</Text>}
      </View>
    </Animated.View>
  </>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, overflow: 'visible' },
  artwork: { position: 'absolute' },
  ruler: { opacity: 0 },
});
