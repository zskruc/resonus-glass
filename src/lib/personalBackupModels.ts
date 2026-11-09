/** Portable user data. Allowlisted metadata only: no audio paths, credentials or stream URLs. */
import type { Song } from '@/api/subsonic';
import { matchPlaylistAsync, type PortableTrack } from './playlistExchange';
export interface BackupTrack extends PortableTrack { id?: string; }
export interface CarriedMarks { favorite?: boolean; rating?: number; }
export interface PendingPlaylistEntry { key: string; track: BackupTrack; songId?: string; marks?: CarriedMarks; }
export interface RecoveryPlaylist { key: string; playlistId: string; name: string; entries: PendingPlaylistEntry[]; updatedAt: number; }
export interface BackupAlbum { id?: string; title: string; artist?: string; }
export interface BackupArtist { id?: string; name: string; }
export interface PersonalBackup {
  format: 'resonus-personal-backup'; version: 1; createdAt: string; library: string;
  settings: Record<string, unknown>;
  favorites: { songs: BackupTrack[]; albums: BackupAlbum[]; artists: BackupArtist[] };
  ratings: { track: BackupTrack; value: number }[];
  playlists: { key: string; name: string; entries: PendingPlaylistEntry[] }[];
  extras: Record<string, unknown>;
  font?: { name: string; base64: string };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, n = 500): string => typeof v === 'string' ? v.replace(/[\0\r\n]/g, ' ').trim().slice(0, n) : '';
const id = (v: unknown) => { const s = str(v, 1024); return s && !/^(?:https?|file|content):/i.test(s) ? s : undefined; };
function array(v: unknown, limit: number): unknown[] { if (!Array.isArray(v) || v.length > limit) throw new Error('Invalid backup limits'); return v; }
export function portableBackupTrack(value: unknown): BackupTrack {
  if (!object(value) || !str(value.title)) throw new Error('Invalid backup track');
  const duration = typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0 && value.duration <= 604800 ? value.duration : undefined;
  return { title: str(value.title), artist: str(value.artist) || undefined, album: str(value.album) || undefined, duration, id: id(value.id) };
}
export function carriedMarks(v: unknown): CarriedMarks | undefined {
  if (!object(v)) return undefined;
  return { favorite: v.favorite === true || undefined,
    rating: typeof v.rating === 'number' && Number.isInteger(v.rating) && v.rating >= 1 && v.rating <= 5 ? v.rating : undefined };
}
export function pendingPlaylistEntries(v: unknown): PendingPlaylistEntry[] {
  const seen = new Set<string>();
  return array(v, 10000).map((raw, i) => {
    if (!object(raw)) throw new Error('Invalid playlist entry');
    const key = str(raw.key, 160) || `entry-${i}`;
    if (seen.has(key)) throw new Error('Duplicate playlist occurrence'); seen.add(key);
    return { key, track: portableBackupTrack(raw.track), songId: id(raw.songId), marks: carriedMarks(raw.marks) };
  });
}
/** Settings keys come from the installed version's export function, not imported filenames. */
export function validatePersonalBackup(v: unknown, settingsKeys: readonly string[]): PersonalBackup {
  if (!object(v) || v.format !== 'resonus-personal-backup' || v.version !== 1 || !object(v.favorites) || !object(v.settings) || !object(v.extras)) throw new Error('Invalid personal backup');
  const settings = Object.fromEntries(settingsKeys.filter((key) => Object.hasOwn(v.settings as object, key)).map((key) => [key, (v.settings as Record<string, unknown>)[key]]));
  if (JSON.stringify(settings).length > 2_000_000) throw new Error('Invalid backup limits');
  const albums = array(v.favorites.albums, 25000).map((x) => {
    if (!object(x) || !str(x.title)) throw new Error('Invalid favorite album');
    return { id: id(x.id), title: str(x.title), artist: str(x.artist) || undefined };
  });
  const artists = array(v.favorites.artists, 25000).map((x) => {
    if (!object(x) || !str(x.name)) throw new Error('Invalid favorite artist'); return { id: id(x.id), name: str(x.name) };
  });
  const ratings = array(v.ratings, 50000).map((x) => {
    if (!object(x) || !Number.isInteger(x.value) || (x.value as number) < 1 || (x.value as number) > 5) throw new Error('Invalid rating');
    return { track: portableBackupTrack(x.track), value: x.value as number };
  });
  const playlists = array(v.playlists, 1000).map((x) => {
    if (!object(x) || !str(x.name) || !id(x.key)) throw new Error('Invalid playlist');
    return { key: id(x.key)!, name: str(x.name), entries: pendingPlaylistEntries(x.entries) };
  });
  if (playlists.reduce((total, p) => total + p.entries.length, 0) > 100000) throw new Error('Invalid backup limits');
  let font: PersonalBackup['font'];
  if (v.font !== undefined) {
    if (!object(v.font) || typeof v.font.base64 !== 'string' || v.font.base64.length > 12_000_000 || !/^[a-z\d+/]*={0,2}$/i.test(v.font.base64)
      || !/^(?:AAEAAA|T1RUTw|dHJ1ZQ|dHlwMQ|dHRjZg)/.test(v.font.base64)) throw new Error('Invalid backup font');
    font = { name: str(v.font.name, 100).replace(/[^\p{L}\p{N}._ -]/gu, '_') || 'restored.ttf', base64: v.font.base64 };
  }
  // Feature-specific validators process these before the first write.
  const allowed = ['discovery', 'customizations', 'listeningTools', 'longAudio', 'lyricOffsets', 'lyricDisplay', 'smartRules', 'recovery', 'pins', 'albumProgress', 'listeningLedger', 'glass', 'pendingSongMarks', 'personalPlayback'];
  const extras = Object.fromEntries(allowed.filter((k) => Object.hasOwn(v.extras as object, k)).map((k) => [k, (v.extras as Record<string, unknown>)[k]]));
  if (JSON.stringify(extras).length > 20_000_000) throw new Error('Invalid backup limits');
  return { format: 'resonus-personal-backup', version: 1, createdAt: str(v.createdAt, 40), library: str(v.library, 100), settings,
    favorites: { songs: array(v.favorites.songs, 50000).map(portableBackupTrack), albums, artists }, ratings, playlists, extras, font };
}
export interface BackupMatch { track: BackupTrack; selected?: Song; candidates: Song[]; }
export async function matchBackupTracks(tracks: BackupTrack[], songs: Song[], sameLibrary: boolean, current: () => boolean): Promise<BackupMatch[]> {
  const byId = new Map(songs.map((s) => [s.id, s]));
  const result = await matchPlaylistAsync({ name: 'Recovery', tracks }, songs, { isCurrent: current });
  return result.map((row, i) => ({ ...row, track: tracks[i], selected: sameLibrary && tracks[i].id && byId.has(tracks[i].id!) ? byId.get(tracks[i].id!) : row.selected }));
}
/** Insert missing occurrences before their next surviving anchor. Duplicate songs retain occurrences. */
export function pendingPlaylistRows(entries: PendingPlaylistEntry[], songs: Song[]): { key: string; before: number; track: BackupTrack }[] {
  const available = new Map<string, number[]>();
  songs.forEach((song, i) => { const rows = available.get(song.id) ?? []; rows.push(i); available.set(song.id, rows); });
  const positions = entries.map((entry) => entry.songId ? available.get(entry.songId)?.shift() : undefined);
  const out: { key: string; before: number; track: BackupTrack }[] = [];
  let next = songs.length;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (positions[i] !== undefined) next = positions[i]!;
    else if (!entries[i].songId) out.push({ key: entries[i].key, before: next, track: entries[i].track });
  }
  return out.reverse();
}

