import type { Song } from '@/api/subsonic';

const MAX_SONGS = 5;

function validCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)) : 0;
}

/** The local offline/outbox count may already be reflected by the server.
 * Taking the maximum avoids counting the same listen twice after reconnect. */
export function personalPlayCount(song: Song, counts: Readonly<Record<string, number>> = {}): number {
  return Math.max(validCount(song.playCount), validCount(counts[song.id]));
}

/** Bounded top-five insertion; unplayed songs never inherit the order of a
 * server's global/popular list. Equal counts use identity for stable ordering. */
export function selectFrequentlyPlayedSongs(
  songs: Iterable<Song>, counts: Readonly<Record<string, number>> = {}, limit = MAX_SONGS,
): Song[] {
  const capacity = Number.isFinite(limit) ? Math.min(MAX_SONGS, Math.max(0, Math.floor(limit))) : MAX_SONGS;
  if (!capacity) return [];
  const selected: { song: Song; count: number }[] = [];
  for (const song of songs) {
    if (!song.id || song.unavailable) continue;
    const count = personalPlayCount(song, counts);
    if (!count) continue;
    const existing = selected.findIndex((item) => item.song.id === song.id);
    if (existing >= 0) {
      if (selected[existing].count >= count) continue;
      selected.splice(existing, 1);
    }
    let position = 0;
    while (position < selected.length && (selected[position].count > count
      || selected[position].count === count && selected[position].song.id < song.id)) position++;
    if (position < capacity) {
      selected.splice(position, 0, { song, count });
      if (selected.length > capacity) selected.pop();
    }
  }
  return selected.map((item) => item.song);
}

/** Prefer explicit identities so artists sharing a name cannot borrow each
 * other's history. Name comparison is only for records without artist IDs. */
export function songMatchesFrequentArtist(song: Song, artistId: string, artistName?: string): boolean {
  const credits = [...(song.artists ?? []), ...(song.albumArtists ?? []),
    ...(song.contributors ?? []).filter((entry) => entry.role === 'remixer').map((entry) => entry.artist)];
  const ids = [song.artistId, ...credits.map((credit) => credit.id)].filter(Boolean);
  if (ids.length) return ids.includes(artistId);
  const normalize = (value: string | undefined) => (value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
  const wanted = normalize(artistName);
  return !!wanted && [song.artist, ...credits.map((credit) => credit.name)].some((name) => normalize(name) === wanted);
}
