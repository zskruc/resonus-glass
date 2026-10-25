import { StyleSheet, View } from 'react-native';

import { LiquidGlassView, isLiquidGlassAvailable } from '../../modules/liquid-glass';
import { useTheme, useThemeMode } from '@/theme';

type MenuGlassBackdropProps = {
  radius?: number;
  radiusTopLeft?: number;
  radiusTopRight?: number;
  radiusBottomLeft?: number;
  radiusBottomRight?: number;
  highContrast?: boolean;
};

/** Keep this directly inside the non-collapsible menu card, beside its text. */
export function MenuGlassBackdrop({ radius = 28, radiusTopLeft, radiusTopRight,
  radiusBottomLeft, radiusBottomRight, highContrast = false }: MenuGlassBackdropProps) {
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';

  // A menu has its own contrast preset; the three saved glass profiles remain
  // independent. The existing modal/window capture excludes the whole card.
  if (isLiquidGlassAvailable) {
    return (
      <LiquidGlassView
        pointerEvents="none"
        accessible={false}
        isolateModalForeground
        style={StyleSheet.absoluteFill}
        radius={radius}
        radiusTopLeft={radiusTopLeft}
        radiusTopRight={radiusTopRight}
        radiusBottomLeft={radiusBottomLeft}
        radiusBottomRight={radiusBottomRight}
        blur={12}
        refraction={10}
        refractionHeight={7}
        depthEffect
        chromaticAberration={false}
        highlightWidth={0.6}
        highlightOpacity={dark ? 0.45 : 0.7}
        tintColor={dark ? '#202026' : '#FFFFFF'}
        tintOpacity={highContrast ? (dark ? 0.78 : 0.64) : (dark ? 0.3 : 0.24)}
        dark={dark}
      />
    );
  }

  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: radius,
          borderTopLeftRadius: radiusTopLeft,
          borderTopRightRadius: radiusTopRight,
          borderBottomLeftRadius: radiusBottomLeft,
          borderBottomRightRadius: radiusBottomRight,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    />
  );
}
