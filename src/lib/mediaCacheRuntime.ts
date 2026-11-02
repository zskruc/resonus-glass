import * as Backend from '@/api/backend';
import { getSongLyrics } from '@/api/data';
import { listArtistsPage } from '@/api/navidrome';
import type { Album, Artist, Song, SubsonicAuth } from '@/api/subsonic';
import type { LyricsSource } from '@/store/settings';
import { MediaCacheStopped } from './bulkMediaWorker';
import * as Db from './mediaCacheDb';
import type { MediaCacheKind, MediaCacheOutcome, MediaCacheTask } from './mediaCacheTypes';
import { cacheManagedCover } from './mirrorCovers';
import { withSpeculativeSlot } from './netBudget';
import { queryClient } from './query';

const ARTIST_METADATA_AGE = 24 * 60 * 60_000;

export function makeMediaCacheRuntime(auth: SubsonicAuth, profile: string, current: () => boolean,
  lyricsSource: LyricsSource = 'local') {
  let indexedArtists: Artist[] | undefined;
  let nativeArtists = auth.serverType === 'navidrome' && !!(auth.ndPassword ?? auth.password);
  const check = () => { if (!current()) throw new MediaCacheStopped('user'); };
  async function request<T>(work: () => Promise<T>, active = current): Promise<T> {
    if (!active()) throw new MediaCacheStopped('user');
    const result = await withSpeculativeSlot(active, work);
    if (!active()) throw new MediaCacheStopped('user');
    if (result === undefined) throw new MediaCacheStopped('user');
    return result;
  }
  return {
    page: async (kind: MediaCacheKind, offset: number, size: number): Promise<MediaCacheTask[]> => {
      if (kind === 'lyrics') {
        const songs = await request(() => Backend.getSongList(auth, 'server', size, offset));
        return songs.map((song) => ({ kind, id: song.id, data: { song, source: lyricsSource } }));
      }
      if (kind === 'albumCovers') {
        const albums = await request(() => Backend.getAlbumList(auth, 'alphabeticalByName', size, offset));
        return albums.map((album) => ({ kind, id: album.id, data: album }));
      }
      if (nativeArtists) {
        try {
          const artists = await request(() => listArtistsPage(auth, size, offset));
          return artists.map((artist) => ({ kind, id: artist.id, data: artist }));
        } catch (error) {
          check();
          if (offset !== 0) throw error;
          nativeArtists = false;
        }
      }
      // getArtists is the protocol's complete, unpaged index, not a search
      // first-N result. Slice locally only to checkpoint it in bounded batches.
      indexedArtists ??= await request(() => Backend.getArtists(auth));
      return indexedArtists.slice(offset, offset + size).map((artist) => ({ kind, id: artist.id, data: artist }));
    },
    process: async (task: MediaCacheTask, context: { signal: AbortSignal; current?: () => boolean }): Promise<MediaCacheOutcome> => {
      const active = () => current() && !context.signal.aborted && (!context.current || context.current());
      const check = () => { if (!active()) throw new MediaCacheStopped('user'); };
      check();
      if (task.kind === 'lyrics') {
        const { song, source } = task.data as { song: Song; source: LyricsSource };
        const old = await Db.lyricsCacheState(profile, song.id, source); check();
        if (old) return old;
        const lyrics = await request(() => getSongLyrics(song, source, { strict: true, stillCurrent: active, cache: 'caller' }), active);
        check();
        if (!lyrics?.lines.some((line) => line.value.trim())) {
          await Db.saveMissingLyrics(profile, song.id, source, active); return 'missing';
        }
        await Db.saveLyrics(profile, song.id, source, lyrics, active); return 'success';
      }
      if (task.kind === 'albumCovers') {
        const album = task.data as Album;
        if (album.coverArt === '') return 'missing';
        const from = album.coverArt ?? album.id;
        const result = await cacheManagedCover(profile, auth, { from, keys: [from, album.id], size: Backend.COVER.full }, active, context.signal);
        return result.outcome;
      }
      const artist = task.data as Artist;
      const old = await Db.readSavedArtist(profile, artist.id); check();
      const fresh = old?.detail && old.info && Date.now() - old.detailAt < ARTIST_METADATA_AGE
        && Date.now() - old.infoAt < ARTIST_METADATA_AGE;
      const detail = fresh ? old.detail! : await request(() => Backend.getArtist(auth, artist.id), active);
      check();
      if (!fresh) await Db.saveArtistDetail(profile, artist.id, detail, active);
      check();
      const info = fresh ? old.info! : await request(() => Backend.getArtistInfo(auth, artist.id), active);
      check();
      if (!info.imageUrl && detail.artist.coverArt === '') {
        await Db.saveArtistInfo(profile, artist.id, info, undefined, active); return 'missing';
      }
      const from = detail.artist.coverArt || `ar-${artist.id}`;
      // A real cover hash can request the application's 1200px hero tier.
      // Navidrome's signed largeImageUrl can instead contain a fixed small
      // resize; do not mistake that smaller response for a full hero. Other
      // servers without an artist cover hash retain their supplied large art.
      const result = await cacheManagedCover(profile, auth, { from, url: detail.artist.coverArt ? undefined : info.imageUrl,
        keys: [from, artist.id], size: Backend.COVER.full }, active, context.signal);
      check();
      await Db.saveArtistInfo(profile, artist.id, info, result.uri, active);
      check();
      // SQLite owns the full-library cache. Refresh already-opened queries,
      // without creating two in-memory metadata entries for every unseen artist.
      queryClient.setQueriesData({ queryKey: ['artist', artist.id], exact: true }, detail);
      queryClient.setQueriesData({ queryKey: ['artistInfo', artist.id], exact: true }, { ...info, imageUrl: result.uri ?? info.imageUrl });
      return result.outcome;
    },
  };
}
