import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppState, Platform } from 'react-native';

interface NativeSystemTypography {
  getFontWeightAdjustment(): number;
  addListener(
    event: 'onFontWeightAdjustmentChanged',
    listener: (event: { adjustment: number }) => void,
  ): { remove(): void };
}

function loadNative(): NativeSystemTypography | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireOptionalNativeModule<NativeSystemTypography>('SystemTypography');
  } catch {
    // Expo Go and older preview builds do not contain this local module.
    return null;
  }
}

const native = loadNative();

function normalizeAdjustment(value: number | undefined): number {
  // Android uses Integer.MAX_VALUE for an unspecified adjustment.
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 2147483647) return 0;
  return Math.trunc(Math.max(-1000, Math.min(1000, value))) || 0;
}

function readNativeAdjustment(): number {
  try {
    return normalizeAdjustment(native?.getFontWeightAdjustment());
  } catch {
    return 0;
  }
}

// Seed synchronously before the first Text is rendered, then keep a cheap,
// stable snapshot for the many useSyncExternalStore subscribers in the UI.
let adjustment = readNativeAdjustment();
const listeners = new Set<() => void>();
let started = false;

function updateAdjustment(value: number | undefined): void {
  const next = normalizeAdjustment(value);
  if (next === adjustment) return;
  adjustment = next;
  for (const listener of [...listeners]) listener();
}

export function getSystemFontWeightAdjustment(): number {
  return adjustment;
}

export function subscribeSystemFontWeightAdjustment(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Once at startup; settings changes also reach memoized, mounted text. */
export function initSystemTypography(): void {
  if (started) return;
  started = true;
  if (!native) return;

  try {
    native.addListener('onFontWeightAdjustmentChanged', (event) => {
      updateAdjustment(event.adjustment);
    });
  } catch {
    // A foreground read still catches changes on builds without event support.
  }
  AppState.addEventListener('change', (state) => {
    if (state === 'active') updateAdjustment(readNativeAdjustment());
  });
  updateAdjustment(readNativeAdjustment());
}
