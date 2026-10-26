import type { GlassOverrides } from '@/store/glassTuning';

/** Shared with native MaterialTuningMask; only explicit edits replace preset policy. */
const FIELD_BITS = {
  refraction: 1,
  refractionHeight: 2,
  highlightWidth: 4,
  highlightOpacity: 8,
  chromaticAberration: 16,
  tintOpacity: 32,
} as const;

export function glassMaterialTuningMask(overrides: GlassOverrides): number {
  let mask = 0;
  for (const field of Object.keys(FIELD_BITS) as (keyof typeof FIELD_BITS)[]) {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) mask |= FIELD_BITS[field];
  }
  return mask;
}
