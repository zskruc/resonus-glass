/** Serialized, validated local progress. A failed read never becomes an empty write. */
import type { AlbumProgressEntry } from './audiobook';

export type AlbumProgressByProfile = Record<string, Record<string, AlbumProgressEntry>>;
export interface AlbumProgressSnapshot { byProfile: AlbumProgressByProfile; hydrated: boolean; error: boolean }
type Access = { read(): Promise<string | null>; write(value: string): Promise<void>; now?: () => number };
const own = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validEntry = (entry: unknown): entry is AlbumProgressEntry => own(entry)
  && typeof entry.trackId === 'string' && entry.trackId.length > 0 && typeof entry.positionSec === 'number'
  && Number.isFinite(entry.positionSec) && entry.positionSec >= 0 && typeof entry.updatedAt === 'number'
  && Number.isFinite(entry.updatedAt) && entry.updatedAt >= 0;
export function parseAlbumProgress(raw: string | null): AlbumProgressByProfile {
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!own(value)) throw new Error('Invalid audiobook progress');
  return Object.fromEntries(Object.entries(value).map(([profile, entries]) => {
    if (!own(entries)) throw new Error('Invalid audiobook profile');
    const checked = Object.entries(entries).flatMap(([id, entry]) => id && validEntry(entry)
      ? [[id, { trackId: entry.trackId, positionSec: entry.positionSec, updatedAt: entry.updatedAt }] as const] : []);
    return [profile, Object.fromEntries(checked)];
  }));
}

export class AlbumProgressPersistence {
  private snapshot: AlbumProgressSnapshot = { byProfile: {}, hydrated: false, error: false };
  private listeners = new Set<() => void>();
  private hydration?: Promise<void>;
  private hydrationGeneration = 0;
  private touched = new Map<string, Set<string>>();
  private revision = 0;
  private dirty = false;
  private writes: Promise<void> = Promise.resolve();
  private readonly access: Access;
  constructor(access: Access) { this.access = access; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: AlbumProgressSnapshot) { this.snapshot = snapshot; for (const listener of [...this.listeners]) listener(); }
  hydrate = (): Promise<void> => {
    if (this.snapshot.hydrated) return Promise.resolve();
    if (this.hydration) return this.hydration;
    const generation = this.hydrationGeneration;
    const task = this.access.read().then((raw) => {
      if (generation !== this.hydrationGeneration) return;
      const byProfile = parseAlbumProgress(raw);
      // Local changes made while storage was loading win; untouched books survive.
      for (const [profile, ids] of this.touched) {
        const entries: Record<string, AlbumProgressEntry> = Object.assign(Object.create(null), byProfile[profile]);
        for (const id of ids) {
          const entry = this.snapshot.byProfile[profile]?.[id];
          if (entry) entries[id] = entry; else delete entries[id];
        }
        byProfile[profile] = entries;
      }
      this.touched.clear();
      this.publish({ byProfile, hydrated: true, error: false });
    }).catch((error) => {
      if (generation === this.hydrationGeneration) this.publish({ ...this.snapshot, error: true });
      throw error;
    }).finally(() => { if (this.hydration === task) this.hydration = undefined; });
    this.hydration = task;
    return task;
  };
  private change(scope: string, albumId: string, entry?: AlbumProgressEntry) {
    const entries: Record<string, AlbumProgressEntry> = Object.assign(Object.create(null), this.snapshot.byProfile[scope]);
    if (entry) entries[albumId] = entry; else delete entries[albumId];
    if (!this.snapshot.hydrated) {
      const ids = this.touched.get(scope) ?? new Set<string>(); ids.add(albumId); this.touched.set(scope, ids);
    }
    this.revision++; this.dirty = true;
    this.publish({ ...this.snapshot, byProfile: { ...this.snapshot.byProfile, [scope]: entries } });
  }
  remember(scope: string, albumId: string, trackId: string, positionSec: number, force = false) {
    if (!scope || !albumId || !trackId || !Number.isFinite(positionSec) || positionSec < 0) return;
    const now = this.access.now?.() ?? Date.now(), previous = this.snapshot.byProfile[scope]?.[albumId];
    if (!force && previous?.trackId === trackId && now >= previous.updatedAt && now - previous.updatedAt < 30_000) return;
    this.change(scope, albumId, { trackId, positionSec: Math.round(positionSec), updatedAt: now });
    void this.flush().catch(() => {});
  }
  clearAlbum(scope: string, albumId: string) {
    if (!scope || !albumId) return;
    this.change(scope, albumId);
    void this.flush().catch(() => {});
  }
  clearAll = (): Promise<void> => {
    // Explicit deletion wins even against a slow/broken previous hydration.
    this.hydrationGeneration++; this.touched.clear(); this.revision++; this.dirty = true;
    this.publish({ byProfile: {}, hydrated: true, error: false });
    return this.flush();
  };
  flush = (): Promise<void> => {
    const request = this.writes.catch(() => {}).then(async () => {
      await this.hydrate();
      if (!this.dirty) return;
      const revision = this.revision, payload = JSON.stringify(this.snapshot.byProfile);
      try {
        await this.access.write(payload);
        if (revision === this.revision) this.dirty = false;
        if (this.snapshot.error) this.publish({ ...this.snapshot, error: false });
      } catch (error) { this.publish({ ...this.snapshot, error: true }); throw error; }
    });
    this.writes = request;
    return request;
  };
}
