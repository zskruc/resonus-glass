/** Saved catalogue controls; legacy Downloads becomes a filter in its saved slot. */
export type ExploreSectionKey = 'downloaded' | 'playlists' | 'albums' | 'artists' | 'songs' | 'genres' | 'radio' | 'podcasts' | 'folders';
export interface ExploreSection { key: ExploreSectionKey; enabled: boolean }
export type LibraryChipKey = 'playlists' | 'albums' | 'artists' | 'podcasts';
export interface LibraryChip { key: LibraryChipKey; enabled: boolean }
export const DEFAULT_EXPLORE_SECTIONS: ExploreSection[] = [
  'downloaded', 'playlists', 'albums', 'artists', 'songs', 'genres', 'radio', 'podcasts', 'folders',
].map((key) => ({ key: key as ExploreSectionKey, enabled: true }));
export const DEFAULT_LIBRARY_CHIPS: LibraryChip[] = ['playlists', 'albums', 'artists', 'podcasts']
  .map((key) => ({ key: key as LibraryChipKey, enabled: true }));

function normalize<K extends string>(raw: unknown, defaults: readonly { key: K; enabled: boolean }[], legacy?: Record<string, K>) {
  if (!Array.isArray(raw)) return defaults.map((item) => ({ ...item }));
  const out: { key: K; enabled: boolean }[] = [], seen = new Set<K>();
  for (const item of raw) {
    const old = typeof item === 'string' ? item : item?.key;
    const key = (legacy?.[old] ?? old) as K;
    if (!defaults.some((entry) => entry.key === key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, enabled: typeof item?.enabled === 'boolean' ? item.enabled : true });
  }
  for (const item of defaults) if (!seen.has(item.key)) {
    if (item.key === 'downloaded') out.unshift({ ...item });
    else out.push({ ...item });
  }
  return out;
}
export const normalizeExploreSections = (raw: unknown): ExploreSection[] => normalize(raw, DEFAULT_EXPLORE_SECTIONS, { downloads: 'downloaded' });
export const normalizeLibraryChips = (raw: unknown): LibraryChip[] => normalize(raw, DEFAULT_LIBRARY_CHIPS);
export const DOWNLOADABLE_SECTIONS = ['playlists', 'albums', 'artists', 'songs'] as const;
export function canDownloadFilter(section: string): boolean { return (DOWNLOADABLE_SECTIONS as readonly string[]).includes(section); }
