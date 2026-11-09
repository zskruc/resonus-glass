/** Explicit local corrections. Original media/server/cache documents stay untouched. */
import { mediaCacheDatabase } from './mediaCacheDb';
import { folderSetKey, hashKey } from './localLibrary';
import { captureLyricOwner } from './lyricOwner';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { validCustomizationValue } from './localCustomizationModels';

export type CustomizationKind = 'lyric-edit' | 'song-metadata' | 'artist-alias' | 'lyric-fonts';
export interface CustomizationScope { profile: string; source: string; }
export interface LocalCustomizationArchive { version: 1; entries: { source: string; kind: CustomizationKind; id: string; value: unknown }[]; }
const kinds: CustomizationKind[] = ['lyric-edit', 'song-metadata', 'artist-alias', 'lyric-fonts'];
const schema = `CREATE TABLE IF NOT EXISTS local_customizations(source TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,
  PRIMARY KEY(source,kind,id));`;
const initialized = new WeakMap<object, Promise<void>>(), pending = new Map<string, Promise<unknown>>();
const versions = new Map<string, number>();
const owners = new Map<string, object | null>(), retired = new Map<string, object | null>();
const listeners = new Set<() => void>();
let revision = 0;
let metadataRevision = 0;
export const customizationRevision = () => revision;
export const metadataCustomizationRevision = () => metadataRevision;
export function subscribeCustomizations(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function changed(kind?: CustomizationKind) {
  revision++;
  if (!kind || kind === 'song-metadata' || kind === 'artist-alias') metadataRevision++;
  for (const listener of listeners) listener();
}
export function customizationScope(): CustomizationScope {
  const { auth, offlineSource: source } = useAuthStore.getState();
  return { profile: profileScopeId(), source: auth ? 'server' : source ? source.mode === 'folder' ? `folder:${hashKey(folderSetKey(source.uris))}` : 'device' : 'server' };
}
export function captureCustomizationOwner(scope = customizationScope(), extra = () => true): () => boolean {
  const owner = captureLyricOwner(scope.profile), version = versions.get(scope.profile) ?? 0, auth = useAuthStore.getState().auth;
  if (scope.profile === profileScopeId()) owners.set(scope.profile, auth);
  return () => owner() && extra() && (versions.get(scope.profile) ?? 0) === version
    && (!retired.has(scope.profile) || retired.get(scope.profile) !== auth)
    && customizationScope().source === scope.source && scope.profile !== 'default';
}
async function database(profile: string) {
  const db = await mediaCacheDatabase(hashKey(profile));
  let ready = initialized.get(db);
  if (!ready) { ready = db.execAsync(schema).catch((error) => { initialized.delete(db); throw error; }); initialized.set(db, ready); }
  await ready; return db;
}
function check(current: () => boolean) { if (!current()) throw new Error('Local customization owner changed'); }
function serial<T>(profile: string, work: () => Promise<T>): Promise<T> {
  const task = (pending.get(profile) ?? Promise.resolve()).catch(() => {}).then(work);
  pending.set(profile, task); void task.finally(() => { if (pending.get(profile) === task) pending.delete(profile); }).catch(() => {});
  return task;
}
function validIdentity(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value); }
export async function readLocalCustomization<T>(scope: CustomizationScope, kind: CustomizationKind, id: string, current = captureCustomizationOwner(scope)): Promise<T | undefined> {
  check(current); const db = await database(scope.profile); check(current);
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM local_customizations WHERE source=? AND kind=? AND id=?', scope.source, kind, id);
  check(current); return row ? JSON.parse(row.value) as T : undefined;
}
export async function listLocalCustomizations<T>(scope: CustomizationScope, kind: CustomizationKind, current = captureCustomizationOwner(scope)): Promise<{ id: string; value: T }[]> {
  check(current); const db = await database(scope.profile); check(current);
  const rows = await db.getAllAsync<{ id: string; value: string }>('SELECT id,value FROM local_customizations WHERE source=? AND kind=? ORDER BY id LIMIT 10001', scope.source, kind);
  check(current); if (rows.length > 10000) throw new Error('Too many local corrections');
  return rows.map((row) => ({ id: row.id, value: JSON.parse(row.value) as T }));
}
export async function writeLocalCustomization(scope: CustomizationScope, kind: CustomizationKind, id: string, value: unknown | undefined,
  current = captureCustomizationOwner(scope)): Promise<void> {
  if (!validIdentity(id) || !kinds.includes(kind) || value !== undefined && !validCustomizationValue(kind, value)) throw new Error('Invalid local customization');
  if (kind === 'artist-alias' && value !== undefined && (value as { artistId?: string }).artistId !== id) throw new Error('Invalid artist alias identity');
  const text = value === undefined ? undefined : JSON.stringify(value);
  if (text && text.length > 1_500_000) throw new Error('Local correction is too large');
  check(current);
  await serial(scope.profile, async () => {
    check(current); const db = await database(scope.profile); check(current);
    await db.withExclusiveTransactionAsync(async (transaction) => {
      check(current);
      if (text === undefined) await transaction.runAsync('DELETE FROM local_customizations WHERE source=? AND kind=? AND id=?', scope.source, kind, id);
      else await transaction.runAsync('INSERT OR REPLACE INTO local_customizations(source,kind,id,value) VALUES(?,?,?,?)', scope.source, kind, id, text);
      check(current);
    });
    check(current); changed(kind);
  });
}
/** All source namespaces are included; account URLs and credentials are absent. */
export async function exportLocalCustomizations(profile: string, current = () => true): Promise<LocalCustomizationArchive> {
  const version = versions.get(profile) ?? 0, valid = () => current() && (versions.get(profile) ?? 0) === version;
  await pending.get(profile)?.catch(() => {}); check(valid);
  const db = await database(profile); check(valid);
  const entries: LocalCustomizationArchive['entries'] = []; let bytes = 0;
  for (let offset = 0; ; offset += 50) {
    const rows = await db.getAllAsync<{ source: string; kind: CustomizationKind; id: string; value: string }>(
      'SELECT source,kind,id,value FROM local_customizations ORDER BY source,kind,id LIMIT 50 OFFSET ?', offset);
    check(valid);
    for (const row of rows) { bytes += row.value.length; if (bytes > 32_000_000 || entries.length >= 10000) throw new Error('Local corrections exceed backup limit');
      entries.push({ source: row.source, kind: row.kind, id: row.id, value: JSON.parse(row.value) }); }
    if (rows.length < 50) break;
  }
  return { version: 1, entries };
}
export function validateLocalCustomizations(value: unknown): LocalCustomizationArchive {
  const data = value as LocalCustomizationArchive;
  if (!data || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 10000) throw new Error('Invalid local corrections backup');
  const seen = new Set<string>(), aliasOwners = new Map<string, string>(); let bytes = 0;
  for (const entry of data.entries) {
    if (!entry || !validIdentity(entry.id) || !/^(server|device|folder:[a-z0-9]{1,16})$/.test(entry.source)
      || !kinds.includes(entry.kind) || !validCustomizationValue(entry.kind, entry.value)) throw new Error('Invalid local correction entry');
    if (entry.kind === 'artist-alias') {
      const alias = entry.value as { artistId: string; canonical: string; aliases: string[] };
      if (alias.artistId !== entry.id) throw new Error('Invalid artist alias identity');
      for (const name of [alias.canonical, ...alias.aliases]) { const identity = JSON.stringify([entry.source, name]);
        if (aliasOwners.has(identity) && aliasOwners.get(identity) !== alias.artistId) throw new Error('Conflicting exact artist aliases');
        aliasOwners.set(identity, alias.artistId);
      }
    }
    const key = JSON.stringify([entry.source, entry.kind, entry.id]), text = JSON.stringify(entry.value);
    bytes += text.length; if (seen.has(key) || text.length > 1_500_000 || bytes > 32_000_000) throw new Error('Invalid local correction entries'); seen.add(key);
  }
  return JSON.parse(JSON.stringify(data));
}
export async function restoreLocalCustomizations(profile: string, raw: unknown, options: { replace?: boolean; current?: () => boolean } = {}): Promise<void> {
  const data = validateLocalCustomizations(raw), version = versions.get(profile) ?? 0;
  const own = captureCustomizationOwner({ profile, source: customizationScope().source });
  const current = () => (options.current?.() ?? own()) && (versions.get(profile) ?? 0) === version;
  await serial(profile, async () => { check(current); const db = await database(profile); check(current);
    await db.withExclusiveTransactionAsync(async (transaction) => {
      if (options.replace) await transaction.runAsync('DELETE FROM local_customizations');
      for (const entry of data.entries) { check(current); await transaction.runAsync('INSERT OR REPLACE INTO local_customizations(source,kind,id,value) VALUES(?,?,?,?)', entry.source, entry.kind, entry.id, JSON.stringify(entry.value)); }
      check(current);
    }); check(current); changed();
  });
}
/** Tombstone first, then drain accepted work so removed profiles cannot revive. */
export async function clearLocalCustomizationsProfile(profile: string): Promise<void> {
  versions.set(profile, (versions.get(profile) ?? 0) + 1);
  if (owners.has(profile)) retired.set(profile, owners.get(profile)!);
  else if (profile === profileScopeId()) retired.set(profile, useAuthStore.getState().auth);
  changed();
  await serial(profile, async () => { const db = await database(profile); await db.runAsync('DELETE FROM local_customizations'); });
}
