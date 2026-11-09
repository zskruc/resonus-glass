/** Local presentation, directory favourites and organisation inspired by Primuse 1.13.
 * Data is account-scoped; network/server identities are never rewritten. */
export type SearchSectionKey = 'songs' | 'lyrics' | 'artists' | 'albums' | 'playlists' | 'radio';
export type ShelfLayout = 'default' | 'cards' | 'rows' | 'compact' | 'grid';
export interface ShelfPreference { layout: ShelfLayout; size: 'default' | 'small' | 'large'; limit: number; rows?: 1 | 2 | 3 }
export interface LocalRadioStation { id: string; name: string; streamUrl: string; homePageUrl?: string; imageUrl?: string }
export interface MediaFolder { id: string; name: string }
export interface MediaAssignment { folder?: string; tags: string[] }
export interface DiscoveryPreferences {
  version: 1;
  shelves: Record<string, ShelfPreference>;
  search: { sections: { key: SearchSectionKey; enabled: boolean }[]; density: 'comfortable' | 'compact' };
  intent: { pinned: string[]; hidden: string[] };
  stations: LocalRadioStation[];
  folders: MediaFolder[];
  tags: string[];
  assignments: Record<string, MediaAssignment>;
}
export const SEARCH_SECTION_KEYS: SearchSectionKey[] = ['lyrics', 'artists', 'albums', 'songs', 'playlists', 'radio'];
export function defaultDiscoveryPreferences(): DiscoveryPreferences {
  return { version: 1, shelves: {}, search: { sections: SEARCH_SECTION_KEYS.map((key) => ({ key, enabled: true })), density: 'comfortable' },
    intent: { pinned: [], hidden: [] }, stations: [], folders: [], tags: [], assignments: {} };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const label = (v: unknown, max = 160) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const strings = (v: unknown, max = 100) => [...new Set((Array.isArray(v) ? v : []).map((x) => label(x)).filter(Boolean))].slice(0, max);
export function publicStreamUrl(value: unknown): string | undefined {
  try { const url = new URL(label(value, 4096)); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    return url.toString(); } catch { return; }
}
export function parseDiscoveryPreferences(value: unknown): DiscoveryPreferences {
  if (!object(value) || value.version !== 1) throw new Error('Invalid discovery preferences');
  const data = defaultDiscoveryPreferences();
  if (object(value.shelves)) for (const [key, row] of Object.entries(value.shelves).slice(0, 100)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || !object(row) || !['default', 'cards', 'rows', 'compact', 'grid'].includes(String(row.layout))) continue;
    data.shelves[label(key)] = { layout: row.layout as ShelfLayout, size: ['small', 'large'].includes(String(row.size)) ? row.size as 'small' | 'large' : 'default',
      limit: typeof row.limit === 'number' && Number.isFinite(row.limit) ? Math.max(3, Math.min(50, Math.floor(row.limit))) : 20,
      ...([1, 2, 3].includes(Number(row.rows)) && typeof row.rows === 'number' ? { rows: row.rows as 1 | 2 | 3 } : {}) };
  }
  if (object(value.search)) {
    const seen = new Set<string>();
    const rows = Array.isArray(value.search.sections) ? value.search.sections : [];
    data.search.sections = rows.flatMap((row) => {
      if (!object(row) || !SEARCH_SECTION_KEYS.includes(row.key as SearchSectionKey) || seen.has(String(row.key))) return [];
      seen.add(String(row.key)); return [{ key: row.key as SearchSectionKey, enabled: row.enabled !== false }];
    });
    for (const key of SEARCH_SECTION_KEYS) if (!seen.has(key)) data.search.sections.push({ key, enabled: true });
    if (!data.search.sections.some((row) => row.enabled)) data.search.sections[0].enabled = true;
    data.search.density = value.search.density === 'compact' ? 'compact' : 'comfortable';
  }
  if (object(value.intent)) data.intent = { pinned: strings(value.intent.pinned, 30), hidden: strings(value.intent.hidden, 30) };
  data.stations = (Array.isArray(value.stations) ? value.stations : []).flatMap((row) => {
    if (!object(row)) return [];
    const id = label(row.id, 200), name = label(row.name), streamUrl = publicStreamUrl(row.streamUrl);
    if (!id.startsWith('localradio:') || !name || !streamUrl) return [];
    return [{ id, name, streamUrl, homePageUrl: publicStreamUrl(row.homePageUrl), imageUrl: publicStreamUrl(row.imageUrl) }];
  }).filter((row, i, all) => all.findIndex((s) => s.id === row.id) === i).slice(0, 500);
  data.folders = (Array.isArray(value.folders) ? value.folders : []).flatMap((row) => object(row) && label(row.id) && label(row.name) ? [{ id: label(row.id), name: label(row.name) }] : [])
    .filter((row, i, all) => all.findIndex((f) => f.id === row.id) === i).slice(0, 100);
  data.tags = strings(value.tags);
  if (object(value.assignments)) for (const [id, assignment] of Object.entries(value.assignments).slice(0, 10000)) {
    if (!/^(radio|podcast):/.test(id) || !object(assignment)) continue;
    data.assignments[id] = { folder: data.folders.some((f) => f.id === assignment.folder) ? String(assignment.folder) : undefined,
      tags: strings(assignment.tags).filter((tag) => data.tags.includes(tag)) };
  }
  return data;
}
export interface DiscoverySnapshot { profile: string | null; data: DiscoveryPreferences; loaded: boolean; error: boolean }
interface Access { read(profile: string): Promise<string | null>; write(profile: string, value: string): Promise<void>; remove(profile: string): Promise<void>; current(): string; owner(): () => boolean }
/** Reserve writes before publishing; deletion fences both pending reads and writes. */
export class DiscoveryRepository {
  private state: DiscoverySnapshot = { profile: null, data: defaultDiscoveryPreferences(), loaded: false, error: false };
  private generation = 0;
  private pending?: { profile: string; promise: Promise<void> };
  private writes = new Map<string, Promise<unknown>>();
  private deleted = new Map<string, number>();
  private listeners = new Set<() => void>();
  private access: Access;
  constructor(access: Access) { this.access = access; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: DiscoverySnapshot) { this.state = state; this.listeners.forEach((fn) => fn()); }
  invalidate = () => { this.generation++; this.pending = undefined; this.publish({ profile: null, data: defaultDiscoveryPreferences(), loaded: false, error: false }); };
  load(profile = this.access.current()): Promise<void> {
    if (profile !== this.access.current() || this.state.profile === profile && this.state.loaded) return Promise.resolve();
    if (this.pending?.profile === profile) return this.pending.promise;
    const generation = ++this.generation, owner = this.access.owner();
    this.publish({ profile, data: defaultDiscoveryPreferences(), loaded: false, error: false });
    const promise = (async () => { await this.writes.get(profile)?.catch(() => {});
      try { const raw = await this.access.read(profile); const data = raw ? parseDiscoveryPreferences(JSON.parse(raw)) : defaultDiscoveryPreferences();
        if (owner() && generation === this.generation && profile === this.access.current()) this.publish({ profile, data, loaded: true, error: false });
      } catch { if (owner() && generation === this.generation) this.publish({ ...this.state, error: true }); }
    })();
    this.pending = { profile, promise };
    void promise.finally(() => { if (this.pending?.promise === promise) this.pending = undefined; });
    return promise;
  }
  async change(profile: string, update: (data: DiscoveryPreferences) => DiscoveryPreferences): Promise<boolean> {
    if (profile !== this.access.current() || this.state.profile !== profile || !this.state.loaded) return false;
    const before = this.state, data = parseDiscoveryPreferences(update(before.data));
    const saved = this.save(profile, data);
    this.publish({ profile, data, loaded: true, error: false });
    return saved;
  }
  private save(profile: string, data: DiscoveryPreferences) {
    const payload = JSON.stringify(data), deleted = this.deleted.get(profile) ?? 0;
    const promise = (this.writes.get(profile) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if ((this.deleted.get(profile) ?? 0) !== deleted) return false;
      try { await this.access.write(profile, payload); return true; }
      catch { if (this.state.profile === profile) this.publish({ ...this.state, error: true }); return false; }
    });
    this.writes.set(profile, promise);
    void promise.finally(() => { if (this.writes.get(profile) === promise) this.writes.delete(profile); });
    return promise;
  }
  async exportProfile(profile: string) { await this.writes.get(profile)?.catch(() => {});
    const raw = await this.access.read(profile); return raw ? parseDiscoveryPreferences(JSON.parse(raw)) : defaultDiscoveryPreferences(); }
  async importProfile(profile: string, value: unknown) {
    const data = parseDiscoveryPreferences(value); const saved = await this.save(profile, data);
    if (!saved) throw new Error('Could not save discovery preferences');
    if (profile === this.access.current()) { this.generation++; this.pending = undefined; this.publish({ profile, data, loaded: true, error: false }); }
  }
  async clearProfile(profile: string) {
    this.deleted.set(profile, (this.deleted.get(profile) ?? 0) + 1);
    if (this.state.profile === profile) { this.generation++; this.pending = undefined; this.publish({ profile: null, data: defaultDiscoveryPreferences(), loaded: false, error: false }); }
    await this.writes.get(profile)?.catch(() => {}); await this.access.remove(profile);
  }
}

/** Hiding the currently selected category returns to All without a render/effect loop. */
export function resolvedSearchFilter(search: DiscoveryPreferences['search'], requested: SearchSectionKey | 'all'): SearchSectionKey | 'all' {
  return requested === 'all' || search.sections.some((row) => row.key === requested && row.enabled) ? requested : 'all';
}

export type HomeShelfPreset = 'default' | 'compact' | 'covers';
export function homeShelfPreset(data: DiscoveryPreferences, keys: readonly string[], preset: HomeShelfPreset): DiscoveryPreferences {
  if (preset === 'default') return { ...data, shelves: {} };
  const shelves: DiscoveryPreferences['shelves'] = { ...data.shelves };
  for (const key of keys) {
    if (key === 'dailyRecommendations') continue;
    const songs = key === 'mostPlayedSongs' || key === 'randomSongs';
    shelves[key] = { layout: songs ? 'default' : preset === 'compact' ? 'grid' : 'cards',
      size: preset === 'compact' ? 'small' : 'large', limit: preset === 'compact' ? 12 : 10, rows: preset === 'compact' ? 3 : songs ? 2 : 1 };
  }
  return { ...data, shelves };
}
