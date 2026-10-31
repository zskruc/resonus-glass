/** Explicit, profile-owned lyric timing changes, persisted without changing lyric files. */
import { create } from 'zustand';

import { hashKey } from '@/lib/localLibrary';
import { normalizeLyricOffset, savedLyricOffsets } from '@/lib/lyricTiming';
import { getItem, setItemStrict } from '@/lib/storage';
import { profileScopeId } from './auth';

const keyFor = (profile: string) => `resonus.lyricOffsets.${hashKey(profile)}`;
const writes = new Map<string, Promise<unknown>>();
let generation = 0;
let pending: { profile: string; task: Promise<void> } | undefined;

interface LyricOffsetsState {
  profile: string | null;
  hydrated: boolean;
  loading: boolean;
  error: boolean;
  offsets: Record<string, number>;
  hydrate: (profile?: string) => Promise<void>;
  setOffset: (songId: string, offsetMs: number, expectedProfile: string) => Promise<boolean>;
}

export const useLyricOffsets = create<LyricOffsetsState>((set, get) => ({
  profile: null, hydrated: false, loading: false, error: false, offsets: {},
  hydrate: (profile = profileScopeId()) => {
    if (profile !== profileScopeId()) return Promise.resolve();
    if (get().profile === profile && get().hydrated) return Promise.resolve();
    if (pending?.profile === profile) return pending.task;
    const token = ++generation;
    set({ profile, hydrated: false, loading: true, error: false, offsets: {} });
    const task = (async () => {
      const key = keyFor(profile);
      // A write accepted before leaving this account must finish before a
      // quick return reads it, or the old value could win the hydration race.
      await writes.get(key)?.catch(() => {});
      try {
        const raw = await getItem(key);
        const offsets = savedLyricOffsets(raw ? JSON.parse(raw) : {});
        if (token === generation && profileScopeId() === profile) set({ offsets, hydrated: true, loading: false });
      } catch {
        // A failed read is not an empty record worth saving over real values.
        if (token === generation && profileScopeId() === profile) set({ hydrated: false, loading: false, error: true });
      }
    })();
    pending = { profile, task };
    void task.finally(() => { if (pending?.task === task) pending = undefined; });
    return task;
  },
  setOffset: async (songId, value, expectedProfile) => {
    if (!songId || songId.length > 1024 || typeof value !== 'number' || !Number.isFinite(value) || expectedProfile !== profileScopeId()
      || get().profile !== expectedProfile || !get().hydrated) return false;
    const offset = normalizeLyricOffset(value);
    const key = keyFor(expectedProfile);
    const previous = writes.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (expectedProfile !== profileScopeId()) return false;
      try {
        const raw = await getItem(key);
        const next = savedLyricOffsets(raw ? JSON.parse(raw) : {});
        if (expectedProfile !== profileScopeId()) return false;
        if (offset) Object.defineProperty(next, songId, { value: offset, enumerable: true, configurable: true, writable: true });
        else delete next[songId];
        await setItemStrict(key, JSON.stringify(next));
        if (expectedProfile !== profileScopeId() || get().profile !== expectedProfile) return false;
        set({ offsets: next });
        return true;
      } catch { return false; }
    });
    writes.set(key, task);
    try { return await task; }
    finally { if (writes.get(key) === task) writes.delete(key); }
  },
}));
