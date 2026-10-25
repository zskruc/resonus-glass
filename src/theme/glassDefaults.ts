import type { GlassProfile, GlassTarget } from '@/store/glassTuning';

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
