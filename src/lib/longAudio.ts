/** Explicit per-track progress and note bookmarks; ordinary music is never opted in by length. */
import type { Song } from '@/api/subsonic';

export const LONG_AUDIO_TRACK_LIMIT = 300;
export const LONG_AUDIO_BOOKMARK_LIMIT = 50;
export interface AudioBookmark { id: string; seconds: number; note: string; createdAt: number }
export interface LongAudioEntry {
  song: Pick<Song, 'id' | 'title' | 'artist' | 'album' | 'albumId' | 'duration'>;
  enabled: boolean; positionSec: number; durationSec: number; updatedAt: number; bookmarks: AudioBookmark[];
}
export type LongAudioEntries = Record<string, LongAudioEntry>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown, max = 604800) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
const text = (value: unknown, limit = 240) => typeof value === 'string' ? value.slice(0, limit) : '';
export function canRememberLongAudio(song: Song | null | undefined): song is Song {
  return !!song?.id && !song.url && !song.vod && !song.podcastChannelId && !song.id.startsWith('podcast:');
}
export function longAudioEntry(song: Song, previous?: LongAudioEntry, now = Date.now()): LongAudioEntry {
  return { song: { id: song.id, title: text(song.title), artist: text(song.artist), album: text(song.album),
    albumId: text(song.albumId, 1024) || undefined, duration: number(song.duration) || undefined },
  enabled: previous?.enabled ?? false, positionSec: previous?.positionSec ?? 0,
  durationSec: number(song.duration) || previous?.durationSec || 0, updatedAt: now, bookmarks: previous?.bookmarks ?? [] };
}
export function parseLongAudioEntries(raw: string | null): LongAudioEntries {
  if (!raw) return {};
  const source: unknown = JSON.parse(raw);
  if (!object(source)) throw new Error('Invalid long-audio data');
  return Object.fromEntries(Object.entries(source).flatMap(([id, value]) => {
    if (!id || id.length > 1024 || !object(value) || !object(value.song) || value.song.id !== id
      || typeof value.song.title !== 'string' || typeof value.enabled !== 'boolean') return [];
    const durationSec = number(value.durationSec), positionSec = number(value.positionSec);
    const seen = new Set<string>();
    const bookmarks = (Array.isArray(value.bookmarks) ? value.bookmarks : []).flatMap((mark) => {
      if (!object(mark) || typeof mark.id !== 'string' || !mark.id || seen.has(mark.id)
        || typeof mark.seconds !== 'number' || !Number.isFinite(mark.seconds) || mark.seconds < 0) return [];
      seen.add(mark.id);
      return [{ id: text(mark.id, 100), seconds: Math.min(number(mark.seconds), durationSec || Infinity),
        note: text(mark.note, 160), createdAt: number(mark.createdAt, Number.MAX_SAFE_INTEGER) }];
    }).slice(0, LONG_AUDIO_BOOKMARK_LIMIT).sort((a, b) => a.seconds - b.seconds);
    return [[id, { song: { id, title: text(value.song.title), artist: text(value.song.artist), album: text(value.song.album),
      albumId: text(value.song.albumId, 1024) || undefined, duration: durationSec || undefined },
    enabled: value.enabled, positionSec: Math.min(positionSec, durationSec || Infinity), durationSec,
    updatedAt: number(value.updatedAt, Number.MAX_SAFE_INTEGER), bookmarks } satisfies LongAudioEntry] as const];
  }).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, LONG_AUDIO_TRACK_LIMIT));
}
export function longAudioResumePosition(entry: LongAudioEntry | undefined, rewind = 10): number {
  if (!entry?.enabled || entry.positionSec < 5 || entry.durationSec > 0 && entry.positionSec >= entry.durationSec - 5) return 0;
  return Math.max(0, entry.positionSec - number(rewind, 60));
}

interface Snapshot { profile: string | null; entries: LongAudioEntries; hydrated: boolean; loading: boolean; error: boolean }
interface Access { read(profile: string): Promise<string | null>; write(profile: string, value: string): Promise<void>;
  remove(profile: string): Promise<void>; currentProfile(): string; now?: () => number }
