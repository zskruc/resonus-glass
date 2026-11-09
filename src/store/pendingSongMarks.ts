/** Unresolved favourites/ratings outlive a restore even when they are not in a playlist. */
import * as SQLite from 'expo-sqlite';
import { create } from 'zustand';
import { portableBackupTrack, carriedMarks, type BackupTrack, type CarriedMarks } from '@/lib/personalBackupModels';
import { personalOwner } from './playlistRecovery';
export interface PendingSongMark { key: string; track: BackupTrack; marks: CarriedMarks; updatedAt: number }
export interface PendingSongMarkInput { track: BackupTrack; marks: CarriedMarks }
const LIMIT = 50000;
let opening: Promise<SQLite.SQLiteDatabase> | undefined, serial: Promise<unknown> = Promise.resolve();
const deleted = new Map<string, number>();
export const usePendingSongMarks = create(() => ({ revision: 0 }));
const changed = () => usePendingSongMarks.setState((s) => ({ revision: s.revision + 1 }));
function identity(track: BackupTrack) {
  // Full identity, not a short hash: collisions must never combine two sets of private marks.
  const norm = (value?: string) => (value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
  return JSON.stringify([norm(track.title), norm(track.artist), norm(track.album), track.duration ?? null, track.id ?? null]);
}
function validated(input: unknown, now = Date.now()): PendingSongMark {
  if (!input || typeof input !== 'object') throw new Error('Invalid pending marks');
  const value = input as Record<string, unknown>, track = portableBackupTrack(value.track), marks = carriedMarks(value.marks);
  if (!marks || !marks.favorite && !marks.rating) throw new Error('Invalid pending marks');
  return { key: identity(track), track, marks, updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : now };
}
export function validatePendingSongMarks(value: unknown): PendingSongMark[] {
  if (!Array.isArray(value) || value.length > LIMIT) throw new Error('Pending marks limit exceeded');
  const rows = new Map<string, PendingSongMark>();
  for (const raw of value) {
    const row = validated(raw), old = rows.get(row.key);
    rows.set(row.key, old ? { ...row, marks: { favorite: old.marks.favorite || row.marks.favorite || undefined, rating: old.marks.rating ?? row.marks.rating } } : row);
  }
  return [...rows.values()];
}
async function database() {
  opening ??= SQLite.openDatabaseAsync('resonus-pending-song-marks.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA journal_size_limit=524288; CREATE TABLE IF NOT EXISTS pending_song_marks(profile TEXT NOT NULL,source TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(profile,source,id));'); return db;
  }).catch((error) => { opening = undefined; throw error; });
  return opening;
}
function run<T>(work: () => Promise<T>) { const task = serial.catch(() => {}).then(work); serial = task; return task; }
function checked(owner: ReturnType<typeof personalOwner>) {
  const token = deleted.get(owner.profile) ?? 0;
  return () => { owner.check(); if (token !== (deleted.get(owner.profile) ?? 0)) throw new Error('Pending marks profile changed'); };
}
export function savePendingSongMarks(records: PendingSongMarkInput[], owner = personalOwner()): Promise<void> {
  const values = validatePendingSongMarks(records), check = checked(owner); check();
  return run(async () => {
    check(); const db = await database(); check();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const old = await tx.getAllAsync<{ id: string; data: string }>('SELECT id,data FROM pending_song_marks WHERE profile=? AND source=?', owner.profile, owner.source); check();
      const existing = new Map(old.map((row) => [row.id, validated(JSON.parse(row.data))]));
      const total = new Set([...existing.keys(), ...values.map((row) => row.key)]).size;
      if (total > LIMIT) throw new Error('Pending marks limit exceeded');
      for (let i = 0; i < values.length; i++) {
        check(); const row = values[i], previous = existing.get(row.key);
        const merged = previous ? { ...row, marks: { favorite: previous.marks.favorite || row.marks.favorite || undefined, rating: previous.marks.rating ?? row.marks.rating } } : row;
        await tx.runAsync('INSERT OR REPLACE INTO pending_song_marks(profile,source,id,data) VALUES(?,?,?,?)', owner.profile, owner.source, row.key, JSON.stringify(merged));
        if (i && i % 100 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      check();
    });
    check(); changed();
  });
}
export async function exportPendingSongMarks(owner = personalOwner()): Promise<PendingSongMark[]> {
  const check = checked(owner); await serial.catch(() => {}); check(); const db = await database(); check();
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM pending_song_marks WHERE profile=? AND source=? ORDER BY id LIMIT 50001', owner.profile, owner.source); check();
  return validatePendingSongMarks(rows.map((row) => JSON.parse(row.data)));
}
export function deletePendingSongMark(key: string, owner = personalOwner()): Promise<void> {
  const check = checked(owner); check();
  return run(async () => { check(); const db = await database(); check(); await db.runAsync('DELETE FROM pending_song_marks WHERE profile=? AND source=? AND id=?', owner.profile, owner.source, key); check(); changed(); });
}
export function clearPendingSongMarksProfile(profile: string): Promise<void> {
  deleted.set(profile, (deleted.get(profile) ?? 0) + 1);
  return run(async () => { const db = await database(); await db.runAsync('DELETE FROM pending_song_marks WHERE profile=?', profile); changed(); });
}
