/** Durable logical playlist occurrences. Missing music remains metadata, never a playable fake Song. */
import * as SQLite from 'expo-sqlite';
import { create } from 'zustand';
import { hashKey, folderSetKey } from '@/lib/localLibrary';
import { pendingPlaylistEntries, type RecoveryPlaylist } from '@/lib/personalBackupModels';
import { profileScopeId, useAuthStore } from './auth';
import { profileKeyOf, useLibraries } from './libraries';
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let serial: Promise<unknown> = Promise.resolve();
let epoch = 0, watching = false;
const deleted = new Map<string, number>();
function watch() {
  if (watching) return; watching = true;
  useAuthStore.subscribe((a, b) => { if (a.auth !== b.auth || a.offlineSource !== b.offlineSource || a.offline !== b.offline || a.hydrating !== b.hydrating) epoch++; });
  useLibraries.subscribe((a, b) => { if (a.disabled !== b.disabled) epoch++; });
}
export function personalSourceKey(): string {
  const s = useAuthStore.getState();
  return s.auth ? 'server' : s.offlineSource?.mode === 'folder' ? `folders:${hashKey(folderSetKey(s.offlineSource.uris))}` : 'device';
}
export function personalOwner() {
  watch();
  const profile = profileScopeId(), source = personalSourceKey(), token = epoch, generation = deleted.get(profile) ?? 0;
  const current = () => token === epoch && generation === (deleted.get(profile) ?? 0) && profile === profileScopeId() && source === personalSourceKey() && !useAuthStore.getState().hydrating;
  return { profile, source, library: hashKey(`${profile}|${source}`), current, check: () => { if (!current()) throw new Error('Library changed. Reopen this page.'); } };
}
async function database() {
  opening ??= SQLite.openDatabaseAsync('resonus-playlist-recovery.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA journal_size_limit=524288; CREATE TABLE IF NOT EXISTS recovery_playlists(profile TEXT NOT NULL,source TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,entry_count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(profile,source,id)); CREATE TABLE IF NOT EXISTS restore_ledger(profile TEXT NOT NULL,source TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(profile,source,id));'); return db;
  }).catch((e) => { opening = undefined; throw e; }); return opening;
}
function run<T>(fn: () => Promise<T>): Promise<T> { const task = serial.catch(() => {}).then(fn); serial = task; return task; }
export const usePlaylistRecovery = create(() => ({ revision: 0 }));
const changed = () => usePlaylistRecovery.setState((s) => ({ revision: s.revision + 1 }));
function validate(v: unknown): RecoveryPlaylist {
  const p = v as RecoveryPlaylist;
  if (!p || typeof p.key !== 'string' || !p.key || p.key.length > 1024 || typeof p.playlistId !== 'string' || !p.playlistId || p.playlistId.length > 1024
    || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 500 || !Number.isFinite(p.updatedAt)) throw new Error('Invalid recovery playlist');
  return { key: p.key, playlistId: p.playlistId, name: p.name, updatedAt: p.updatedAt, entries: pendingPlaylistEntries(p.entries) };
}
export async function readRecoveryPlaylist(playlistId: string, owner = personalOwner()): Promise<RecoveryPlaylist | undefined> {
  await serial.catch(() => {}); owner.check();
  const row = await (await database()).getFirstAsync<{ data: string }>('SELECT data FROM recovery_playlists WHERE profile=? AND source=? AND id=?', owner.profile, owner.source, playlistId);
  owner.check(); return row ? validate(JSON.parse(row.data)) : undefined;
}
export function saveRecoveryPlaylist(value: RecoveryPlaylist, owner = personalOwner()): Promise<void> {
  const valid = validate(value); owner.check();
  return run(async () => { owner.check(); const db = await database(); owner.check();
    const existing = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) total FROM recovery_playlists WHERE profile=? AND source=?', owner.profile, owner.source); owner.check();
    if ((existing?.total ?? 0) >= 1000 && !(await db.getFirstAsync('SELECT 1 FROM recovery_playlists WHERE profile=? AND source=? AND id=?', owner.profile, owner.source, valid.playlistId))) throw new Error('Recovery list limit reached');
    owner.check();
    const total = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(entry_count),0) total FROM recovery_playlists WHERE profile=? AND source=? AND id<>?', owner.profile, owner.source, valid.playlistId);
    owner.check(); if ((total?.total ?? 0) + valid.entries.length > 100000) throw new Error('Recovery list limit reached');
    await db.runAsync('INSERT OR REPLACE INTO recovery_playlists(profile,source,id,data,entry_count) VALUES(?,?,?,?,?)', owner.profile, owner.source, valid.playlistId, JSON.stringify(valid), valid.entries.length); changed();
  });
}
export function deleteRecoveryPlaylist(playlistId: string, owner = personalOwner()): Promise<void> {
  return run(async () => { owner.check(); const db = await database(); owner.check(); await db.runAsync('DELETE FROM recovery_playlists WHERE profile=? AND source=? AND id=?', owner.profile, owner.source, playlistId); changed(); });
}
export async function exportPlaylistRecovery(owner = personalOwner()): Promise<RecoveryPlaylist[]> {
  await serial.catch(() => {}); owner.check();
  const rows = await (await database()).getAllAsync<{ data: string }>('SELECT data FROM recovery_playlists WHERE profile=? AND source=? ORDER BY id', owner.profile, owner.source);
  owner.check(); return rows.map((r) => validate(JSON.parse(r.data)));
}
export function validatePlaylistRecovery(value: unknown): RecoveryPlaylist[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid recovery data');
  const result = value.map(validate); if (result.reduce((n, p) => n + p.entries.length, 0) > 100000) throw new Error('Invalid recovery limits'); return result;
}
export async function importPlaylistRecovery(value: unknown, owner = personalOwner()) {
  const lists = validatePlaylistRecovery(value); for (const list of lists) { owner.check(); if (!(await readRecoveryPlaylist(list.playlistId, owner))) await saveRecoveryPlaylist(list, owner); }
}
export function restoredPlaylistId(archiveKey: string, owner = personalOwner()): Promise<string | undefined> {
  return run(async () => { owner.check(); const row = await (await database()).getFirstAsync<{ value: string }>('SELECT value FROM restore_ledger WHERE profile=? AND source=? AND id=?', owner.profile, owner.source, archiveKey); owner.check(); return row?.value; });
}
export function rememberRestoredPlaylist(archiveKey: string, playlistId: string, owner = personalOwner()) {
  return run(async () => { owner.check(); const db = await database(); owner.check(); await db.runAsync('INSERT OR REPLACE INTO restore_ledger(profile,source,id,value) VALUES(?,?,?,?)', owner.profile, owner.source, archiveKey, playlistId); });
}
export function clearPlaylistRecoveryProfile(profile: string): Promise<void> {
  deleted.set(profile, (deleted.get(profile) ?? 0) + 1); epoch++;
  return run(async () => { const db = await database(); await db.withExclusiveTransactionAsync(async (tx) => { await tx.runAsync('DELETE FROM recovery_playlists WHERE profile=?', profile); await tx.runAsync('DELETE FROM restore_ledger WHERE profile=?', profile); }); changed(); });
}