/** Serialized writes keep their captured account. Failed reads cannot turn into empty saves. */
export class LongAudioRepository {
  private snapshot: Snapshot = { profile: null, entries: {}, hydrated: false, loading: false, error: false };
  private generation = 0;
  private pending?: { profile: string; task: Promise<void> };
  private writes = new Map<string, Promise<unknown>>();
  private deleted = new Map<string, number>();
  private listeners = new Set<() => void>();
  private readonly access: Access;
  constructor(access: Access) { this.access = access; }
  getSnapshot = () => this.snapshot;
  knownProfiles = () => [...new Set([...this.writes.keys(), ...(this.snapshot.profile ? [this.snapshot.profile] : [])])];
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Snapshot) { this.snapshot = next; this.listeners.forEach((fn) => fn()); }
  load = (profile = this.access.currentProfile()): Promise<void> => {
    if (profile !== this.access.currentProfile()) return Promise.resolve();
    if (this.snapshot.profile === profile && this.snapshot.hydrated) return Promise.resolve();
    if (this.pending?.profile === profile) return this.pending.task;
    const token = ++this.generation;
    this.publish({ profile, entries: {}, hydrated: false, loading: true, error: false });
    const task = (async () => {
      await this.writes.get(profile)?.catch(() => {});
      try {
        const entries = parseLongAudioEntries(await this.access.read(profile));
        if (token === this.generation && profile === this.access.currentProfile()) this.publish({ profile, entries, hydrated: true, loading: false, error: false });
      } catch {
        if (token === this.generation && profile === this.access.currentProfile()) this.publish({ ...this.snapshot, loading: false, error: true });
      }
    })();
    this.pending = { profile, task };
    void task.finally(() => { if (this.pending?.task === task) this.pending = undefined; });
    return task;
  };
  change(profile: string, id: string, update: (old: LongAudioEntry | undefined) => LongAudioEntry | undefined): Promise<boolean> {
    const state = this.snapshot;
    if (profile !== this.access.currentProfile() || state.profile !== profile || !state.hydrated || !id || id.length > 1024) return Promise.resolve(false);
    const existing = Object.hasOwn(state.entries, id) ? state.entries[id] : undefined;
    const entry = update(existing);
    if (entry && !existing && Object.keys(state.entries).length >= LONG_AUDIO_TRACK_LIMIT) return Promise.resolve(false);
    const entries = { ...state.entries };
    if (entry) Object.defineProperty(entries, id, { value: entry, enumerable: true, configurable: true, writable: true }); else delete entries[id];
    const bounded = Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, LONG_AUDIO_TRACK_LIMIT));
    // A subscriber can immediately record the accepted playback position when
    // enabling a track. Reserve this older write first, before publishing it.
    const saved = this.save(profile, bounded);
    this.publish({ ...state, entries: bounded });
    return saved;
  }
  private save(profile: string, entries: LongAudioEntries): Promise<boolean> {
    const payload = JSON.stringify(entries), deleted = this.deleted.get(profile) ?? 0;
    const task = (this.writes.get(profile) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if ((this.deleted.get(profile) ?? 0) !== deleted) return false;
      try {
        await this.access.write(profile, payload);
        if (this.snapshot.profile === profile && this.access.currentProfile() === profile && this.snapshot.error) this.publish({ ...this.snapshot, error: false });
        return true;
      } catch {
        if (this.snapshot.profile === profile && this.access.currentProfile() === profile) this.publish({ ...this.snapshot, error: true });
        return false;
      }
    });
    this.writes.set(profile, task);
    void task.finally(() => { if (this.writes.get(profile) === task) this.writes.delete(profile); });
    return task;
  }
  remember(profile: string, song: Song, positionSec: number, durationSec: number, force = false): Promise<boolean> {
    const previous = this.snapshot.profile === profile && Object.hasOwn(this.snapshot.entries, song.id) ? this.snapshot.entries[song.id] : undefined;
    if (!previous?.enabled || !canRememberLongAudio(song) || !Number.isFinite(positionSec) || positionSec < 0) return Promise.resolve(false);
    const now = this.access.now?.() ?? Date.now();
    if (!force && now >= previous.updatedAt && now - previous.updatedAt < 30_000) return Promise.resolve(true);
    return this.change(profile, song.id, (old) => {
      const duration = number(durationSec) || number(song.duration) || old?.durationSec || 0;
      return { ...longAudioEntry(song, old, now), positionSec: Math.min(number(positionSec), duration || Infinity), durationSec: duration };
    });
  }
  retry = () => this.snapshot.profile && this.snapshot.hydrated ? this.save(this.snapshot.profile, this.snapshot.entries) : Promise.resolve(false);
  removeProfile = async (profile: string) => {
    this.deleted.set(profile, (this.deleted.get(profile) ?? 0) + 1);
    if (this.snapshot.profile === profile) { this.generation++; this.pending = undefined; this.publish({ profile: null, entries: {}, hydrated: false, loading: false, error: false }); }
    await this.writes.get(profile)?.catch(() => {});
    await this.access.remove(profile);
  };
}
