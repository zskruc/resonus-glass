/** A fixed-size catalogue sample, never an all-song walk on a render path. */
import type { Album, Song } from '@/api/subsonic';
import { isAudiobookAlbum, isAudiobookSong } from './audiobook';
import type { RecommendationCandidates } from './dailyRecommendations';

export const DAILY_RANDOM_SAMPLE = 180;
export const DAILY_ALBUM_SAMPLE = 3;
export async function loadRecommendationCandidates(deps: {
  randomSongs(count: number): Promise<Song[]>;
  albums(type: 'recent' | 'byYear', count: number, offset: number): Promise<Album[]>;
  album(id: string): Promise<{ album: Album; songs: Song[] }>;
  counts(): Readonly<Record<string, number>>;
  now(): Date;
}, current: () => boolean): Promise<RecommendationCandidates> {
  const check = () => { if (!current()) throw new Error('Recommendation profile changed'); };
  check();
  const reads = await Promise.allSettled([
    deps.randomSongs(DAILY_RANDOM_SAMPLE), deps.albums('recent', 12, 15), deps.albums('byYear', 8, 0),
  ]);
  check();
  if (reads.every((result) => result.status === 'rejected')) throw new Error('Catalogue unavailable');
  const random = reads[0].status === 'fulfilled' ? reads[0].value as Song[] : [];
  const older = reads[1].status === 'fulfilled' ? reads[1].value as Album[] : [];
  const recent = reads[2].status === 'fulfilled' ? reads[2].value as Album[] : [];
  const songs = random.filter((song) => !isAudiobookSong(song)).slice(0, DAILY_RANDOM_SAMPLE);
  const rewindIds = new Set<string>(), releaseIds = new Set<string>();
  const year = deps.now().getFullYear();
  const requests = [
    ...older.filter((album) => !isAudiobookAlbum(album)).slice(0, DAILY_ALBUM_SAMPLE).map((album) => ({ album, rewind: true })),
    ...recent.filter((album) => !isAudiobookAlbum(album)).slice(0, DAILY_ALBUM_SAMPLE).map((album) => ({ album, rewind: false })),
  ];
  // Two album requests at a time; each album contributes at most 64 tracks.
  for (let index = 0; index < requests.length; index += 2) {
    check();
    const batch = requests.slice(index, index + 2);
    const albums = await Promise.allSettled(batch.map(({ album }) => deps.album(album.id)));
    check();
    albums.forEach((result, offset) => {
      if (result.status !== 'fulfilled') return;
      const { album, songs: tracks } = result.value;
      const taggedYear = album.originalReleaseDate?.year ?? album.releaseDate?.year ?? album.year;
      const knownRecent = !!taggedYear && taggedYear >= year - 1 && taggedYear <= year;
      for (const song of tracks.filter((track) => !isAudiobookSong(track)).slice(0, 64)) {
        songs.push({ ...song, year: song.year ?? taggedYear });
        if (batch[offset].rewind) rewindIds.add(song.id);
        else if (knownRecent) releaseIds.add(song.id);
      }
    });
  }
  check();
  return { songs, rewindIds, releaseIds, counts: { ...deps.counts() } };
}
