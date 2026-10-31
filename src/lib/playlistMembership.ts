/** Playlist membership rules adapted from upstream 4c14dec5, with guarded index edits. */
import type { Playlist, Song } from '@/api/subsonic';

export type Membership = 'none' | 'some' | 'all';
export function presentIn(tracklist: readonly string[], wanted: readonly string[]): string[] {
  const have = new Set(tracklist);
  return [...new Set(wanted)].filter((id) => have.has(id));
}
export function membershipOf(present: readonly string[], wanted: readonly string[]): Membership {
  const count = presentIn(present, wanted).length;
  return count === 0 ? 'none' : count === new Set(wanted).size ? 'all' : 'some';
}
export function missingFrom(tracklist: readonly string[], songs: readonly Song[]): Song[] {
  const have = new Set(tracklist);
  return songs.filter((song) => {
    if (have.has(song.id)) return false;
    have.add(song.id); return true;
  });
}
export function indicesToRemove(tracklist: readonly string[], wanted: readonly string[]): number[] {
  const drop = new Set(wanted);
  return tracklist.flatMap((id, index) => drop.has(id) ? [index] : []).reverse();
}
export function canEditTracks(playlist: Pick<Playlist, 'owner' | 'readonly'>, username?: string) {
  return !playlist.readonly && (!playlist.owner || playlist.owner === username);
}
export function sameTracklist(first: readonly string[], second: readonly string[]) {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}
export function completeTracklist(playlist: Pick<Playlist, 'songCount'>, ids: readonly string[]) {
  return playlist.songCount == null || playlist.songCount === ids.length;
}
/** A lock is scoped to an account and playlist, not a mutable menu instance. */
export class PlaylistEditQueue {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key);
    const next = (previous ?? Promise.resolve()).catch(() => {}).then(work);
    this.tails.set(key, next);
    try { return await next; }
    finally { if (this.tails.get(key) === next) this.tails.delete(key); }
  }
}
