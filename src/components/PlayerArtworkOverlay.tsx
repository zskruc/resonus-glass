import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { COVER, songCoverUrl } from '@/api/data';
import { useScreenSize } from '@/hooks/useScreenSize';
import { playerArtworkFlight, playerSurfaceOwner } from '@/lib/playerReveal';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { Cover } from './Cover';

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
  const [ready, setReady] = useState<string | undefined>();
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
  if (!song) return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <Animated.View pointerEvents="none" collapsable={false}
      style={[styles.image, { width: size, height: size }, style]}>
      <Cover uri={thumb} size={size} autoplay={false} preferStatic transition={0}
        contentFit={fit ? 'contain' : 'cover'} style={styles.cover} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: ready === card ? 1 : 0 }]}>
        <Cover uri={card} size={size} autoplay={false} preferStatic transition={0}
          onAnimatedDetected={(uri) => { if (uri === card) setReady(uri); }}
          contentFit={fit ? 'contain' : 'cover'} style={styles.cover} />
      </View>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  image: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  cover: { borderRadius: 0 },
});
