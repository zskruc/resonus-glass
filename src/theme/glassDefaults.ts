import type { GlassProfile, GlassTarget } from '@/store/glassTuning';

/**
 * Material values from Kyant0's component examples at 65ab177 (also unchanged
 * in Backdrop 1.0.0, the version used by the Android bridge). The examples do
 * not expose one universal glass preset: a dialog and a bottom tab differ.
 * Native materialPreset supplies their original highlight/shadow/color filter.
 */
export function getKyantGlassProfile(kind: 'button' | 'navigation' | 'dialog', dark: boolean): GlassProfile {
  const profile: GlassProfile = {
    blur: 2,
    refraction: 24,
    refractionHeight: 12,
    highlightWidth: 0.5,
    highlightOpacity: 1,
    tintOpacity: 0,
    tintColor: 'transparent',
    depthEffect: false,
    chromaticAberration: false,
  };
  if (kind === 'navigation') return {
    ...profile, blur: 8, refractionHeight: 24,
    tintColor: dark ? '#121212' : '#FAFAFA', tintOpacity: 0.4,
  };
  if (kind === 'dialog') return {
    ...profile, blur: dark ? 8 : 16, refraction: 48, refractionHeight: 24,
    depthEffect: true, tintColor: dark ? '#121212' : '#FAFAFA', tintOpacity: dark ? 0.4 : 0.6,
  };
  return profile;
}

/** Chosen in the Samsung tuning room; the mini is untinted, other surfaces retain automatic tint. */
export const DEFAULT_GLASS_PROFILES: Record<GlassTarget, GlassProfile> = {
  miniPlayer: {
    blur: 0,
    refraction: 11,
    refractionHeight: 9,
    highlightWidth: 0.8,
    highlightOpacity: 0.38,
    tintOpacity: 0,
    tintColor: null,
    depthEffect: false,
    chromaticAberration: false,
  },
  navigation: {
    blur: 0,
    refraction: 14,
    refractionHeight: 14,
    highlightWidth: 0.8,
    highlightOpacity: 0.7,
    tintOpacity: 0.1,
    tintColor: null,
    depthEffect: true,
    chromaticAberration: false,
  },
  controls: {
    blur: 0,
    refraction: 8,
    refractionHeight: 8,
    highlightWidth: 0.5,
    highlightOpacity: 0.67,
    tintOpacity: 0.1,
    tintColor: null,
    depthEffect: true,
    chromaticAberration: false,
  },
};

/** Visual reference approximation; these are Kyant values, not Apple's private parameters. */
export const IPHONE_REFERENCE_GLASS_PROFILES: Record<GlassTarget, GlassProfile> = {
  miniPlayer: {
    ...DEFAULT_GLASS_PROFILES.miniPlayer,
    refractionHeight: 7,
    highlightWidth: 0.5,
  },
  navigation: {
    ...DEFAULT_GLASS_PROFILES.navigation,
    refractionHeight: 8,
    highlightWidth: 0.5,
    highlightOpacity: 0.5,
  },
  controls: {
    ...DEFAULT_GLASS_PROFILES.controls,
    refractionHeight: 6,
  },
};
