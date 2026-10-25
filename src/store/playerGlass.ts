/** Independent popup preference; never rewrites dock modes or saved optics. */
import { create } from 'zustand';

import { getItem, setItemStrict } from '@/lib/storage';
import { isPlayerGlassRecipe, type PlayerGlassRecipe } from '@/theme/playerGlassRecipes';

const STORAGE_KEY = 'resonus.player-glass.v1';

interface PlayerGlassState {
  recipe: PlayerGlassRecipe;
  hydrated: boolean;
  hydrate(): Promise<void>;
  /** Applies immediately and rejects a failed explicit save for the UI. */
  setRecipe(recipe: PlayerGlassRecipe): Promise<void>;
}

let hydration: Promise<void> | null = null;
let revision = 0;
let writes: Promise<void> = Promise.resolve();

export const usePlayerGlass = create<PlayerGlassState>((set, get) => ({
  recipe: 'dock',
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return Promise.resolve();
    if (hydration) return hydration;
    const readRevision = revision;
    hydration = (async () => {
      try {
        const text = await getItem(STORAGE_KEY);
        const stored: unknown = text ? JSON.parse(text) : null;
        if (stored && typeof stored === 'object' && 'schemaVersion' in stored &&
          stored.schemaVersion === 1 && 'recipe' in stored && isPlayerGlassRecipe(stored.recipe) &&
          revision === readRevision) set({ recipe: stored.recipe });
        set({ hydrated: true });
      } catch {
        // Keep the live default and allow a later read retry. No fallback write.
        if (__DEV__) console.warn('[player glass] saved appearance could not be loaded');
      } finally {
        hydration = null;
      }
    })();
    return hydration;
  },
  setRecipe: (recipe) => {
    if (!isPlayerGlassRecipe(recipe)) return Promise.reject(new Error('Unknown player glass recipe'));
    revision++;
    set({ recipe });
    const payload = JSON.stringify({ schemaVersion: 1, recipe });
    const write = writes.catch(() => {}).then(() => setItemStrict(STORAGE_KEY, payload));
    writes = write;
    return write;
  },
}));
