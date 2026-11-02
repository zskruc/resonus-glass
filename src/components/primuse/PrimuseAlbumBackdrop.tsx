/** Static album texture with Primuse's cover-centred opacity envelope. */
import MaskedView from '@react-native-masked-view/masked-view';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useRouteImageLease } from '@/components/RouteImageResources';
import { primuseAlbumWindow, type primuseAlbumLayout } from '@/lib/primuseAlbumLayout';
import { usePrimuseAlbumScene } from './PrimuseAlbumScene';

export const PrimuseAlbumBackdrop = memo(function PrimuseAlbumBackdrop({ textureUri, textureScale = 1, textureRevision = 0, onTextureError,
  width, height, layout, scrollY, topExtension = 0 }: {
  textureUri?: string; textureScale?: number; width: number; height: number;
  textureRevision?: number; onTextureError?: (uri: string) => void;
  topExtension?: number;
  layout: ReturnType<typeof primuseAlbumLayout>; scrollY: SharedValue<number>;
}) {
  const lease = useRouteImageLease();
  const scene = usePrimuseAlbumScene();
  const position = useAnimatedStyle(() => ({ transform: [{ translateY: -scrollY.get() }] }));
  if (!lease.active || !textureUri || height <= 0) return null;
  const imageSide = layout.backdropSide * textureScale;
  // The search row pushes the cover down. Keep its already-blurred texture
  // visible above that row's lower edge instead of cutting it at a rectangle.
  // The window changes only on reveal/collapse, never on animation frames.
  const window = primuseAlbumWindow(height, layout.coverCenterY + layout.coverSide / 2, topExtension);
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={[styles.plane, { width, height: window.height, top: window.top }, position]}>
    <MaskedView style={StyleSheet.absoluteFill} androidRenderingMode="hardware"
      maskElement={<LinearGradient style={StyleSheet.absoluteFill}
        colors={['#000000', '#000000', '#00000052', '#00000000']} locations={window.fade} />}>
      <Image key={`${textureUri}:${textureRevision}`} source={{ uri: textureUri }} recyclingKey={`${textureUri}:${textureRevision}`} contentFit="fill"
        style={{ position: 'absolute', width: imageSide, height: imageSide,
          left: layout.coverCenterX - imageSide / 2, top: window.contentTop + layout.coverCenterY - imageSide / 2 }}
        transition={0} cachePolicy="memory-disk" onDisplay={scene.fieldDisplayed}
        onError={() => { onTextureError?.(textureUri); scene.fieldDisplayed(); }} />
    </MaskedView>
  </Animated.View>;
});

const styles = StyleSheet.create({
  plane: { position: 'absolute', top: 0, left: 0, overflow: 'hidden' },
});
