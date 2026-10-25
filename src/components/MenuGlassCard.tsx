import { type ComponentProps, type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { GlassPressable } from '@/components/glass';
import { MenuGlassBackdrop } from '@/components/MenuGlassBackdrop';
import { useT } from '@/i18n';
import { themed, useTheme, useThemeMode } from '@/theme';

type AnimatedViewStyle = ComponentProps<typeof Animated.View>['style'];

/** One bounded surface for a menu's details, with the same material and anchor. */
export function MenuGlassCardFrame({ children, onClose, backdropStyle, cardStyle, onLayout, maxWidth = 312 }: {
  children: ReactNode;
  onClose: () => void;
  backdropStyle?: AnimatedViewStyle;
  cardStyle?: AnimatedViewStyle;
  onLayout?: (event: LayoutChangeEvent) => void;
  maxWidth?: number;
}) {
  useTheme();
  const dark = useThemeMode() === 'dark';
  const t = useT();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // A Dialog window can resize for the keyboard independently of the Activity.
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);
  const width = bounds?.width ?? window.width;
  const height = bounds?.height ?? window.height;
  const top = Math.min(insets.top + 72, Math.max(insets.top + 12, height - insets.bottom - 260));
  const cardWidth = Math.min(maxWidth, Math.max(0, width - insets.left - insets.right - 32));
  const maxHeight = Math.min(640, Math.max(0, height - top - insets.bottom - 16));

  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill} onLayout={(event) => {
      const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
      setBounds((old) => old?.width === nextWidth && old.height === nextHeight ? old : { width: nextWidth, height: nextHeight });
    }}>
      <Animated.View nativeID="resonus-menu-scrim" collapsable={false}
        style={[StyleSheet.absoluteFill, { backgroundColor: dark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.10)' }, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close')} />
      </Animated.View>
      <Animated.View collapsable={false} accessibilityViewIsModal onLayout={onLayout}
        style={[styles.card, { top, right: 16 + insets.right, width: cardWidth, maxHeight }, cardStyle]}>
        <MenuGlassBackdrop radius={28} />
        {children}
      </Animated.View>
    </GestureHandlerRootView>
  );
}

export function MenuGlassCardHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  const colors = useTheme();
  const t = useT();
  return (
    <View style={styles.header}>
      <View style={styles.heading}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={3}>{subtitle}</Text> : null}
      </View>
      <GlassPressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close')}
        hitSlop={4} style={({ pressed }) => [styles.close, pressed && { opacity: 0.55 }]}>
        <Icon name="close" size={20} color={colors.textSecondary} />
      </GlassPressable>
    </View>
  );
}

const styles = themed((colors) => ({
  card: { position: 'absolute', backgroundColor: 'transparent', borderRadius: 28, overflow: 'hidden', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14, flexShrink: 0 },
  heading: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600', lineHeight: 24 },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  close: { width: 36, height: 36, marginTop: -5, marginRight: -6, alignItems: 'center', justifyContent: 'center' },
}));
