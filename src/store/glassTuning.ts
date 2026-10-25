/** Appearance-only tuning, shared across accounts and kept separate from credentials. */
import { create } from 'zustand';

import { getItem, setItemStrict } from '@/lib/storage';
import { DEFAULT_GLASS_PROFILES, IPHONE_REFERENCE_GLASS_PROFILES } from '@/theme/glassDefaults';

export type GlassTarget = 'miniPlayer' | 'navigation' | 'controls';
export type GlassAppearanceMode = 'iphoneReference' | 'custom';

export interface GlassProfile {
  blur: number;
  refraction: number;
  refractionHeight: number;
  highlightWidth: number;
  highlightOpacity: number;
  tintOpacity: number;
  /** null follows the control's existing theme or accent color. */
  tintColor: string | null;
  depthEffect: boolean;
  chromaticAberration: boolean;
}

export type GlassOverrides = Partial<GlassProfile>;
type OverridesByTarget = Record<GlassTarget, GlassOverrides>;

const STORAGE_KEY = 'resonus.glass-tuning.v1';
const MODE_STORAGE_KEY = 'resonus.glass-appearance.v1';
const TARGETS: GlassTarget[] = ['miniPlayer', 'navigation', 'controls'];

/** These are also the native module's accepted limits. */
export const GLASS_PARAMETER_LIMITS = {
  blur: [0, 40],
  refraction: [0, 48],
  refractionHeight: [0, 48],
  highlightWidth: [0, 8],
  highlightOpacity: [0, 1],
  tintOpacity: [0, 1],
} as const;

