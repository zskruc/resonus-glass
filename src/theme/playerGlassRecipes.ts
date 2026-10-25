import type { GlassProfile } from '@/store/glassTuning';
import type { LiquidGlassMaterialPreset } from '../../modules/liquid-glass';

/**
 * Adapted from Kifranei/AM-plus-plus-media-plugin, GPL-3.0,
 * b9e043c10ee8bdba62f155acba296be566b9b71d: GlassPlayerDialog.kt and
 * GlassPlayerMoreMenu.kt. The light popup fill follows Resonus's light theme;
 * the plugin's popup host uses a dark surface in both themes. No Apple assets.
 */
export const PLAYER_GLASS_RECIPES = ['dock', 'menu', 'clear', 'original'] as const;
export type PlayerGlassRecipe = typeof PLAYER_GLASS_RECIPES[number];

export function isPlayerGlassRecipe(value: unknown): value is PlayerGlassRecipe {
  return typeof value === 'string' && PLAYER_GLASS_RECIPES.includes(value as PlayerGlassRecipe);
}

export interface PlayerGlassMaterial {
  materialPreset: LiquidGlassMaterialPreset;
  profile: GlassProfile;
}

/** Original resolves at the caller, retaining its existing appearance mode. */
export function getPlayerGlassRecipe(recipe: Exclude<PlayerGlassRecipe, 'original'>, dark: boolean): PlayerGlassMaterial {
  const profile: GlassProfile = {
    blur: 4,
    refraction: 24,
    refractionHeight: 24,
    depthEffect: false,
    chromaticAberration: false,
    highlightWidth: .5,
    highlightOpacity: 1,
    tintColor: dark ? '#121212' : '#FAFAFA',
    tintOpacity: .4,
  };
  if (recipe === 'menu') return {
    materialPreset: 'mediaPopup',
    profile: { ...profile, blur: 20, refraction: 16, refractionHeight: 10,
      tintColor: dark ? '#3A3A3C' : '#F2F2F7', tintOpacity: dark ? .36 : .55 },
  };
  if (recipe === 'clear') return {
    materialPreset: 'mediaPopup',
    // The reference "No frost" still blurs by 20dp; it removes the tint only.
    profile: { ...profile, blur: 20, refraction: 32, refractionHeight: 20,
      tintColor: 'transparent', tintOpacity: 0 },
  };
  return { materialPreset: 'mediaPopupBottom', profile };
}

/** The More menu keeps its own recipe, independent of popup selection. */
export function getPlayerMoreMenuMaterial(dark: boolean): PlayerGlassMaterial {
  return { ...getPlayerGlassRecipe('menu', dark), materialPreset: 'mediaMenu' };
}
