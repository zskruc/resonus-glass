/** Companion display is independent of the global lyric lookup preference. */
import { create } from 'zustand';
import { getItem, setItemStrict } from '@/lib/storage';
import { hashKey } from '@/lib/localLibrary';
import { LYRIC_DISPLAY_MODES, type LyricDisplayMode } from '@/lib/lyricDocuments';

const key = (profile: string) => `resonus.lyricDisplay.${hashKey(profile)}`;
let generation = 0;
const writes = new Map<string, Promise<unknown>>();
export const useLyricDisplay = create<{
  profile: string | null; mode: LyricDisplayMode; ready: boolean; error: boolean;
  hydrate: (profile: string, current: () => boolean) => Promise<void>;
  save: (profile: string, mode: LyricDisplayMode, current: () => boolean) => Promise<boolean>;
}>((set, get) => ({
  profile: null, mode: 'both', ready: false, error: false,
  hydrate: async (profile, current) => {
    if (!current() || (get().profile === profile && get().ready)) return;
    const token = ++generation;
    set({ profile, mode: 'both', ready: false, error: false });
    try {
      await writes.get(profile)?.catch(() => {});
      const raw = await getItem(key(profile));
      if (token !== generation || !current()) return;
      const parsed: unknown = raw ? JSON.parse(raw) : 'both';
      set({ mode: LYRIC_DISPLAY_MODES.includes(parsed as LyricDisplayMode) ? parsed as LyricDisplayMode : 'both', ready: true });
    } catch { if (token === generation && current()) set({ error: true }); }
  },
  save: async (profile, mode, current) => {
    if (!LYRIC_DISPLAY_MODES.includes(mode) || get().profile !== profile || !get().ready || !current()) return false;
    const pending = (writes.get(profile) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!current()) return false;
      try {
        await setItemStrict(key(profile), JSON.stringify(mode));
        if (!current() || get().profile !== profile) return false;
        set({ mode }); return true;
      } catch { return false; }
    });
    writes.set(profile, pending);
    try { return await pending; } finally { if (writes.get(profile) === pending) writes.delete(profile); }
  },
}));