function emptyOverrides(): OverridesByTarget {
  return { miniPlayer: {}, navigation: {}, controls: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reject unknown fields/non-finite values; clip numeric values to native bounds. */
export function sanitizeGlassOverrides(value: unknown): GlassOverrides {
  if (!isRecord(value)) return {};
  const clean: GlassOverrides = {};
  for (const key of Object.keys(GLASS_PARAMETER_LIMITS) as (keyof typeof GLASS_PARAMETER_LIMITS)[]) {
    const number = value[key];
    if (typeof number !== 'number' || !Number.isFinite(number)) continue;
    const [min, max] = GLASS_PARAMETER_LIMITS[key];
    clean[key] = Math.max(min, Math.min(max, number));
  }
  for (const key of ['depthEffect', 'chromaticAberration'] as const) {
    if (typeof value[key] === 'boolean') clean[key] = value[key];
  }
  const tint = value.tintColor;
  if (tint === null) clean.tintColor = null;
  else if (typeof tint === 'string' && /^#[\da-f]{6}$/i.test(tint)) clean.tintColor = tint.toUpperCase();
  return clean;
}

export function getGlassDefaults(target: GlassTarget, _dark: boolean, mode: GlassAppearanceMode = 'custom'): GlassProfile {
  // Optical values are shared between themes; the mini has no color fill.
  return { ...(mode === 'iphoneReference' ? IPHONE_REFERENCE_GLASS_PROFILES : DEFAULT_GLASS_PROFILES)[target] };
}

export function resolveGlassProfile(target: GlassTarget, dark: boolean, overrides: GlassOverrides, mode: GlassAppearanceMode = 'custom'): GlassProfile {
  const defaults = getGlassDefaults(target, dark, mode);
  const profile = mode === 'iphoneReference' ? defaults : { ...defaults, ...sanitizeGlassOverrides(overrides) };
  // Legacy saved colors remain in storage, but the mini's live material is
  // always untinted. Keep every saved optical value and other target intact.
  return target === 'miniPlayer' ? { ...profile, tintOpacity: 0, tintColor: null } : profile;
}

interface GlassTuningState {
  overrides: OverridesByTarget;
  mode: GlassAppearanceMode;
  hydrated: boolean;
  hydrate(): Promise<void>;
  setMode(mode: GlassAppearanceMode): void;
  /** Updates previews immediately; persistence is explicit, after editing. */
  update(target: GlassTarget, patch: GlassOverrides): void;
  save(): Promise<void>;
  /** Restores only this live preview; Save persists the completed selection. */
  reset(target: GlassTarget): void;
}

let hydration: Promise<void> | null = null;
let saveQueue: Promise<void> = Promise.resolve();
const resetBeforeHydration = new Set<GlassTarget>();
let modeChangedBeforeHydration = false;
let hydrationReadFailed = false;

export const useGlassTuning = create<GlassTuningState>((set, get) => ({
  overrides: emptyOverrides(),
  mode: 'iphoneReference',
  hydrated: false,
  hydrate: () => {
    if (get().hydrated && !hydrationReadFailed) return Promise.resolve();
    if (hydration) return hydration;
    hydration = (async () => {
      try {
        const reads = await Promise.allSettled([getItem(STORAGE_KEY), getItem(MODE_STORAGE_KEY)]);
        const loaded = emptyOverrides();
        let loadedMode: GlassAppearanceMode = 'iphoneReference';
        let modeReadFailed = reads[1].status === 'rejected';
        let failed = reads.some((read) => read.status === 'rejected');
        if (reads[0].status === 'fulfilled') {
          try {
            const stored: unknown = reads[0].value ? JSON.parse(reads[0].value) : null;
            if (isRecord(stored) && stored.schemaVersion === 1 && isRecord(stored.overrides)) {
              for (const target of TARGETS) loaded[target] = sanitizeGlassOverrides(stored.overrides[target]);
            }
          } catch { failed = true; }
        }
        if (reads[1].status === 'fulfilled') {
          try {
            const stored: unknown = reads[1].value ? JSON.parse(reads[1].value) : null;
            if (isRecord(stored) && stored.schemaVersion === 1 && (stored.mode === 'custom' || stored.mode === 'iphoneReference')) {
              loadedMode = stored.mode;
            }
          } catch { failed = true; modeReadFailed = true; }
        }
        hydrationReadFailed = failed;
        // A fast edit while storage is loading must not be replaced by old values.
        set((state) => ({
          mode: modeChangedBeforeHydration || modeReadFailed ? state.mode : loadedMode,
          overrides: Object.fromEntries(TARGETS.map((target) => [target,
            resetBeforeHydration.has(target)
              ? state.overrides[target]
              : { ...loaded[target], ...state.overrides[target] },
          ])) as OverridesByTarget,
        }));
        if (failed && __DEV__) console.warn('[glass tuning] saved appearance could not be loaded');
      } catch {
        hydrationReadFailed = true;
        // Appearance falls back to factory values; no automatic write follows a failed read.
        if (__DEV__) console.warn('[glass tuning] saved appearance could not be loaded');
      } finally {
        set({ hydrated: true });
        if (!hydrationReadFailed) {
          resetBeforeHydration.clear();
          modeChangedBeforeHydration = false;
        }
        hydration = null;
      }
    })();
    return hydration;
  },
  setMode: (mode) => {
    if (mode !== 'iphoneReference' && mode !== 'custom') return;
    if (!get().hydrated || hydrationReadFailed) modeChangedBeforeHydration = true;
    set({ mode });
  },
  update: (target, patch) => {
    if (get().mode === 'iphoneReference') return;
    const clean = sanitizeGlassOverrides(patch);
    if (Object.keys(clean).length === 0) return;
    set((state) => ({ overrides: {
      ...state.overrides,
      [target]: { ...state.overrides[target], ...clean },
    } }));
  },
  save: async () => {
    await get().hydrate();
    if (hydrationReadFailed) throw new Error('Saved glass appearance could not be read');
    const serialized = exportGlassTuning();
    const serializedMode = JSON.stringify({ schemaVersion: 1, mode: get().mode });
    // Serialize explicit saves so a slow older write cannot replace a newer one.
    const persist = async () => {
      // Reference values are never written into the user's three custom profiles.
      await setItemStrict(STORAGE_KEY, serialized);
      await setItemStrict(MODE_STORAGE_KEY, serializedMode);
    };
    saveQueue = saveQueue.then(persist, persist);
    await saveQueue;
  },
  reset: (target) => {
    if (get().mode === 'iphoneReference') return;
    if (!get().hydrated || hydrationReadFailed) resetBeforeHydration.add(target);
    set((state) => ({ overrides: { ...state.overrides, [target]: {} } }));
  },
}));

export function getGlassProfile(target: GlassTarget, dark: boolean): GlassProfile {
  const { overrides, mode } = useGlassTuning.getState();
  return resolveGlassProfile(target, dark, overrides[target], mode);
}

/** Export contains only glass appearance, never account, playback or server settings. */
export function exportGlassTuning(): string {
  const source = useGlassTuning.getState().overrides;
  const overrides = Object.fromEntries(TARGETS.map((target) => [target, sanitizeGlassOverrides(source[target])]));
  return JSON.stringify({ schemaVersion: 1, overrides }, null, 2);
}
