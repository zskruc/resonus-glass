import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';

import { CACHED_COVER } from '@/api/data';
import { useAuthStore } from '@/store/auth';
import { AmllBackgroundView } from '../../modules/amll-background';
import { resolveArtworkLocalUri } from '../../modules/amll-background/artworkSource';

export type AmllPlayerBackgroundProps = { uri?: string; active: boolean };

/** Background cadence is independent of the native controls and lyrics' display cadence. */
export const AmllPlayerBackground = memo(function AmllPlayerBackground({ uri, active }: AmllPlayerBackgroundProps) {
  const offline = useAuthStore((state) => state.offline);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [resolved, setResolved] = useState<{ uri: string | undefined; path: string | undefined }>();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    setForeground(AppState.currentState === 'active');
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let current = true;
    void resolveArtworkLocalUri(uri, CACHED_COVER, {
      cachePath: (key) => Image.getCachePathAsync(key),
      prefetch: (url) => Image.prefetch(url, 'disk'),
      allowNetwork: () => !useAuthStore.getState().offline,
    }).then((path) => {
      if (current) setResolved({ uri, path });
    });
    return () => { current = false; };
  }, [uri, offline]);

  const localUri = resolved?.uri === uri ? resolved?.path : undefined;
  return <AmllBackgroundView
    pointerEvents="none"
    accessible={false}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={styles.background}
    localUri={localUri ?? null}
    active={active && foreground}
  />;
});

const styles = StyleSheet.create({
  background: { ...StyleSheet.absoluteFill, backgroundColor: '#25252d' },
});