/** Keep lost occurrences for a later catalogue check; an intentional playlist removal is never auto-restored. */
let recoveryOccurrenceSequence = 0;
export function observedRecoveryEntries(previous: PendingPlaylistEntry[], songs: Song[]): PendingPlaylistEntry[] {
  const available = new Map<string, PendingPlaylistEntry[]>();
  for (const e of previous) if (e.songId) { const group = available.get(e.songId) ?? []; group.push(e); available.set(e.songId, group); }
  const used = new Set<string>();
  const current = songs.map((song, index) => {
    const old = available.get(song.id)?.shift(); if (old) used.add(old.key);
    return old ? { ...old, track: portableBackupTrack(song) } : { key: `seen-${Date.now()}-${recoveryOccurrenceSequence++}-${index}`, songId: song.id, track: portableBackupTrack(song), marks: carriedMarks({ favorite: !!song.starred, rating: song.userRating }) };
  });
  const lost = previous.filter((e) => !used.has(e.key));
  // Lost anchors only affect local presentation after a full scan confirms the
  // library cannot resolve them. Existing entries retain their saved IDs here.
  const byKey = new Map(current.map((e, i) => [e.key, i]));
  const buckets = new Map<number, PendingPlaylistEntry[]>(); let next = current.length;
  for (let i = previous.length - 1; i >= 0; i--) {
    const p = byKey.get(previous[i].key);
    if (p !== undefined) next = p;
    else { const rows = buckets.get(next) ?? []; rows.unshift(previous[i]); buckets.set(next, rows); }
  }
  if (!lost.length) return current;
  const entries: PendingPlaylistEntry[] = [];
  for (let i = 0; i <= current.length; i++) { entries.push(...buckets.get(i) ?? []); if (i < current.length) entries.push(current[i]); }
  return entries;
}
