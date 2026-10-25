import { requireOptionalNativeModule } from 'expo-modules-core';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { mediaVolumeLevel, type MediaControlsState } from '@/lib/mediaControls';

interface NativeMediaControls {
  getState(): Promise<Partial<MediaControlsState>>;
  setMusicVolume(level: number, expectedRouteId: string, expectedMinimum: number, expectedMaximum: number): Promise<Partial<MediaControlsState>>;
  openSystemOutput(): Promise<'outputSwitcher' | 'volumePanel' | 'unavailable'>;
  addListener(event: 'onMediaControlsChanged', listener: (state: Partial<MediaControlsState>) => void): { remove(): void };
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<NativeMediaControls>('ResonusMediaControls')
  : null;
export const systemMediaControlsAvailable = !!native;
const initial: MediaControlsState = {
  supported: !!native,
  minimum: 0,
  maximum: 0,
  level: 0,
  fixed: true,
  muted: false,
  routeKind: 'unknown',
  routeName: '',
  routeId: '',
  outputSwitcherSupported: false,
};
let snapshot = initial;
const listeners = new Set<() => void>();
let nativeSub: { remove(): void } | undefined;
let appStateSub: { remove(): void } | undefined;
let generation = 0;
let stateRevision = 0;

function accept(value: Partial<MediaControlsState>) {
  // Fixed devices / safe-volume clamping are system-authoritative, not an
  // optimistic slider promise. Never mutate any player gain or cast volume.
  const next: MediaControlsState = {
    ...initial,
    ...value,
    routeName: typeof value.routeName === 'string' ? value.routeName : '',
    routeId: typeof value.routeId === 'string' ? value.routeId : '',
    level: mediaVolumeLevel(value.level ?? 0, value.minimum ?? 0, value.maximum ?? 0),
  };
  if (Object.keys(next).every((key) => next[key as keyof MediaControlsState] === snapshot[key as keyof MediaControlsState])) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

async function refresh() {
  const ticket = generation;
  const revision = stateRevision;
  try {
    const state = await native?.getState();
    // A delayed one-shot must not overwrite a newer route/volume event.
    if (state && ticket === generation && revision === stateRevision && listeners.size) accept(state);
  } catch { /* unavailable system service leaves the last measured value */ }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && native) {
    generation++;
    nativeSub = native.addListener('onMediaControlsChanged', (state) => {
      stateRevision++;
      accept(state);
    });
    appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    void refresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      generation++;
      nativeSub?.remove();
      nativeSub = undefined;
      appStateSub?.remove();
      appStateSub = undefined;
    }
  };
}

export function getMediaControlsState(): MediaControlsState { return snapshot; }

const noSubscribe = () => () => {};
export function useMediaControls(active = true): MediaControlsState {
  return useSyncExternalStore(active ? subscribe : noSubscribe, () => snapshot, () => initial);
}

/** Invoke only after an intentional user action; returns the actual panel opened. */
export async function openSystemAudioOutput(): Promise<'outputSwitcher' | 'volumePanel' | 'unavailable'> {
  try { return await native?.openSystemOutput() ?? 'unavailable'; }
  catch { return 'unavailable'; }
}

/** System music volume only; remote playback must use the renderer's own API. */
export async function setSystemMusicVolume(level: number): Promise<void> {
  if (!native) return;
  try {
    const ticket = generation;
    const revision = stateRevision;
    const current = snapshot;
    const state = await native.setMusicVolume(
      mediaVolumeLevel(level, current.minimum, current.maximum), current.routeId, current.minimum, current.maximum,
    );
    if (ticket === generation && revision === stateRevision && listeners.size) accept(state);
  } catch { /* the OS may reject a safe-volume or fixed-device write */ }
}