const observations = new Map<string, object>();
export async function observeRecoveryPlaylist(playlist: { id: string; name: string; songCount?: number }, songs: import('@/api/subsonic').Song[], owner = personalOwner()): Promise<void> {
  if ((playlist.songCount ?? songs.length) !== songs.length || songs.length > 10000 || !owner.current()) return;
  const key = JSON.stringify([owner.profile, owner.source, playlist.id]), token = {};
  observations.set(key, token);
  const original = owner;
  owner = { ...original, current: () => original.current() && observations.get(key) === token,
    check: () => { original.check(); if (observations.get(key) !== token) throw new Error('Stale playlist observation'); } };
  try {
  const { observedRecoveryEntries } = await import('@/lib/personalBackupModels');
  const old = await readRecoveryPlaylist(playlist.id, owner); owner.check();
  const entries = observedRecoveryEntries(old?.entries ?? [], songs);
  if (old && old.name === playlist.name && JSON.stringify(old.entries) === JSON.stringify(entries)) return;
  await saveRecoveryPlaylist({ key: old?.key ?? playlist.id, playlistId: playlist.id, name: playlist.name, entries, updatedAt: Date.now() }, owner);
  } finally { if (observations.get(key) === token) observations.delete(key); }
}

/** A downloaded subset or a hidden server library cannot prove a track is missing. */
export function wholeLibraryReadError(): string | undefined {
  const state = useAuthStore.getState();
  if (!state.auth) return undefined;
  if (state.offline) return 'Connect to the server before scanning or backing up the whole library.';
  const key = profileKeyOf(state.auth);
  if (key && (useLibraries.getState().disabled[key]?.length ?? 0) > 0) return 'Enable all server libraries before a complete backup or missing-track scan.';
  return undefined;
}
