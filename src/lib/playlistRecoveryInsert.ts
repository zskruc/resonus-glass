import type { Song } from '@/api/subsonic';
import { pendingPlaylistEntries, pendingPlaylistRows, type RecoveryPlaylist } from './personalBackupModels';

export interface RecoveryInsertionIntent {
  version: 1; playlistId: string; before: string[]; after: string[];
  manifest: RecoveryPlaylist;
  assignments: { key: string; songId: string; before: number }[];
}
const id = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 1024 && !/[\u0000-\u001f]/.test(value);
const sequence = (left: string[], right: string[]) => left.length === right.length && left.every((value, i) => value === right[i]);
export function validateRecoveryInsertion(raw: unknown, playlistId: string): RecoveryInsertionIntent {
  const value = raw as RecoveryInsertionIntent;
  if (!value || value.version !== 1 || value.playlistId !== playlistId || !id(playlistId) || !Array.isArray(value.before) || !Array.isArray(value.after)
    || value.before.length > 10000 || value.after.length > 10000 || !value.before.every(id) || !value.after.every(id)
    || !Array.isArray(value.assignments) || !value.assignments.length || value.assignments.length > 10000
    || !value.manifest || value.manifest.playlistId !== playlistId || !id(value.manifest.key) || typeof value.manifest.name !== 'string'
    || !value.manifest.name.trim() || value.manifest.name.length > 500 || !Number.isFinite(value.manifest.updatedAt)) throw new Error('Invalid recovery insertion');
  const entries = pendingPlaylistEntries(value.manifest.entries), missing = new Set(entries.filter((entry) => !entry.songId).map((entry) => entry.key)), seen = new Set<string>();
  const buckets = new Map<number, string[]>();
  for (const row of value.assignments) {
    if (!row || !id(row.key) || !id(row.songId) || !Number.isInteger(row.before) || row.before < 0 || row.before > value.before.length || !missing.has(row.key) || seen.has(row.key)) throw new Error('Invalid recovery insertion assignment');
    seen.add(row.key); const group = buckets.get(row.before) ?? []; group.push(row.songId); buckets.set(row.before, group);
  }
  const after: string[] = [];
  for (let i = 0; i <= value.before.length; i++) { after.push(...buckets.get(i) ?? []); if (i < value.before.length) after.push(value.before[i]); }
  if (!sequence(after, value.after)) throw new Error('Invalid recovery insertion sequence');
  return { version: 1, playlistId, before: [...value.before], after, manifest: { key: value.manifest.key, playlistId, name: value.manifest.name, updatedAt: value.manifest.updatedAt, entries },
    assignments: value.assignments.map(({ key, songId, before }) => ({ key, songId, before })) };
}
export function recoveryInsertionIntent(manifest: RecoveryPlaylist, songs: Song[], selected: Map<string, Song>): RecoveryInsertionIntent | undefined {
  const assignments = pendingPlaylistRows(manifest.entries, songs).flatMap((row) => selected.has(row.key) ? [{ key: row.key, songId: selected.get(row.key)!.id, before: row.before }] : []);
  if (!assignments.length) return undefined;
  const buckets = new Map<number, string[]>(); for (const row of assignments) { const group = buckets.get(row.before) ?? []; group.push(row.songId); buckets.set(row.before, group); }
  const after: string[] = []; for (let i = 0; i <= songs.length; i++) { after.push(...buckets.get(i) ?? []); if (i < songs.length) after.push(songs[i].id); }
  return validateRecoveryInsertion({ version: 1, playlistId: manifest.playlistId, before: songs.map((song) => song.id), after, manifest, assignments }, manifest.playlistId);
}
/** A retry reconciles the exact post-write sequence before considering another server mutation. */
export async function completeRecoveryInsertion(intent: RecoveryInsertionIntent, access: {
  check(): void; readSongs(): Promise<Song[]>;
  insert(rows: { before: number; song: Song }[], expected: string[]): Promise<Song[]>;
  persistManifest(value: RecoveryPlaylist): Promise<void>;
  restoreMarks(song: Song, marks: NonNullable<RecoveryPlaylist['entries'][number]['marks']>): Promise<void>;
  finish(): Promise<void>;
}): Promise<{ manifest: RecoveryPlaylist; songs: Song[] }> {
  const value = validateRecoveryInsertion(intent, intent.playlistId); access.check();
  let songs = await access.readSongs(); access.check(); const actual = songs.map((song) => song.id);
  if (sequence(actual, value.before)) {
    // The data layer resolves these IDs afresh; the metadata cannot fabricate a source URI.
    songs = await access.insert(value.assignments.map((row) => ({ before: row.before, song: { id: row.songId, title: row.songId } })), value.before); access.check();
    if (!sequence(songs.map((song) => song.id), value.after)) throw new Error('Recovery sequence changed');
  } else if (!sequence(actual, value.after)) throw new Error('Recovery sequence changed');
  const assignments = new Map(value.assignments.map((row) => [row.key, row.songId]));
  const manifest = { ...value.manifest, entries: value.manifest.entries.map((entry) => assignments.has(entry.key) ? { ...entry, songId: assignments.get(entry.key)! } : entry), updatedAt: Date.now() };
  await access.persistManifest(manifest); access.check();
  const byId = new Map(songs.map((song) => [song.id, song]));
  for (const entry of value.manifest.entries) { const songId = assignments.get(entry.key), song = songId && byId.get(songId);
    if (song && entry.marks) { access.check(); await access.restoreMarks(song, entry.marks); access.check(); }
  }
  await access.finish(); access.check(); return { manifest, songs };
}
