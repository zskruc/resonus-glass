/** Recent plays retain their real order. Captured-key writes never migrate into another account. */
import { create } from 'zustand';
import type { Song, SubsonicAuth } from '@/api/subsonic';
import { primaryUrl } from '@/lib/serverUrls';
import { deleteItem, getItem, setItemStrict } from '@/lib/storage';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { profileScopeId, useAuthStore } from './auth';
const LEGACY_KEY = 'resonus.playHistory', MAX = 100;
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
function keyFor(profile: string, auth?: SubsonicAuth): string {
  if (auth) return `resonus.playHistory.server.${safe(primaryUrl(auth))}.${safe(auth.username)}`;
  if (profile === 'local') return 'resonus.playHistory.offline';
  if (profile === 'default') return LEGACY_KEY;
  const separator = profile.lastIndexOf('|');
  if (separator < 0) throw new Error('Invalid history profile');
  return `resonus.playHistory.server.${safe(profile.slice(0, separator))}.${safe(profile.slice(separator + 1))}`;
}
function storageKey() { return keyFor(profileScopeId(), useAuthStore.getState().auth ?? undefined); }
export interface HistoryEntry { song: Song; playedAt: number }
export function mergeHistoryEntries(...groups: readonly HistoryEntry[][]): HistoryEntry[] {
  const result = new Map<string, HistoryEntry>();
  for (const entries of groups) for (const entry of entries) {
    if (!entry?.song || typeof entry.song.id !== 'string' || !entry.song.id || typeof entry.song.title !== 'string'
      || !Number.isFinite(entry.playedAt) || entry.playedAt < 0) throw new Error('Invalid play history');
    const previous = result.get(entry.song.id); if (!previous || entry.playedAt > previous.playedAt) result.set(entry.song.id, entry);
  }
  return [...result.values()].sort((a, b) => b.playedAt - a.playedAt).slice(0, MAX);
}
interface PlayHistoryState { entries: HistoryEntry[]; hydrated: boolean; record(song: Song): void; clear(): (() => void) | undefined; hydrate(): Promise<void> }
let currentKey = '', ready = false, generation = 0, revision = 0;
let reading: { key: string; promise: Promise<void> } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined, tail: Promise<unknown> = Promise.resolve();
const pending = new Map<string, { entries: HistoryEntry[]; version: number; deleted: number }>();
const versions = new Map<string, number>(), deleted = new Map<string, number>(), duringRead = new Map<string, HistoryEntry[]>();
function schedule(key: string, entries: HistoryEntry[]) {
  const version = ++revision; versions.set(key, version); pending.set(key, { entries, version, deleted: deleted.get(key) ?? 0 });
  if (timer) clearTimeout(timer); timer = setTimeout(() => { void flushPlayHistory().catch(() => {}); }, 1000);
}
export function flushPlayHistory(): Promise<void> {
  if (timer) clearTimeout(timer); timer = undefined;
  const snapshots = [...pending]; pending.clear();
  const job = tail.catch(() => {}).then(async () => {
    let failed = false;
    for (const [key, value] of snapshots) {
      if (value.deleted !== (deleted.get(key) ?? 0)) continue;
      try { await setItemStrict(key, JSON.stringify(value.entries)); }
      catch { failed = true; if (versions.get(key) === value.version && !pending.has(key) && value.deleted === (deleted.get(key) ?? 0)) pending.set(key, value); }
    }
    if (failed) throw new Error('History could not be saved');
  });
  tail = job; void job.catch(() => {}); return job;
}
export const usePlayHistory = create<PlayHistoryState>((set, get) => ({
  entries: [], hydrated: false,
  record(song) {
    if (!song?.id) return;
    const key = storageKey();
    if (currentKey !== key) { currentKey = key; ready = false; set({ entries: [], hydrated: false }); }
    const fresh = { song, playedAt: Date.now() }, entries = mergeHistoryEntries([fresh], get().entries);
    if (!ready) duringRead.set(key, mergeHistoryEntries([fresh], duringRead.get(key) ?? []));
    set({ entries }); if (ready) schedule(key, entries);
  },
  clear() {
    const key = storageKey(), previous = get().entries, owns = captureLyricOwner();
    if (!ready || key !== currentKey || !previous.length) return;
    set({ entries: [] }); schedule(key, []);
    return () => { if (!owns() || storageKey() !== key || currentKey !== key || !ready) return;
      const entries = mergeHistoryEntries(get().entries, previous); set({ entries }); schedule(key, entries); };
  },
  hydrate() {
    const key = storageKey(), owns = captureLyricOwner();
    if (reading?.key === key) return reading.promise;
    const token = ++generation;
    if (currentKey !== key) set({ entries: [] }); currentKey = key; ready = false;
    const check = () => token === generation && storageKey() === key && owns();
    const promise = (async () => {
      await flushPlayHistory().catch(() => {});
      try {
        const raw = pending.has(key) ? JSON.stringify(pending.get(key)!.entries) : await getItem(key);
        if (!check()) return;
        let saved: HistoryEntry[] = [];
        if (raw !== null) { const value: unknown = JSON.parse(raw); if (!Array.isArray(value)) throw new Error('Invalid play history'); saved = mergeHistoryEntries(value as HistoryEntry[]); }
        else if (key !== LEGACY_KEY) {
          const inherited = await getItem(`${LEGACY_KEY}.migrationOwner`); if (!check()) return;
          if (!inherited || inherited === key) {
            const legacy = await getItem(LEGACY_KEY); if (!check()) return;
            if (legacy) {
              const parsed: unknown = JSON.parse(legacy); if (!Array.isArray(parsed)) throw new Error('Invalid play history'); saved = mergeHistoryEntries(parsed as HistoryEntry[]);
              await setItemStrict(`${LEGACY_KEY}.migrationOwner`, key); if (!check()) return;
              await setItemStrict(key, JSON.stringify(saved)); if (!check()) return;
              await deleteItem(LEGACY_KEY);
            }
          }
        }
        if (!check()) return;
        const extra = duringRead.get(key) ?? [], entries = mergeHistoryEntries(saved, extra); duringRead.delete(key);
        ready = true; set({ entries, hydrated: true }); if (extra.length) schedule(key, entries);
      } catch { if (check()) { ready = false; set({ hydrated: true }); } }
    })();
    reading = { key, promise }; void promise.finally(() => { if (reading?.promise === promise) reading = undefined; }); return promise;
  },
}));
export async function exportPlayHistory(current: () => boolean = () => true): Promise<HistoryEntry[]> {
  const key = storageKey(), owns = captureLyricOwner();
  if (!ready || key !== currentKey) await usePlayHistory.getState().hydrate();
  if (!ready || currentKey !== key || !current() || !owns()) throw new Error('History is unavailable');
  await flushPlayHistory(); if (!current() || !owns() || key !== currentKey) throw new Error('History profile changed');
  return mergeHistoryEntries(usePlayHistory.getState().entries);
}
export async function importPlayHistory(entries: HistoryEntry[], current: () => boolean): Promise<void> {
  const incoming = mergeHistoryEntries(entries), key = storageKey(), owns = captureLyricOwner();
  if (!ready || currentKey !== key) await usePlayHistory.getState().hydrate();
  if (!ready || key !== currentKey || !current() || !owns()) throw new Error('History is unavailable');
  const merged = mergeHistoryEntries(usePlayHistory.getState().entries, incoming); schedule(key, merged); usePlayHistory.setState({ entries: merged });
  await flushPlayHistory(); if (!current() || !owns()) throw new Error('History profile changed');
}
export async function clearPlayHistoryProfile(profile: string, auth?: SubsonicAuth) {
  const key = keyFor(profile, auth); deleted.set(key, (deleted.get(key) ?? 0) + 1); pending.delete(key); duringRead.delete(key);
  if (currentKey === key || reading?.key === key) { generation++; reading = undefined; currentKey = ''; ready = false; usePlayHistory.setState({ entries: [], hydrated: false }); }
  const job = tail.catch(() => {}).then(async () => { if (await getItem(`${LEGACY_KEY}.migrationOwner`) === key) await setItemStrict(`${LEGACY_KEY}.migrationOwner`, 'retired'); await deleteItem(key); });
  tail = job; await job;
}
