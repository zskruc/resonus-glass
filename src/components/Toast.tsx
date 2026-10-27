/** Brief pill-shaped message at the bottom (Spotify style). */
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { GlassBackdrop, GlassPressable } from '@/components/glass';
import { useFloatingBottom } from '@/hooks/useScreenBottomPadding';
import { useToast } from '@/store/toast';
import { fontSize, radius, spacing, themed, useTheme } from '@/theme';

export function Toast() {
  const colors = useTheme();
  const message = useToast((s) => s.message);
  const actionLabel = useToast((s) => s.actionLabel);
  const runAction = useToast((s) => s.runAction);
  const hide = useToast((s) => s.hide);
  // Clear of the mini player while there is one, and of the navigation bar
  // where there is one. The constant this replaces was 24 px short of the mini
  // player with that bar on, so the message sat partly behind it; the same
  // height the multi-select bar uses, so the two never disagree.
  const bottom = useFloatingBottom();

  useEffect(() => {
    if (!message) return;
    // With an action ("Undo") we give more time to react.
    const id = setTimeout(hide, actionLabel ? 4000 : 2600);
    return () => clearTimeout(id);
  }, [message, actionLabel, hide]);

  if (!message) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.pill, actionLabel ? styles.pillRow : null, { bottom, backgroundColor: 'transparent' }]}
      // Without an action the toast is purely informational and shouldn't steal touches.
      pointerEvents={actionLabel ? 'box-none' : 'none'}
    >
      <GlassBackdrop radius={radius.pill} variant="prominent" tint={colors.surface} />
      {/* The native material can pick a light tint independently of the legacy
          dark snackbar palette. Keep themed ink above a local contrast wash;
          the original glass, lens and highlight remain underneath. */}
      <View pointerEvents="none" accessible={false} style={styles.contrastSurface} />
      <Text style={[styles.text, actionLabel ? styles.textLeft : null]} numberOfLines={2}>
        {message}
      </Text>
      {actionLabel ? (
        <GlassPressable
          variant="subtle"
          hitSlop={12}
          accessibilityRole="button"
          onPress={() => {
            runAction?.();
            hide();
          }}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Text style={styles.action}>{actionLabel}</Text>
        </GlassPressable>
      ) : null}
    </Animated.View>
  );
}

const styles = themed((colors) => ({
  pill: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: 'transparent',
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  pillRow: { flexDirection: 'row', gap: spacing.lg },
  contrastSurface: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    opacity: 0.72,
  },
  text: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
  textLeft: { flex: 1 },
  action: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', textDecorationLine: 'underline' },
}));
