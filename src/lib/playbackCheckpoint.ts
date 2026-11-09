/** Tiny position-only persistence. Full queue identity remains in SecureStore. */
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { captureLyricOwner } from './lyricOwner';

export interface PlaybackCheckpointIdentity {
  generation: string;
  signature: string;
  index: number;
  songId: string;
  queueSavedAt: number;
}
export interface PlaybackCheckpointOptions { current?: () => boolean; signal?: AbortSignal }
export interface PlaybackCheckpoint { positionSec: number; savedAt: number }
interface Record extends PlaybackCheckpoint {
  version: 1; generation: string; signature: string; index: number;
  songKey: string; queueSavedAt: number; serial: number;
}
const MAX_BYTES = 16 * 1024;
const MAX_POSITION = 31 * 24 * 60 * 60;
const ROOT = `${FileSystem.documentDirectory}playback-checkpoints/`;
const queues = new Map<string, Promise<unknown>>();
const revisions = new Map<string, number>(), keyRevisions = new Map<string, number>();
const digests = new Map<string, Promise<string>>();
let generationSequence = 0, temporarySequence = 0;
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9e15;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f]/.test(value);
const scopedKey = (profile: string, queueKey: string) => JSON.stringify([profile, queueKey]);

/** Save this token in the full queue payload; never recreate it on restore. */
export function newPlaybackQueueGeneration(): string {
  return `${Date.now().toString(36)}-${(++generationSequence).toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/** Not a security digest: a bounded, synchronous identity over ordered IDs.
 * The independent persisted generation also prevents same-queue ABA. */
function signature(value: string): string {
  const hash = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < value.length; index++) for (let part = 0; part < hash.length; part++)
    hash[part] = Math.imul(hash[part] ^ (value.charCodeAt(index) + part * 257), 0x01000193);
  return hash.map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('');
}

export function playbackCheckpointIdentity(saved: {
  queue: readonly { id: string }[]; index: number; checkpointId?: string; savedAt?: number;
}): PlaybackCheckpointIdentity | undefined {
  if (!saved || !Array.isArray(saved.queue) || !saved.queue.length || saved.queue.length > 500
    || !Number.isInteger(saved.index) || saved.index < 0 || saved.index >= saved.queue.length
    || typeof saved.checkpointId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(saved.checkpointId)
    || !validTime(saved.savedAt) || saved.queue.some((song) => !song || !validId(song.id))) return;
  return { generation: saved.checkpointId, signature: signature(JSON.stringify(saved.queue.map((song) => song.id))),
    index: saved.index, songId: saved.queue[saved.index].id, queueSavedAt: saved.savedAt };
}
function validIdentity(value: PlaybackCheckpointIdentity): boolean {
  return !!value && /^[a-zA-Z0-9_-]{1,96}$/.test(value.generation) && /^[a-f\d]{32}$/.test(value.signature)
    && Number.isInteger(value.index) && value.index >= 0 && value.index < 500 && validId(value.songId) && validTime(value.queueSavedAt);
}
function parse(raw: string): Record | undefined {
  if (raw.length > MAX_BYTES) return;
  try {
    const value = JSON.parse(raw) as Record;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
      || !/^[a-zA-Z0-9_-]{1,96}$/.test(value.generation) || !/^[a-f\d]{32}$/.test(value.signature)
      || !/^[a-f\d]{32}$/.test(value.songKey) || !Number.isInteger(value.index) || value.index < 0 || value.index >= 500
      || !Number.isSafeInteger(value.serial) || value.serial < 1 || !validTime(value.queueSavedAt)
      || !validTime(value.savedAt) || value.savedAt < value.queueSavedAt
      || typeof value.positionSec !== 'number' || !Number.isFinite(value.positionSec) || value.positionSec < 0 || value.positionSec > MAX_POSITION) return;
    return value;
  } catch { return; }
}
function digest(value: string): Promise<string> {
  let pending = digests.get(value);
  if (!pending) {
    pending = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
    if (digests.size >= 64) digests.delete(digests.keys().next().value!);
    digests.set(value, pending);
    void pending.catch(() => { if (digests.get(value) === pending) digests.delete(value); });
  }
  return pending;
}
async function location(profile: string, queueKey?: string) {
  if (!validId(profile) || queueKey !== undefined && !validId(queueKey)) throw new Error('Invalid playback checkpoint scope');
  const directory = `${ROOT}${await digest(profile)}/`;
  return { directory, prefix: queueKey === undefined ? undefined : directory + await digest(queueKey) };
}
function serialized<T>(profile: string, work: () => Promise<T>): Promise<T> {
  const result = (queues.get(profile) ?? Promise.resolve()).then(work, work);
  const tail = result.catch(() => {});
  queues.set(profile, tail);
  void tail.finally(() => { if (queues.get(profile) === tail) queues.delete(profile); });
  return result;
}
function owner(profile: string, queueKey: string, options: PlaybackCheckpointOptions) {
  const owns = captureLyricOwner(profile), revision = revisions.get(profile) ?? 0, key = scopedKey(profile, queueKey);
  const keyRevision = keyRevisions.get(key) ?? 0;
  const current = () => owns() && revision === (revisions.get(profile) ?? 0) && keyRevision === (keyRevisions.get(key) ?? 0)
    && !options.signal?.aborted && (!options.current || options.current());
  const check = () => { if (!current()) throw new Error('Playback checkpoint owner changed'); };
  return { current, check };
}
async function readSlots(prefix: string, check: () => void): Promise<{ slot: number; record: Record }[]> {
  const records: { slot: number; record: Record }[] = [];
  for (const slot of [0, 1]) {
    check(); const uri = `${prefix}.${slot}.json`, info = await FileSystem.getInfoAsync(uri); check();
    if (!info.exists || info.isDirectory || (info.size ?? MAX_BYTES + 1) > MAX_BYTES) continue;
    const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 }); check();
    const record = parse(raw); if (record) records.push({ slot, record });
  }
  return records.sort((a, b) => b.record.serial - a.record.serial || b.record.savedAt - a.record.savedAt);
}
function matches(record: Record, identity: PlaybackCheckpointIdentity): boolean {
  return record.generation === identity.generation && record.signature === identity.signature
    && record.index === identity.index && record.songKey === signature(identity.songId) && record.queueSavedAt === identity.queueSavedAt;
}

/** A caller must also fence the active persisted queue generation while IO
 * waits. Account ownership is checked independently, including account ABA. */
export async function writePlaybackCheckpoint(profile: string, queueKey: string, identity: PlaybackCheckpointIdentity,
  positionSec: number, options: PlaybackCheckpointOptions & { current: () => boolean }): Promise<boolean> {
  if (!validIdentity(identity) || !Number.isFinite(positionSec) || positionSec < 0 || positionSec > MAX_POSITION) return false;
  const target = { ...identity }, own = owner(profile, queueKey, options);
  if (!own.current()) return false;
  return serialized(profile, async () => {
    let part: string | undefined;
    try {
      own.check(); const { directory, prefix } = await location(profile, queueKey); own.check();
      const before = await readSlots(prefix!, own.check); own.check();
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true }); own.check();
      // Keep the latest complete slot while replacing its older sibling. iOS
      // legacy move removes its destination first; the other slot survives a
      // crash in that gap. Android uses same-directory atomic rename.
      const slot = before.length ? 1 - before[0].slot : 0;
      const serial = (before[0]?.record.serial ?? 0) + 1;
      if (!Number.isSafeInteger(serial)) throw new Error('Playback checkpoint sequence exhausted');
      const record: Record = { version: 1, generation: target.generation, signature: target.signature,
        index: target.index, songKey: signature(target.songId), queueSavedAt: target.queueSavedAt,
        positionSec, savedAt: Math.max(Date.now(), target.queueSavedAt), serial };
      part = `${prefix}.${(++temporarySequence).toString(36)}.tmp`;
      await FileSystem.writeAsStringAsync(part, JSON.stringify(record), { encoding: FileSystem.EncodingType.UTF8 }); own.check();
      await FileSystem.moveAsync({ from: part, to: `${prefix}.${slot}.json` }); own.check();
      return true;
    } catch (error) {
      if (!own.current()) return false;
      throw error;
    } finally {
      if (part) await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
    }
  });
}

/** A legacy queue without checkpointId keeps its original saved position. */
export async function readPlaybackCheckpoint(profile: string, queueKey: string, identity: PlaybackCheckpointIdentity | undefined,
  options: PlaybackCheckpointOptions = {}): Promise<PlaybackCheckpoint | undefined> {
  if (!identity || !validIdentity(identity)) return;
  const target = { ...identity }, own = owner(profile, queueKey, options);
  if (!own.current()) return;
  return serialized(profile, async () => {
    try {
      own.check(); const { prefix } = await location(profile, queueKey); own.check();
      const records = await readSlots(prefix!, own.check); own.check();
      // Never fall back to an older generation just because the newest record
      // belongs to a replaced queue or selected occurrence.
      const latest = records[0]?.record;
      return latest && matches(latest, target) ? { positionSec: latest.positionSec, savedAt: latest.savedAt } : undefined;
    } catch (error) {
      if (!own.current()) return;
      throw error;
    }
  });
}

/** Revocation happens synchronously, before queued native IO can commit. An
 * explicit profile deletion may clear an inactive account too. */
export function clearPlaybackCheckpoint(profile: string, queueKey?: string): Promise<void> {
  if (!validId(profile) || queueKey !== undefined && !validId(queueKey)) return Promise.reject(new Error('Invalid playback checkpoint scope'));
  if (queueKey === undefined) revisions.set(profile, (revisions.get(profile) ?? 0) + 1);
  else { const key = scopedKey(profile, queueKey); keyRevisions.set(key, (keyRevisions.get(key) ?? 0) + 1); }
  return serialized(profile, async () => {
    const { directory, prefix } = await location(profile, queueKey);
    if (!prefix) { await FileSystem.deleteAsync(directory, { idempotent: true }); return; }
    for (const slot of [0, 1]) await FileSystem.deleteAsync(`${prefix}.${slot}.json`, { idempotent: true });
  });
}
