import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { COVER, songCoverUrl } from '@/api/data';
import { useScreenSize } from '@/hooks/useScreenSize';
import { playerArtworkFlight, playerSurfaceOwner } from '@/lib/playerReveal';
import { playerArtworkCardOpacity, playerArtworkCropScale } from '@/lib/playerArtworkCrop';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { Cover, type CoverImageMetadata } from './Cover';

/**
 * One fixed-layout image plane above Stack and dock. At either endpoint the
 * original image takes over in the same UI transaction that hides this plane.
 * Only current-track still images are retained; no animation clock runs idle.
 */
export function PlayerArtworkOverlay() {
  const { width } = useScreenSize();
  const song = usePlayerStore(currentSong);
  const fit = useSettings((state) => state.fitCoverArt);
  const card = song ? songCoverUrl(song, COVER.card) : undefined;
  const thumb = song ? songCoverUrl(song, COVER.thumb) : undefined;
  const binding = useMemo(() => ({ card, thumb }), [card, thumb]);
  const currentBinding = useRef<typeof binding | null>(binding);
  useLayoutEffect(() => {
    currentBinding.current = binding;
    return () => { currentBinding.current = null; };
  }, [binding]);
  const [ready, setReady] = useState<typeof binding>();
  const [cardMetadata, setCardMetadata] = useState<{ binding: typeof binding; value: CoverImageMetadata }>();
  const [thumbMetadata, setThumbMetadata] = useState<{ binding: typeof binding; value: CoverImageMetadata }>();
  const cardWidth = cardMetadata?.binding === binding ? cardMetadata.value.width : 0;
  const cardHeight = cardMetadata?.binding === binding ? cardMetadata.value.height : 0;
  const thumbWidth = thumbMetadata?.binding === binding ? thumbMetadata.value.width : 0;
  const thumbHeight = thumbMetadata?.binding === binding ? thumbMetadata.value.height : 0;
  const cardReady = !!card && ready === binding;
  const size = Math.max(1, width);
  const style = useAnimatedStyle(() => {
    const published = playerArtworkFlight.get();
    const flight = published?.owner === playerSurfaceOwner.get() ? published : null;
    const rect = flight?.frame.artwork.rect;
    const sx = rect ? rect.width / size : 1;
    const sy = rect ? rect.height / size : 1;
    return {
      opacity: flight ? 1 : 0,
      borderRadius: rect ? (rect.cornerRadius ?? 0) / Math.max(.001, Math.min(sx, sy)) : 0,
      transform: [
        { translateX: rect ? rect.x + (rect.width - size) / 2 : 0 },
        { translateY: rect ? rect.y + (rect.height - size) / 2 : 0 },
        { scaleX: sx }, { scaleY: sy },
      ],
    };
  }, [size]);
  const thumbStyle = useAnimatedStyle(() => {
    const published = playerArtworkFlight.get();
    const flight = published?.owner === playerSurfaceOwner.get() ? published : null;
    return { transform: [{ scale: playerArtworkCropScale(fit, thumbWidth, thumbHeight, flight?.frame.fullContentOpacity ?? 0) }] };
  }, [fit, thumbWidth, thumbHeight]);
  const cardStyle = useAnimatedStyle(() => {
    const published = playerArtworkFlight.get();
    const flight = published?.owner === playerSurfaceOwner.get() ? published : null;
    const progress = flight?.frame.fullContentOpacity ?? 0;
    return { opacity: playerArtworkCardOpacity(cardReady, progress),
      transform: [{ scale: playerArtworkCropScale(fit, cardWidth, cardHeight, progress) }] };
  }, [fit, cardReady, cardWidth, cardHeight]);
  if (!song) return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <Animated.View pointerEvents="none" collapsable={false}
      style={[styles.image, { width: size, height: size }, style]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, thumbStyle]}>
        <Cover uri={thumb} size={size} autoplay={false} preferStatic transition={0}
          onImageMetadata={(uri, value) => { if (currentBinding.current === binding && uri === thumb) setThumbMetadata({ binding, value }); }}
          contentFit={fit ? 'contain' : 'cover'} style={styles.cover} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, cardStyle]}>
        <Cover uri={card} size={size} autoplay={false} preferStatic transition={0}
          onAnimatedDetected={(uri) => { if (currentBinding.current === binding && uri === card) setReady(binding); }}
          onImageMetadata={(uri, value) => { if (currentBinding.current === binding && uri === card) setCardMetadata({ binding, value }); }}
          contentFit={fit ? 'contain' : 'cover'} style={styles.cover} />
      </Animated.View>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  image: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  cover: { borderRadius: 0 },
});
