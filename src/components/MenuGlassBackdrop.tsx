import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { LiquidGlassView, isLiquidGlassAvailable } from '../../modules/liquid-glass';
import { useTheme, useThemeMode } from '@/theme';
import { useGlassTuning } from '@/store/glassTuning';
import { getKyantGlassProfile } from '@/theme/glassDefaults';
import { usePlayerGlass } from '@/store/playerGlass';
import { getPlayerGlassRecipe, getPlayerMoreMenuMaterial } from '@/theme/playerGlassRecipes';

type MenuGlassBackdropProps = {
  radius?: number;
  radiusTopLeft?: number;
  radiusTopRight?: number;
  radiusBottomLeft?: number;
  radiusBottomRight?: number;
  highContrast?: boolean;
  /** More menus keep their own material; detail cards use the popup choice. */
  kind?: 'popup' | 'menu';
};

/** Keep this directly inside the non-collapsible menu card, beside its text. */
export function MenuGlassBackdrop({ radius = 28, radiusTopLeft, radiusTopRight,
  radiusBottomLeft, radiusBottomRight, highContrast = false, kind = 'popup' }: MenuGlassBackdropProps) {
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const kyantDefaults = useGlassTuning((state) => state.mode === 'kyantDefault' || state.mode === 'amPlus');
  const recipe = usePlayerGlass((state) => state.recipe);
  const hydrate = usePlayerGlass((state) => state.hydrate);
  useEffect(() => { void hydrate(); }, [hydrate]);
  const existingProfile = kyantDefaults ? getKyantGlassProfile('dialog', dark) : {
    blur: 12,
    refraction: 10,
    refractionHeight: 7,
    depthEffect: true,
    chromaticAberration: false,
    highlightWidth: 0.6,
    highlightOpacity: dark ? 0.45 : 0.7,
    tintColor: dark ? '#202026' : '#FFFFFF',
    tintOpacity: highContrast ? (dark ? 0.78 : 0.64) : (dark ? 0.3 : 0.24),
  };
  const selected = recipe === 'original' ? null : kind === 'menu'
    ? getPlayerMoreMenuMaterial(dark) : getPlayerGlassRecipe(recipe, dark);
  const profile = selected?.profile ?? existingProfile;

  // Use the upstream dialog material in the defaults preview. Legacy modes
  // retain their separate contrast preset and saved profiles.
  if (isLiquidGlassAvailable) {
    return (
      <LiquidGlassView
        pointerEvents="none"
        accessible={false}
        isolateModalForeground
        materialPreset={selected?.materialPreset ?? (kyantDefaults ? 'dialog' : 'custom')}
        style={StyleSheet.absoluteFill}
        radius={radius}
        radiusTopLeft={radiusTopLeft}
        radiusTopRight={radiusTopRight}
        radiusBottomLeft={radiusBottomLeft}
        radiusBottomRight={radiusBottomRight}
        blur={profile.blur}
        refraction={profile.refraction}
        refractionHeight={profile.refractionHeight}
        depthEffect={profile.depthEffect}
        chromaticAberration={profile.chromaticAberration}
        highlightWidth={profile.highlightWidth}
        highlightOpacity={profile.highlightOpacity}
        tintColor={profile.tintColor ?? 'transparent'}
        tintOpacity={profile.tintOpacity}
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
