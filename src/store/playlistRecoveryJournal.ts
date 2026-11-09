/** Durable mutation intents. These contain metadata/IDs only, never playable media or credentials. */
import * as SQLite from 'expo-sqlite';
import { personalOwner } from './playlistRecovery';

type Owner = ReturnType<typeof personalOwner>;
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const deleted = new Map<string, number>();
function serial<T>(work: () => Promise<T>): Promise<T> { const task = queue.catch(() => {}).then(work); queue = task; return task; }
async function database() {
  opening ??= SQLite.openDatabaseAsync('resonus-recovery-journals.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS recovery_journals(profile TEXT NOT NULL,source TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(profile,source,id));'); return db;
  }).catch((error) => { opening = undefined; throw error; });
  return opening;
}
function identity(key: string) { if (!key || key.length > 4096 || /[\u0000-\u001f]/.test(key)) throw new Error('Invalid recovery journal key'); }
/** Do not let an accidental Song/auth object become a portable journal payload. */
function jsonValue(value: unknown): string {
  let nodes = 0;
  const walk = (item: unknown, depth: number): void => {
    if (++nodes > 150000 || depth > 16) throw new Error('Invalid recovery journal limits');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object') throw new Error('Invalid recovery journal value');
    if (Array.isArray(item)) { if (item.length > 20000) throw new Error('Invalid recovery journal limits'); for (const child of item) walk(child, depth + 1); return; }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null
      && !(Object.getPrototypeOf(prototype) === null && prototype.constructor?.name === 'Object')) throw new Error('Invalid recovery journal object');
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor', 'auth', 'authorization', 'password', 'token', 'accessToken', 'refreshToken', 'secret', 'localUri', 'url', 'uri', 'headers'].some((forbidden) => forbidden.toLowerCase() === key.toLowerCase())) throw new Error('Private data is not allowed in recovery journals');
      if (child !== undefined) walk(child, depth + 1);
    }
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery journal value');
  walk(value, 0); const text = JSON.stringify(value);
  if (text.length > 2_000_000) throw new Error('Recovery journal is too large');
  let bytes = 0;
  for (let at = 0; at < text.length; at++) {
    const point = text.codePointAt(at)!; bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (point >= 0x10000) at++;
    if (bytes > 2_000_000) throw new Error('Recovery journal is too large');
  }
  return text;
}
function check(owner: Owner, version: number) { owner.check(); if ((deleted.get(owner.profile) ?? 0) !== version) throw new Error('Recovery owner changed'); }
export async function readRecoveryJournal(key: string, owner = personalOwner()): Promise<Record<string, unknown> | undefined> {
  identity(key); const version = deleted.get(owner.profile) ?? 0; await queue.catch(() => {}); check(owner, version);
  const row = await (await database()).getFirstAsync<{ value: string }>('SELECT value FROM recovery_journals WHERE profile=? AND source=? AND id=?', owner.profile, owner.source, key);
  check(owner, version); if (!row) return undefined;
  const value = JSON.parse(row.value); jsonValue(value); return value;
}
export function saveRecoveryJournal(key: string, value: Record<string, unknown>, owner = personalOwner()): Promise<void> {
  identity(key); const text = jsonValue(value), version = deleted.get(owner.profile) ?? 0; check(owner, version);
  return serial(async () => { check(owner, version); const db = await database(); check(owner, version);
    await db.withExclusiveTransactionAsync(async (tx) => { check(owner, version);
      await tx.runAsync('INSERT OR REPLACE INTO recovery_journals(profile,source,id,value) VALUES(?,?,?,?)', owner.profile, owner.source, key, text); check(owner, version);
    }); check(owner, version);
  });
}
export function deleteRecoveryJournal(key: string, owner = personalOwner()): Promise<void> {
  identity(key); const version = deleted.get(owner.profile) ?? 0; check(owner, version);
  return serial(async () => { check(owner, version); const db = await database(); check(owner, version);
    await db.withExclusiveTransactionAsync(async (tx) => { check(owner, version); await tx.runAsync('DELETE FROM recovery_journals WHERE profile=? AND source=? AND id=?', owner.profile, owner.source, key); check(owner, version); });
  });
}
/** Deletion invalidates already accepted work before draining it. */
export function clearRecoveryJournalsProfile(profile: string): Promise<void> {
  deleted.set(profile, (deleted.get(profile) ?? 0) + 1);
  return serial(async () => { await (await database()).runAsync('DELETE FROM recovery_journals WHERE profile=?', profile); });
}
