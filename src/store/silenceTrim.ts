/** Optional local-file analysis; preferences and native cache ownership are per profile. */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { create } from 'zustand';

import { hashKey } from '@/lib/localLibrary';
import { profileScopeGuard } from '@/lib/profileScope';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import { isLocalSilenceUri, normalizeSilenceBounds, normalizeSilenceTrimPreferences,
  SILENCE_TRIM_DEFAULTS, type SilenceBounds, type SilenceTrimPreferences } from '@/lib/silenceTrim';
import { profileScopeId, useAuthStore } from './auth';

interface NativeSilenceTrim {
  activate(requestId: string): void;
  cancel(): void;
  clearCache(owner: string): Promise<void>;
  inspect(requestId: string, owner: string, uri: string, thresholdDb: number,
    minimumSilenceMs: number, scanSeconds: number): Promise<unknown>;
  addListener(name: 'onHeadBoundary', listener: (event: unknown) => void): { remove(): void };
}
const native = requireOptionalNativeModule<NativeSilenceTrim>('ResonusSilenceTrim');
const ownership = profileScopeGuard();
const storageKey = () => `resonus.silenceTrim.${hashKey(profileScopeId())}`;
let sequence = 0;
let removeHeadListener: (() => void) | null = null;

export type SilenceAnalysisStatus = 'idle' | 'analyzing' | 'ready' | 'head-only' | 'not-local' | 'unavailable';
interface SilenceTrimState extends SilenceTrimPreferences {
  supported: boolean;
  hydrated: boolean;
  status: SilenceAnalysisStatus;
  songId: string | null;
  bounds: SilenceBounds | null;
  hydrate(): Promise<void>;
  setPreferences(value: Partial<SilenceTrimPreferences>): void;
  reset(): void;
  cancelInspection(): void;
  inspect(uri: string | undefined, songId: string, publish: (bounds: SilenceBounds) => void): Promise<SilenceBounds | null>;
}

function abortNative() {
  sequence++;
  removeHeadListener?.();
  removeHeadListener = null;
  native?.cancel();
}
function persist(preferences: SilenceTrimPreferences) {
  const key = storageKey();
  if (ownership.owns(key)) void setItem(key, JSON.stringify(preferences));
}

export const useSilenceTrim = create<SilenceTrimState>((set, get) => ({
  ...SILENCE_TRIM_DEFAULTS,
  supported: !!native,
  hydrated: false,
  status: 'idle', songId: null, bounds: null,
  hydrate: async () => {
    const key = storageKey();
    if (get().hydrated && ownership.owns(key)) return;
    const token = ownership.start();
    abortNative();
    set({ ...SILENCE_TRIM_DEFAULTS, hydrated: false, status: 'idle', songId: null, bounds: null });
    try {
      const raw = await getItem(key);
      if (key !== storageKey() || !ownership.accept(token, key)) return;
      set({ ...normalizeSilenceTrimPreferences(raw ? JSON.parse(raw) : null), hydrated: true });
    } catch {
      if (key === storageKey() && ownership.current(token)) set({ hydrated: false, status: 'unavailable' });
    }
  },
  setPreferences: (value) => {
    if (!get().hydrated || !ownership.owns(storageKey())) return;
    const preferences = normalizeSilenceTrimPreferences({ ...get(), ...value });
    abortNative();
    set({ ...preferences, status: 'idle', songId: null, bounds: null });
    persist(preferences);
  },
  reset: () => get().setPreferences(SILENCE_TRIM_DEFAULTS),
  cancelInspection: () => {
    abortNative();
    set({ status: 'idle', songId: null, bounds: null });
  },
  inspect: async (uri, songId, publish) => {
    abortNative();
    const token = sequence;
    const owner = profileScopeId();
    const auth = useAuthStore.getState().auth;
    const preferences = normalizeSilenceTrimPreferences(get());
    const current = () => token === sequence && owner === profileScopeId()
      && useAuthStore.getState().auth === auth && get().hydrated && get().enabled;
    if (!preferences.enabled || !get().hydrated) return null;
    if (!native || !isLocalSilenceUri(uri)) {
      set({ status: native ? 'not-local' : 'unavailable', songId, bounds: null });
      return null;
    }
    const requestId = `edge.${Date.now()}.${token}`;
    let partial: SilenceBounds | null = null;
    set({ status: 'analyzing', songId, bounds: null });
    const subscription = native.addListener('onHeadBoundary', (event) => {
      if (!current() || !event || typeof event !== 'object'
        || (event as { requestId?: unknown }).requestId !== requestId) return;
      const bounds = normalizeSilenceBounds(event);
      if (!bounds || get().bounds?.complete) return;
      partial = bounds;
      set({ bounds }); publish(bounds);
    });
    removeHeadListener = () => subscription.remove();
    native.activate(requestId);
    try {
      const bounds = normalizeSilenceBounds(await native.inspect(requestId, hashKey(owner), uri,
        preferences.thresholdDb, preferences.minimumSilenceMs, preferences.scanSeconds));
      if (!current()) return null;
      const result = bounds ?? partial;
      set({ status: bounds ? 'ready' : partial ? 'head-only' : 'unavailable', bounds: result });
      if (result) publish(result);
      return result;
    } catch {
      if (!current()) return null;
      set({ status: partial ? 'head-only' : 'unavailable', bounds: partial });
      return partial;
    } finally {
      subscription.remove();
      if (token === sequence) removeHeadListener = null;
    }
  },
}));

/** Prepares one next local file, using the same bounded native cache. No UI state. */
export async function prefetchSilenceBounds(uri: string | undefined, stillCurrent: () => boolean): Promise<void> {
  if (!native || !isLocalSilenceUri(uri) || !stillCurrent()) return;
  const preferences = useSilenceTrim.getState();
  if (!preferences.hydrated || !preferences.enabled) return;
  const owner = profileScopeId();
  const requestId = `edge.prefetch.${Date.now()}.${sequence}`;
  native.activate(requestId);
  try {
    await native.inspect(requestId, hashKey(owner), uri, preferences.thresholdDb,
      preferences.minimumSilenceMs, preferences.scanSeconds);
  } catch { /* Optional preparation never interrupts playback. */ }
}

let previousScope = profileScopeId();
useAuthStore.subscribe(() => {
  const next = profileScopeId();
  if (next === previousScope) return;
  previousScope = next;
  void useSilenceTrim.getState().hydrate();
});
void useSilenceTrim.getState().hydrate();

/** Profile deletion removes preferences and only that profile's native cache. */
export async function clearSilenceTrimProfile(scopeId: string): Promise<void> {
  if (scopeId === profileScopeId()) useSilenceTrim.getState().cancelInspection();
  await deleteItem(`resonus.silenceTrim.${hashKey(scopeId)}`);
  await native?.clearCache(hashKey(scopeId));
}
