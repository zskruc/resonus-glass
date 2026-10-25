/**
 * Cross-platform persistent storage.
 *
 * Uses expo-secure-store (encrypted) on mobile. That module doesn't exist on
 * web, so we fall back to localStorage to test the app in the browser.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  // Reads are left to throw on purpose. Turning a KeyStore failure into "there
  // was nothing saved" reads as an empty app to whoever called, and the next
  // write would put that emptiness on top of profiles that were fine. The
  // callers that matter already catch (see `auth.ts` hydration).
  return SecureStore.getItemAsync(key);
}

/** Explicit save actions need write failures to reach their caller. */
export async function setItemStrict(key: string, value: string): Promise<void> {
  if (isWeb) {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error('Persistent storage is unavailable');
    storage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // On web without localStorage we simply don't persist.
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (e) {
    // The Android KeyStore does fail on some devices: a key invalidated by a
    // restore or by changing the screen lock, a broken vendor implementation.
    // Most callers persist without awaiting, so the rejection had nowhere to
    // land and surfaced as an unhandled one. The setting is lost either way;
    // what changes is that losing it doesn't leave a stray rejection behind.
    if (__DEV__) console.warn('[storage] could not save', key, e);
  }
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    if (__DEV__) console.warn('[storage] could not delete', key, e);
  }
}
