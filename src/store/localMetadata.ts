import { create } from 'zustand';
import type { LocalArtistAlias, LocalSongMetadata } from '@/lib/localCustomizationModels';
import { validCustomizationValue } from '@/lib/localCustomizationModels';
import { captureCustomizationOwner, customizationScope, listLocalCustomizations, type CustomizationScope } from '@/lib/localCustomizations';

export const scopeKey = (scope: CustomizationScope) => `${scope.profile}|${scope.source}`;
let generation = 0, pending: { key: string; current: () => boolean; task: Promise<void> } | undefined;
export const useLocalMetadata = create<{
  scope: string; ready: boolean; revision: number; error: boolean;
  songs: Record<string, LocalSongMetadata>; aliases: LocalArtistAlias[];
  hydrate(scope?: CustomizationScope, force?: boolean): Promise<void>;
}>((set, get) => ({
  scope: '', ready: false, revision: 0, error: false, songs: {}, aliases: [],
  hydrate: (scope = customizationScope(), force = false) => {
    const key = scopeKey(scope), current = captureCustomizationOwner(scope);
    if (!current()) {
      if (key === scopeKey(customizationScope())) { generation++; set({ scope: '', ready: false, songs: {}, aliases: [], error: false }); }
      return Promise.resolve();
    }
    if (!force && get().scope === key && get().ready) return Promise.resolve();
    if (!force && pending?.key === key && pending.current()) return pending.task;
    const token = ++generation;
    if (get().scope !== key) set({ scope: key, ready: false, songs: {}, aliases: [], error: false });
    const task = (async () => {
      try {
        const [songs, aliases] = await Promise.all([listLocalCustomizations<LocalSongMetadata>(scope, 'song-metadata', current), listLocalCustomizations<LocalArtistAlias>(scope, 'artist-alias', current)]);
        if (token !== generation || !current()) return;
        set((state) => ({ scope: key, songs: Object.fromEntries(songs.filter((row) => validCustomizationValue('song-metadata', row.value)).map((row) => [row.id, row.value])),
          aliases: aliases.filter((row) => validCustomizationValue('artist-alias', row.value) && row.id === row.value.artistId).map((row) => row.value), ready: true, revision: state.revision + 1, error: false }));
      } catch { if (token === generation && current()) set({ error: true }); }
    })();
    pending = { key, current, task }; void task.finally(() => { if (pending?.task === task) pending = undefined; }); return task;
  },
}));
