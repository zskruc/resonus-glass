import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackChevron } from '@/components/BackChevron';
import { usePrimuseAlbumPalette } from '@/hooks/usePrimuseAlbumPalette';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { primuseAlbumLayout } from '@/lib/primuseAlbumLayout';
import { spacing } from '@/theme';

/** The loading route uses the same field as its detail, never the white legacy skeleton. */
export function PrimuseAlbumLoading({ uri, offline, focused }: { uri?: string; offline: boolean; focused: boolean }) {
  const t = useT();
  const { width, height } = useScreenSize();
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = primuseAlbumLayout(width, height, insets.top, centredPadding(width, spacing.lg), fontScale);
  // Inspects only already-local artwork. It shares prepared results with the
  // destination and never starts a second image download while loading data.
  const { palette } = usePrimuseAlbumPalette(uri, offline, layout.blurRatio);
  return <View style={[styles.root, { backgroundColor: palette.backgroundTop }]}>
    {focused ? <><StatusBar style="light" /><NavigationBar style="light" /></> : null}
    <LinearGradient pointerEvents="none" style={StyleSheet.absoluteFill}
      colors={[palette.backgroundTop, palette.backgroundTop, palette.background]} locations={[0, .42, 1]} />
    <BackChevron size={28} color={palette.text} style={[styles.back, { top: insets.top + spacing.sm }]} />
    <ActivityIndicator color={palette.text} accessibilityLabel={t('Loading…')} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  back: { position: 'absolute', left: spacing.lg, zIndex: 1 },
});
