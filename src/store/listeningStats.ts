/** Only the active profile's recording preference is in memory; data stays in SQLite. */
import { create } from 'zustand';
import { listeningPreferences, setListeningEnabled } from '@/lib/listeningDb';
import { profileScopeId } from './auth';

let generation = 0;
interface ListeningStatsState {
  profile: string;
  hydrated: boolean;
  enabled: boolean;
  startedAt?: number;
  error: string | null;
  load: (force?: boolean) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}
export const useListeningStats = create<ListeningStatsState>((set, get) => ({
  profile: '', hydrated: false, enabled: true, error: null,
  load: async (force = false) => {
    const profile = profileScopeId();
    if (!force && get().profile === profile && get().hydrated) return;
    const token = ++generation;
    set({ profile, hydrated: false, error: null });
    try {
      const prefs = await listeningPreferences(profile);
      if (token !== generation || profileScopeId() !== profile) return;
      set({ ...prefs, profile, hydrated: true, error: null });
    } catch {
      if (token === generation && profileScopeId() === profile) set({ enabled: false, hydrated: true, error: 'Listening statistics are unavailable' });
    }
  },
  setEnabled: async (enabled) => {
    const { profile, hydrated, enabled: before } = get();
    if (!hydrated || profileScopeId() !== profile) return;
    const token = generation;
    set({ enabled, error: null });
    try { await setListeningEnabled(profile, enabled); }
    catch (error) {
      if (token === generation && profileScopeId() === profile) set({ enabled: before, error: 'Listening statistics are unavailable' });
      throw error;
    }
  },
}));
