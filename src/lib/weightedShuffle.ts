/** Weighted sampling without replacement; every queue occurrence survives. */
export const SHUFFLE_MODES = ['uniform', 'frequentSongs', 'rareSongs', 'frequentArtists', 'rareArtists'] as const;
export type ShuffleMode = typeof SHUFFLE_MODES[number];
export interface ShuffleTrack { id: string; artist?: string; artistId?: string; artists?: { id: string; name: string }[]; playCount?: number }
export function normalizeShuffleMode(value: unknown): ShuffleMode {
  return (SHUFFLE_MODES as readonly unknown[]).includes(value) ? value as ShuffleMode : 'uniform';
}
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, 1_000_000_000) : 0;
/** Server and local observations overlap; adding them would double-count listening. */
export const shufflePlayCount = (song: ShuffleTrack, local: Readonly<Record<string, number>>) => Math.max(count(song.playCount), count(local[song.id]));
const artistKey = (song: ShuffleTrack) => song.artistId || song.artists?.[0]?.id
  || song.artist?.normalize('NFKC').trim().toLocaleLowerCase() || `unknown:${song.id}`;
const unit = (random: () => number) => {
  const value = random();
  return Number.isFinite(value) ? Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, value)) : 0.5;
};

/**
 * Log-compressed counts keep every track eligible. Artist modes first allocate
 * a weight to each artist, then share it among that artist's queue entries,
 * so a prolific artist does not win simply for occupying more list rows.
 * O(n log n) time / O(n) memory; no catalogue queries or source mutation.
 */
export function weightedShuffle<T extends ShuffleTrack>(
  source: readonly T[], mode: ShuffleMode = 'uniform', localCounts: Readonly<Record<string, number>> = {},
  random: () => number = Math.random,
): T[] {
  mode = normalizeShuffleMode(mode);
  if (mode === 'uniform') {
    const copy = source.slice();
    for (let index = copy.length - 1; index > 0; index--) {
      const at = Math.min(index, Math.floor(unit(random) * (index + 1)));
      [copy[index], copy[at]] = [copy[at], copy[index]];
    }
    return copy;
  }
  const artists = new Map<string, { plays: number; occurrences: number; seen: Set<string> }>();
  if (mode === 'frequentArtists' || mode === 'rareArtists') for (const song of source) {
    const key = artistKey(song);
    let artist = artists.get(key);
    if (!artist) artists.set(key, artist = { plays: 0, occurrences: 0, seen: new Set() });
    artist.occurrences++;
    if (!artist.seen.has(song.id)) { artist.plays += shufflePlayCount(song, localCounts); artist.seen.add(song.id); }
  }
  const rare = mode === 'rareSongs' || mode === 'rareArtists';
  return source.map((song, index) => {
    const artist = artists.get(artistKey(song));
    const strength = 1 + Math.log1p(artist?.plays ?? shufflePlayCount(song, localCounts));
    const weight = (rare ? 1 / strength : strength) / (artist?.occurrences ?? 1);
    return { song, index, priority: -Math.log(unit(random)) / weight };
  }).sort((left, right) => left.priority - right.priority || left.index - right.index).map(({ song }) => song);
}
