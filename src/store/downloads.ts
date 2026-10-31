/**
 * Offline downloads (server → device).
 *
 * Files go to the app's private storage
 * (`documentDirectory/downloads/<server hash>/`) and alongside them a JSON
 * catalog is saved with metadata already known from the server (title, artist,
 * album, ids, cover) — without re-scanning ID3 tags. The local profile merges
 * this catalog with the scan of the chosen source (`localQueries.ensureCatalog`).
 * Since MediaStore and SAF don't see the private directory, the merge never
 * produces duplicates.
 *
 * Ids are kept as-is from the server (song and album), which enables the ↓ badge
 * on any profile and, in the future, deferred scrobbling or re-download at
 * another quality. The artist id is normalized to the local key (`normKey(name)`)
 * so artists merge with those from scanning.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { create } from 'zustand';

import {
  COVER,
  coverArtUrl,
  downloadUrl,
  getAlbum,
  getLyrics,
  getLyricsBySongId,
  streamUrl,
  type Album,
  type Artist,
  type Playlist,
  type Song,
  type SongLyrics,
  type SubsonicAuth,
} from '@/api/backend';
import { tg } from '@/i18n';
import { transcodeTarget } from '@/lib/audioQuality';
import {
  forgetCover,
  hashKey,
  normKey,
  registerCover,
  replaceCover,
  UNKNOWN_ARTIST,
} from '@/lib/localLibrary';
import { serializeLrc } from '@/lib/lrc';
import { siblingLrcUri } from '@/lib/localLyrics';
import * as Db from '@/lib/downloadsDb';
import type { DlAlbum } from '@/lib/downloadsDb';
import { netTally, timed } from '@/lib/perfLog';
import { queryClient } from '@/lib/query';
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore } from './auth';
import { useLibraryMirror } from './libraryMirror';
import { useSettings } from './settings';
import { useToast } from './toast';
import { createDownloadQueue, DownloadInterrupted, type DownloadContext, type DownloadQueueItem } from '@/lib/downloadQueue';
import { useNetworkType } from './networkType';
export type { DownloadQueueItem } from '@/lib/downloadQueue';

const ROOT_DIR = FileSystem.documentDirectory + 'downloads/';

// ── How much of the server we take at once ──────────────────────────────────
// The limit used to be three per group, and a group is not the unit anybody
// cares about: a discography downloading while an auto-download playlist
// reconciles was two groups, so six songs at a time, and on a server that
// transcodes each one that is six ffmpeg processes (#83). These slots are the
// whole app's budget, whatever is downloading and however it started.

/**
 * A server saying "not now" is not a song that cannot be downloaded, and until
 * now it was counted as one: whatever the server refused was skipped and
 * reported as failed at the end (#83). Three attempts, backing off in between.
 */
const ATTEMPTS = 3;
const RETRY_PAUSE_MS = 1500;

/** Is this worth trying again, or is the answer going to be the same? */
function worthRetrying(status: number | undefined): boolean {
  // No response at all (the network went away mid-transfer), too many requests,
  // or the server having a bad time. A 404 will still be a 404.
  return status === undefined || status === 429 || status >= 500;
}

class TransferError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface GroupProgress {
  done: number;
  total: number;
  /** Sum of real partial fractions across the group's unfinished songs. */
  fraction: number;
}

/** Mergeable view by the local profile (artists derived from albums). */
export interface DownloadsCatalog {
  songs: Song[];
  albums: DlAlbum[];
  artists: (Artist & { coverUri?: string })[];
}

export function serverDir(auth: SubsonicAuth): string {
  // PRIMARY URL, not the active one: when switching networks the active one
  // changes, and with it this directory, hiding downloads. The primary
  // identifies the profile.
  return `${ROOT_DIR}${hashKey(`${primaryUrl(auth)}|${auth.username}`)}/`;
}

/**
 * Serializes deletes and clears against each other. The catalog itself no
 * longer needs it: SQLite is the one keeping writes consistent.
 */
let catalogLock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = catalogLock.then(fn);
  catalogLock = run.catch(() => {});
  return run;
}

/** All server directories with downloads. */
async function serverDirs(): Promise<string[]> {
  try {
    const entries = await FileSystem.readDirectoryAsync(ROOT_DIR);
    return entries.map((e) => `${ROOT_DIR}${e}/`);
  } catch {
    return []; // ROOT_DIR does not exist yet
  }
}

// ── Active account's catalog, cached in memory ───────────────────────────

/** The albums and artists, which every offline screen needs. */
let cachedShelf: Omit<DownloadsCatalog, 'songs'> | null = null;
/**
 * The read in flight, if there is one.
 *
 * Six screens ask for this within the same second of a cold start, and none of
 * them had anything to wait on: each saw an empty cache and read the whole
 * shelf again. On a big library that is six times the same two hundred
 * milliseconds. Now the first one reads and the rest wait for it.
 */
let shelfReading: { dir: string; work: Promise<Omit<DownloadsCatalog, 'songs'>> } | null = null;
/** Same, for the songs, which cost twenty times more. */
let songsReading: { dir: string; work: Promise<Song[]> } | null = null;
let cachedForDir: string | null = null;
/** Every song, which only the screens that resolve ids need. Kept apart from
 *  the shelf because it is twenty times the size and comes at twenty times the
 *  cost (see `getDownloadsCatalog`). */
let cachedSongs: Song[] | null = null;
let cachedSongsDir: string | null = null;
/** The two of them handed out as one object, and always the SAME object: what
 *  reads it keys its own index on that identity (see `catalogSongs`). */
let cachedFull: DownloadsCatalog | null = null;

/** Counts hydrations, so a slower earlier one can't overwrite a later one. */
let hydrateRun = 0;

/** Download directory for the active server account (null if none). */
export function activeServerDir(): string | null {
  const auth = useAuthStore.getState().auth;
  return auth ? serverDir(auth) : null;
}

function deriveArtists(
  albums: DlAlbum[],
  /** What the catalog knows about them beyond their records: their picture. */
  known: Map<string, Db.DlArtist>,
): (Artist & { coverUri?: string })[] {
  const map = new Map<string, Artist & { coverUri?: string }>();
  for (const al of albums) {
    // The key is the untranslatable one (it is the artist's id, see
    // localLibrary); the name is what gets read, so it is the translated one.
    const key = normKey(al.artist || UNKNOWN_ARTIST);
    const name = al.artist || tg('Unknown artist');
    const existing = map.get(key);
    if (existing) {
      existing.albumCount = (existing.albumCount ?? 0) + 1;
      if (!existing.coverUri) existing.coverUri = al.coverUri;
    } else {
      map.set(key, { id: key, name, coverArt: key, albumCount: 1, coverUri: al.coverUri });
    }
  }
  // Their own picture wins over the album cover that was standing in for it.
  // The stand-in is kept where there is none: a face nobody has is not a
  // reason to show a grey square instead of the record it belongs to.
  for (const [key, artist] of map) {
    const cover = known.get(key)?.coverUri;
    if (cover) artist.coverUri = cover;
  }
  return Array.from(map.values());
}

/**
 * Downloads for the active SERVER account. This is the library for the "server
 * account offline" mode (the local profile only shows phone music). Each account
 * sees only its own. Registers covers in the global index.
 */
export async function getDownloadsCatalog(): Promise<DownloadsCatalog> {
  const dir = activeServerDir();
  if (!dir) return { songs: [], albums: [], artists: [] };
  const shelf = await getDownloadShelf();
  if (!cachedSongs || cachedSongsDir !== dir) {
    // Every song, which is what resolving an id offline needs. The shelf above
    // does not, and neither does the screen that shows it, so this waits until
    // something actually asks: on fifteen thousand downloads it is fifteen
    // thousand rows parsed out of the database, and it used to happen on the way
    // into the first offline screen whatever that screen was showing.
    if (!songsReading || songsReading.dir !== dir) {
      songsReading = { dir, work: timed('offline catalog', () => Db.allSongs(dir)) };
    }
    try {
      cachedSongs = await songsReading.work;
    } finally {
      if (songsReading?.dir === dir) songsReading = null;
    }
    cachedSongsDir = dir;
    cachedFull = null;
  }
  if (!cachedFull) cachedFull = { ...shelf, songs: cachedSongs };
  return cachedFull;
}

/**
 * The albums and artists of what is downloaded, without the songs.
 *
 * This is what the offline Library is made of, and what registers the covers of
 * downloads in the global index, so it is also what the data layer waits for
 * before answering anything. Six hundred albums where the songs are fifteen
 * thousand: the difference is the offline start.
 */
export async function getDownloadShelf(): Promise<Omit<DownloadsCatalog, 'songs'>> {
  const dir = activeServerDir();
  if (!dir) return { albums: [], artists: [] };
  if (!cachedShelf || cachedForDir !== dir) {
    if (!shelfReading || shelfReading.dir !== dir) {
      shelfReading = {
        dir,
        work: timed('offline shelf', async () => {
          const [albums, known] = await Promise.all([Db.allAlbums(dir), Db.allArtists(dir)]);
          return { albums, artists: deriveArtists(albums, new Map(known.map((a) => [a.id, a]))) };
        }),
      };
    }
    try {
      cachedShelf = await shelfReading.work;
    } finally {
      if (shelfReading?.dir === dir) shelfReading = null;
    }
    cachedForDir = dir;
  }
  // Always (not just on build): clearLocalCatalog() empties the global cover
  // index and downloaded covers need to be re-registered.
  for (const a of cachedShelf.albums) {
    registerCover(a.id, a.coverUri);
    // Under the server's id, so a song from the mirror or the queue finds its
    // own picture too, not only the catalog's rows (#214).
    for (const [id, uri] of Object.entries(a.trackCovers ?? {})) registerCover(id, uri);
  }
  for (const a of cachedShelf.artists) registerCover(a.id, a.coverUri);
  return cachedShelf;
}

/** Does the active account have downloads? A count, not the catalog. */
export async function hasDownloads(): Promise<boolean> {
  const dir = activeServerDir();
  if (!dir) return false;
  return (await Db.songCount(dir)) > 0;
}

/**
 * Keeps a downloaded artist's picture and their server id, from the artist
 * screen while there is a connection.
 *
 * The download itself writes the row, but at that moment all it has is what
 * the album says about them. This is the other half, and the half that covers
 * everything downloaded before any of this existed: opening an artist online
 * is when the app holds the real thing, so that is when it is written down.
 *
 * Only for artists whose music is actually on the phone. Everything else that
 * gets browsed belongs to the library mirror, which has its own rules about
 * what is worth keeping; the download catalog is about the files.
 */
export async function noteDownloadedArtist(auth: SubsonicAuth, artist: Artist): Promise<void> {
  const dir = activeServerDir();
  if (!dir || !artist.name) return;
  const key = normKey(artist.name);
  try {
    const known = await Db.artistByServerId(dir, artist.id);
    // Nothing to add: their picture is already here, under either id.
    if (known?.coverUri) return;
    // An indexed lookup, and the answer is almost always no.
    if ((await Db.artistAlbums(dir, key)).length === 0) return;
    const art = await downloadArtistArt(auth, dir, key, artist.coverArt ?? artist.id);
    await Db.saveArtists(dir, [
      { id: key, name: artist.name, serverId: artist.id, coverUri: art?.uri, dlBytes: art?.bytes },
    ]);
    // The shelf in memory was built before this, and the cover index already
    // has the album that was standing in for them. Without both of these the
    // picture only turns up on the next start, which is the bug this is fixing.
    if (art) {
      replaceCover(key, art.uri);
      resetCatalogCache();
    }
  } catch {
    // Best effort, like the covers: the artist screen has already been drawn.
  }
}

/**
 * Saves the own pictures of these downloaded songs that are not on the phone
 * yet, and points the catalog's rows at them. Returns whether anything changed.
 *
 * For what was downloaded before a track's own cover came down with it (#214):
 * those rows got the album's and the file was never fetched. `songs` carry the
 * server's cover id, because the catalog wrote the album's over it.
 */
async function keepTrackCovers(
  auth: SubsonicAuth,
  dir: string,
  albumId: string,
  songs: { id: string; cover: string }[],
): Promise<boolean> {
  const [existing] = await Db.albumsByIds(dir, [albumId]);
  if (!existing) return false;
  const catalog = await Db.albumSongs(dir, albumId);
  // Rows of a download that already fetched it: its bytes are in the total.
  const counted = new Set(catalog.map((s) => s.coverArt));
  const trackCovers = { ...existing.trackCovers };
  let added = false;
  let bytes = 0;
  for (const cover of new Set(songs.map((s) => s.cover))) {
    if (trackCovers[cover]) continue;
    const art = await downloadTrackArt(auth, dir, cover);
    if (!art) continue;
    trackCovers[cover] = art.uri;
    registerCover(cover, art.uri);
    if (!counted.has(art.uri)) bytes += art.bytes;
    added = true;
  }
  const coverOf = new Map(songs.map((s) => [s.id, trackCovers[s.cover]]));
  const rows = catalog.flatMap((s) => {
    const uri = coverOf.get(s.id);
    return uri && s.coverArt !== uri ? [{ ...s, coverArt: uri }] : [];
  });
  if (!added && rows.length === 0) return false;
  await Db.addToCatalog(dir, {
    songs: rows,
    albums: added ? [{ ...existing, trackCovers, dlBytes: (existing.dlBytes ?? 0) + bytes }] : [],
  });
  return true;
}

/**
 * The album screen's half of `keepTrackCovers`: a downloaded album opened with
 * a connection, which is when the server says which tracks have their own art.
 */
export async function noteDownloadedAlbum(
  auth: SubsonicAuth,
  album: Album,
  songs: Song[],
): Promise<void> {
  const dir = activeServerDir();
  if (!dir) return;
  const files = useDownloads.getState().files;
  const albumCover = album.coverArt ?? album.id;
  // On an ordinary record this comes out empty: no read and no request.
  const own = songs.flatMap((s) =>
    files[s.id] && s.coverArt && s.coverArt !== albumCover ? [{ id: s.id, cover: s.coverArt }] : [],
  );
  if (own.length === 0) return;
  try {
    if (await keepTrackCovers(auth, dir, album.id, own)) resetCatalogCache();
  } catch {
    // Best effort: the album screen has already been drawn.
  }
}

/** Written once the sweep has gone through a profile's downloads. */
const TRACK_COVERS_MARK = 'track-covers-1';
let sweepingTrackCovers = false;

/**
 * Once per profile, the same for everything downloaded before 0.7.7, without
 * waiting for each album to be opened. The mirror still knows which cover id
 * each track had, so the server is only asked for the pictures themselves.
 */
async function sweepTrackCovers(): Promise<void> {
  const auth = useAuthStore.getState().auth;
  const dir = activeServerDir();
  if (!auth || !dir || useAuthStore.getState().offline || sweepingTrackCovers) return;
  sweepingTrackCovers = true;
  try {
    const mark = `${dir}${TRACK_COVERS_MARK}`;
    if ((await FileSystem.getInfoAsync(mark)).exists) return;
    const byAlbum = new Map<string, { id: string; cover: string }[]>();
    const ids = Object.keys(useDownloads.getState().files);
    for (const s of await useLibraryMirror.getState().ownCoverSongs(ids)) {
      byAlbum.set(s.album, [...(byAlbum.get(s.album) ?? []), s]);
    }
    let changed = false;
    for (const [albumId, songs] of byAlbum) {
      // Left for the next start rather than half done without a connection.
      if (useAuthStore.getState().offline) return;
      changed = (await keepTrackCovers(auth, dir, albumId, songs)) || changed;
    }
    if (changed) resetCatalogCache();
    await FileSystem.writeAsStringAsync(mark, '');
  } catch {
    // Tried again on the next start.
  } finally {
    sweepingTrackCovers = false;
  }
}

/** Has this album got anything downloaded? One row, not the whole library. */
export async function albumHasDownloads(albumId: string): Promise<boolean> {
  const dir = activeServerDir();
  if (!dir) return false;
  return Db.albumHasSongs(dir, albumId);
}

/** Drops the in-memory view of the catalog, without asking anyone to re-read. */
function resetCatalogCache() {
  cachedShelf = null;
  cachedForDir = null;
  cachedSongs = null;
  cachedSongsDir = null;
  cachedFull = null;
  shelfReading = null;
  songsReading = null;
}

function invalidate() {
  resetCatalogCache();
  // Offline the whole library IS this catalog, so every list has to be asked
  // again. Online none of it comes from here — the server answers those, and
  // the "downloaded" mark on a row reads this store directly, which is already
  // reactive. Invalidating everything there meant that finishing a download
  // sent the app off to re-fetch its entire visible state from the server, for
  // nothing (#50).
  if (useAuthStore.getState().offline) void queryClient.invalidateQueries();
}

// ── File download ─────────────────────────────────────────────────────────

/** Reads a header case-insensitively (casing varies by platform). */
export function header(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : '';
}

/**
 * Is the response an error disguised as a file?
 *
 * Subsonic signals errors with **HTTP 200 and an error body** (`status:
 * "failed"`), not with an HTTP code, so checking `res.status` is not enough.
 * Tested against Navidrome 0.63.2: requesting `/rest/stream` or `/rest/download`
 * with a nonexistent id returns 200 and 182 bytes of JSON. Without this filter
 * that would be saved as .mp3, the song would be marked as downloaded, and it
 * would never be retried (`pending` skips what's already in `files`); you'd find
 * out when there's no coverage, which is exactly why you downloaded it.
 *
 * Uses a blocklist on purpose, not requiring `audio/*`: `/rest/download`
 * returns the raw file and some servers send it as
 * `application/octet-stream`. Requiring audio/* would leave those unable to
 * download anything — we'd replace a rare bug with a constant one. Here only
 * what cannot possibly be audio is rejected: the API's own JSON/XML, and
 * incidentally the HTML from a proxy or a wifi captive portal.
 */
export function isErrorBody(headers: Record<string, string> | undefined): boolean {
  return /^\s*(application\/json|application\/xml|text\/xml|text\/html)/i.test(
    header(headers, 'content-type'),
  );
}

// File extension the server returns when transcoding to each codec.
// '' = default transcoder (MP3 in Navidrome). AAC: Navidrome outputs raw
// ADTS (.aac); other servers may use MP4 container (.m4a), but it sounds
// the same (expo-audio detects by content) and only the label would vary.
const FORMAT_EXT: Record<string, string> = { '': 'mp3', mp3: 'mp3', opus: 'opus', aac: 'aac' };

function songFileUrl(
  auth: SubsonicAuth,
  song: Song,
): { url: string; ext: string; bitRate?: number } {
  const s = useSettings.getState();
  const { bitRate, format } = transcodeTarget(
    song,
    s.downloadBitRate,
    s.downloadFormat,
    s.downloadLosslessOnly,
  );
  return fileUrlFor(auth, song, bitRate, format);
}

/** Where to fetch a song's file from at this quality, and what it will be. */
export function fileUrlFor(
  auth: SubsonicAuth,
  song: Song,
  bitrate: number,
  format: string,
): { url: string; ext: string; bitRate?: number } {
  if (bitrate > 0) {
    return {
      url: streamUrl(auth, song.id, bitrate, 0, format),
      ext: FORMAT_EXT[format] ?? 'mp3',
      bitRate: bitrate,
    };
  }
  return { url: downloadUrl(auth, song.id), ext: song.suffix || 'mp3' };
}

/** Song as it enters the local catalog: server id + local file. */
function toLocalSong(
  song: Song,
  fileUri: string,
  dlBitRate?: number,
  dlBytes?: number,
  /**
   * Where this track's own cover was saved, when it had one of its own and it
   * came down (see `downloadTrackArt`). A file URI rather than the server's id
   * on purpose: `localCoverUrl` already answers one of those directly, the way
   * it does for a playlist's uploaded picture, so nothing has to be registered
   * at startup and nothing has to be read off disk to find out it is there.
   */
  coverUri?: string,
): Song {
  return {
    ...song,
    localUri: fileUri,
    // Written down now, while the file is right here: adding these up is what
    // Storage used reads, instead of asking the file system once per file.
    dlBytes,
    // Transcode bitrate at download time (if any): the file on disk doesn't
    // carry it, so the quality label can show it offline.
    dlBitRate,
    // Local artist id (by name) to merge with artists from scanning.
    artistId: normKey(song.artist || UNKNOWN_ARTIST),
    // Server ids don't work offline: we re-peg each artist by name.
    artists: song.artists?.map((a) => ({ id: normKey(a.name), name: a.name })),
    // Server ids, and no offline page to open.
    contributors: undefined,
    // Its own picture when this phone has it, the album's otherwise, which is
    // what every track used to get and what the ones with no cover of their
    // own still get (#214).
    coverArt: coverUri ?? song.albumId,
    addedAt: Date.now(),
    // Server favorites don't apply to the local profile (uses local favorites).
    starred: undefined,
  };
}

function toLocalAlbum(
  album: Album,
  coverUri?: string,
  dlBytes?: number,
  trackCovers?: Record<string, string>,
): DlAlbum {
  return {
    ...album,
    artistId: normKey(album.artist || UNKNOWN_ARTIST),
    artists: album.artists?.map((a) => ({ id: normKey(a.name), name: a.name })),
    coverArt: album.id,
    coverUri,
    dlBytes,
    trackCovers,
    addedAt: Date.now(),
  };
}

/**
 * Saves to the library mirror the COMPLETE tracklist of each album for these
 * songs (best-effort, in the background, while online). Thus, offline, an album
 * from which you only downloaded some songs shows in full with the non-downloaded
 * ones grayed out. Skips those already in the mirror to avoid repeated requests.
 */
async function mirrorAlbumTracklists(auth: SubsonicAuth, songs: Song[]): Promise<void> {
  const current = () => useAuthStore.getState().auth === auth && !useAuthStore.getState().offline;
  const mirror = useLibraryMirror.getState();
  const dir = activeServerDir();
  const ids = [...new Set(songs.map((s) => s.albumId).filter((id): id is string => !!id))];
  let refreshed = false;
  for (const id of ids) {
    if (!current()) return;
    // Already mirrored: asked one at a time, which is a row lookup.
    if (await mirror.albumDetail(id)) continue;
    if (!current()) return;
    try {
      const res = await getAlbum(auth, id);
      if (!current()) return;
      mirror.saveAlbum(id, res.album, res.songs, useDownloads.getState());
      if (dir) refreshed = (await refreshCatalogAlbum(auth, dir, res.album)) || refreshed;
    } catch {
      // best-effort: if the album can't be requested, it stays unmirrored.
    }
  }
  // The catalog in memory was read before any of that: this runs after the
  // group has finished and its own invalidation has already gone by.
  if (refreshed) resetCatalogCache();
}

/**
 * Puts the server's own album over the one the catalog wrote down, when the
 * catalog only had a stand-in.
 *
 * Downloading a playlist never sees an album: each row is a song, and the
 * album that goes into the catalog is assembled from what the song says (see
 * `albumFromSong`). That is a name and a year, so offline those records said
 * nothing about what kind of release they are and their artist had no id the
 * server would recognize. This is the same request the mirror was making
 * anyway, so the real album costs nothing extra here.
 *
 * The cover and the date stay: they are this phone's, not the server's.
 */
async function refreshCatalogAlbum(
  auth: SubsonicAuth,
  dir: string,
  album: Album,
): Promise<boolean> {
  const [existing] = await Db.albumsByIds(dir, [album.id]);
  if (!existing) return false;
  await Db.addToCatalog(dir, {
    albums: [
      {
        ...toLocalAlbum(album, existing.coverUri, existing.dlBytes, existing.trackCovers),
        addedAt: existing.addedAt ?? Date.now(),
      },
    ],
  });
  await saveAlbumArtist(auth, dir, album);
  return true;
}

/**
 * Writes down who an album is by.
 *
 * Their picture is what stands between an album cover standing in for a face
 * and a real artist screen offline, and the id the server knows them by is
 * what lets that screen be reached from anything that remembers them from when
 * there was a connection — a recent search, a mirrored album.
 *
 * Servers answer for an artist's picture by their id, so without one there is
 * nothing to ask for. The row is still worth writing: opening the artist while
 * online fills the rest in (see `noteDownloadedArtist`).
 */
async function saveAlbumArtist(auth: SubsonicAuth, dir: string, album: Album, current: () => boolean = () => true): Promise<void> {
  if (!current()) throw new DownloadInterrupted('Artist metadata interrupted');
  const key = normKey(album.artist || UNKNOWN_ARTIST);
  const art = album.artistId ? await downloadArtistArt(auth, dir, key, album.artistId, current) : undefined;
  if (!current()) throw new DownloadInterrupted('Artist metadata interrupted');
  await Db.saveArtists(dir, [
    {
      id: key,
      name: album.artist ?? '',
      serverId: album.artistId,
      coverUri: art?.uri,
      dlBytes: art?.bytes,
    },
  ]);
}

/** Synthesized album from a song (playlists with partially downloaded albums). */
function albumFromSong(song: Song): Album {
  return {
    id: song.albumId ?? `dl-${hashKey(song.album || song.id)}`,
    name: song.album || tg('Unknown album'),
    artist: song.artist,
    year: song.year,
  };
}

/**
 * Caches a newly downloaded song's lyrics as `.lrc` alongside the
 * file, so the local profile finds them without network (lyrics phase 2).
 * Without lyrics (or without the songLyrics extension on the server) nothing happens.
 */
async function cacheLyricsForDownload(auth: SubsonicAuth, song: Song, audioFile: string, current: () => boolean = () => true): Promise<void> {
  try {
    let lyrics: SongLyrics | null = null;
    if (!current()) return;
    try {
      lyrics = await getLyricsBySongId(auth, song.id);
      if (!current()) return;
      // It answered, and it has nothing. The classic endpoint reads the same
      // place, so asking it too is a second request per song for an answer
      // already given, and downloading a library makes thousands of them queue
      // in front of what the screens are waiting for (#50). Playback stopped
      // doing this; the download path had been left behind.
      if (!lyrics) return;
    } catch {
      if (!current()) return;
      // Server without the songLyrics extension: try the classic endpoint.
      const plain = await getLyrics(auth, song.artist ?? '', song.title);
      if (!current()) return;
      if (plain) lyrics = { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
    }
    if (!lyrics) return;
    const lrcFile = siblingLrcUri(audioFile);
    if (lrcFile) await FileSystem.writeAsStringAsync(lrcFile, serializeLrc(lyrics));
  } catch {
    // The download is still valid without lyrics.
  }
}

/**
 * Sizes for downloads made before they were written down, filled in once.
 *
 * In parallel batches rather than one file after another, and saved into the
 * catalog, so a library downloaded with an older version pays this once and
 * never again.
 */
async function measureMissing(
  dir: string,
  entries: { id: string; uri: string }[],
): Promise<number> {
  const BATCH = 24;
  let total = 0;
  const measured: { id: string; bytes: number }[] = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const sizes = await Promise.all(batch.map((e) => fileSize(e.uri)));
    batch.forEach((e, j) => {
      measured.push({ id: e.id, bytes: sizes[j] });
      total += sizes[j];
    });
  }
  await Db.setSongBytes(dir, measured);
  return total;
}

/** Size of a file, 0 if it can't be read. */
export async function fileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? ((info as { size?: number }).size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** The cover, with what it takes on disk: measured here, once per album, so
 *  Storage used never has to measure anything. */
function downloadCover(
  auth: SubsonicAuth,
  dir: string,
  album: Album,
  current: () => boolean = () => true,
): Promise<{ uri: string; bytes: number } | undefined> {
  return downloadArt(auth, dir, `${dir}covers/${hashKey(album.id)}.jpg`, album.coverArt ?? album.id, current);
}

/**
 * A track's own cover, for the tracks that have one.
 *
 * Keyed by the cover id and not by the song, because that is what tracks
 * sharing a picture share: Navidrome gives a track its own artwork id only
 * when the file really carries one (`mf.HasCoverArt && EnableMediaFileCoverArt`
 * in its `MediaFile.CoverArtID`), and otherwise hands back the disc's or the
 * album's. So on a two-disc record every track of a disc names the same `dc-…`
 * id, and one file on disk serves the lot.
 */
function downloadTrackArt(
  auth: SubsonicAuth,
  dir: string,
  coverId: string,
  current: () => boolean = () => true,
): Promise<{ uri: string; bytes: number } | undefined> {
  return downloadArt(auth, dir, `${dir}covers/track_${hashKey(coverId)}.jpg`, coverId, current);
}

/**
 * The artist's own picture, next to the covers and fetched the same way.
 *
 * Under a name of its own, `artist_…`, because the two are keyed by different
 * things — an album by the server's id, an artist by their name normalized —
 * and nothing says those can never hash to the same file.
 */
function downloadArtistArt(
  auth: SubsonicAuth,
  dir: string,
  artistKey: string,
  coverId: string,
  current: () => boolean = () => true,
): Promise<{ uri: string; bytes: number } | undefined> {
  return downloadArt(auth, dir, `${dir}covers/artist_${hashKey(artistKey)}.jpg`, coverId, current);
}

async function downloadArt(
  auth: SubsonicAuth,
  dir: string,
  file: string,
  coverId: string,
  current: () => boolean = () => true,
): Promise<{ uri: string; bytes: number } | undefined> {
  const url = coverArtUrl(auth, coverId, COVER.card);
  if (!url || !current()) return undefined;
  try {
    const existing = await FileSystem.getInfoAsync(file);
    if (!current()) return undefined;
    if (existing.exists) {
      return { uri: file, bytes: (existing as { size?: number }).size ?? 0 };
    }
    await FileSystem.makeDirectoryAsync(`${dir}covers/`, { intermediates: true }).catch(() => {});
    if (!current()) return undefined;
    netTally('coverArt.view (download)');
    const res = await FileSystem.downloadAsync(url, file);
    // Same care as with audio, and we also need to delete: the download writes
    // whatever comes, and with the bad file on disk the shortcut above
    // (`existing.exists`) would consider it a valid cover forever.
    if (res.status !== 200 || isErrorBody(res.headers)) {
      await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
      return undefined;
    }
    return { uri: file, bytes: Number(header(res.headers, 'content-length')) || (await fileSize(file)) };
  } catch {
    return undefined;
  }
}

interface DownloadsState {
  /** Song id (server) → uri of the downloaded file. */
  files: Record<string, string>;
  /**
   * Song id → bitrate (kbps) at which it was transcoded on download, if
   * transcoded. Queried by id (not by song object) because offline the player
   * may show the song from the server mirror, not the catalog. Only new
   * transcoded downloads have this.
   */
  dlBitRates: Record<string, number>;
  /** Progress per ongoing group: `album:<id>` / `playlist:<id>` / `artist:<id>`. */
  active: Record<string, GroupProgress>;
  queue: DownloadQueueItem[];
  queuePaused: boolean;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  cancelAll: () => Promise<void>;
  /**
   * `files` has been read from disk. Until then it is empty, which reads the
   * same as "nothing is downloaded" — and whoever decides something by that
   * (see the library mirror) would decide it wrong.
   */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  downloadAlbum: (album: Album, songs: Song[]) => Promise<void>;
  downloadPlaylist: (playlist: Playlist, songs: Song[]) => Promise<void>;
  /**
   * Downloads an artist's discography (group `artist:<id>`). Receives songs
   * and albums already: the artist screen only has the album list, so
   * the caller is the one who already fetched them.
   */
  downloadArtist: (artistId: string, songs: Song[], albums: Album[]) => Promise<void>;
  /** Downloads all favorite songs (group 'favorites'). */
  /** Every song of a genre, gathered by the screen that asks (see the genre page). */
  downloadGenre: (genre: string, songs: Song[]) => Promise<void>;
  downloadFavorites: (songs: Song[]) => Promise<void>;
  downloadSong: (song: Song) => Promise<void>;
  /** Downloads a loose batch of songs (multiple selection). */
  downloadSongs: (songs: Song[]) => Promise<void>;
  /** Stops an ongoing group download (already downloaded items are kept). */
  cancelDownload: (groupKey: string) => void;
  /** Deletes files for those songs and removes them from the catalog. */
  deleteSongs: (songIds: string[]) => Promise<void>;
  /**
   * Forgets a download whose file is not on the disk any more, and says whether
   * it did.
   *
   * The catalog is what the app goes by: a row here is a badge on the row, a
   * song that counts as playable offline and a file handed to the player
   * instead of the stream. A row whose file has gone is all three of those
   * promises broken at once, and the player is where it shows: it is the one
   * that gets handed the path (see `onPlaybackError`). An empty file counts as
   * gone: a download interrupted where nothing noticed is the same nothing to
   * play.
   *
   * Only when the file system answers. Not being able to look is not an answer,
   * and deleting somebody's download on the strength of it would be worse than
   * the failure it is trying to explain.
   */
  forgetIfMissing: (songId: string) => Promise<boolean>;
  clearAll: () => Promise<void>;
  usageBytes: () => Promise<number>;
}

/**
 * Is anything downloaded at all? A selector, not a count.
 *
 * `Object.keys(files).length > 0` was the way to ask, and on a library of
 * fifteen thousand downloads that allocates an array of fifteen thousand
 * strings to look at the first one. It ran in the root layout, in Settings and
 * on the artist screen, and it ran again on every change to this store, which
 * while something is downloading is several times a second.
 */
export function anyDownloads(s: { files: Record<string, string> }): boolean {
  for (const _ in s.files) return true;
  return false;
}

/** true only if the active connection is mobile data (for "Wi-Fi only" mode). */
async function onMobileData(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.CELLULAR;
  } catch {
    return false; // when in doubt, don't block the download
  }
}

export const useDownloads = create<DownloadsState>((set, get) => {
  const groupRuns = new Map<string, { token: object; keys: string[]; cancel: () => void }>();
  let sequence = 0;
  const scope = (auth: SubsonicAuth) => hashKey(`${primaryUrl(auth)}|${auth.username}`);
  const allowed = () => {
    const state = useAuthStore.getState();
    return !!state.auth && !state.offline && useNetworkType.getState().connected
      && !(useSettings.getState().downloadWifiOnly && useNetworkType.getState().cellular);
  };
  const queue = createDownloadQueue({ owner: () => useAuthStore.getState().auth, profile: scope, allowed,
    limit: () => useSettings.getState().downloadConcurrency,
    update: (items, paused) => {
      const active: Record<string, GroupProgress> = {};
      const groups = new Map<string, GroupProgress & { pending: boolean }>();
      for (const item of items) for (const key of item.groups) {
        let group = groups.get(key);
        if (!group) { group = { done: 0, total: 0, fraction: 0, pending: false }; groups.set(key, group); }
        group.total++;
        if (item.status === 'completed') group.done++;
        if (item.status === 'queued' || item.status === 'downloading' || item.status === 'paused') {
          group.pending = true;
          if (item.bytesTotal > 0) group.fraction += Math.min(1, item.bytesWritten / item.bytesTotal);
        }
      }
      for (const [key, group] of groups) if (group.pending) active[key] = { done: group.done, total: group.total, fraction: group.fraction };
      set({ queue: items, queuePaused: paused, active });
    },
  });
  useAuthStore.subscribe((state, previous) => {
    if (previous.auth && !state.auth) {
      const old = scope(previous.auth);
      for (const [key, group] of groupRuns) if (key.startsWith(old + '|')) { group.cancel(); groupRuns.delete(key); }
      void queue.removeProfile(old);
    }
    for (const removed of previous.profiles ?? []) if (removed._type === 'server'
      && !(state.profiles ?? []).some((profile) => profile._type === 'server' && scope(profile) === scope(removed))) {
      void queue.removeProfile(scope(removed));
    }
    queue.sync();
  });
  useNetworkType.subscribe(() => queue.sync());
  useSettings.subscribe((state, previous) => {
    if (state.downloadConcurrency !== previous.downloadConcurrency || state.downloadWifiOnly !== previous.downloadWifiOnly) queue.sync();
  });

  /** Existing group entry points all feed one per-account, per-song queue. */
  async function downloadGroup(groupKey: string, songs: Song[], albums: Album[]): Promise<void> {
    const intent = useAuthStore.getState().auth;
    if (!intent || useAuthStore.getState().offline) return;
    if (useSettings.getState().downloadWifiOnly && await onMobileData()) {
      if (useAuthStore.getState().auth === intent) useToast.getState().show(tg('Connect to Wi-Fi to download'));
      return;
    }
    if (useAuthStore.getState().auth !== intent || !allowed()) return;
    const groupId = `${scope(intent)}|${groupKey}`;
    if (groupRuns.has(groupId)) return;
    const seen = new Set<string>();
    const pending = songs.filter((song) => {
      if (get().files[song.id] || song.url || song.localUri || seen.has(song.id)) return false;
      seen.add(song.id); return true;
    });
    if (!pending.length) return;
    let cancel!: () => void;
    const stopped = new Promise<'cancelled'>((resolve) => { cancel = () => resolve('cancelled'); });
    const group = { token: {}, keys: pending.map((song) => song.id), cancel };
    groupRuns.set(groupId, group);
    const dir = serverDir(intent);
    const albumById = new Map(albums.map((album) => [album.id, album]));
    const albumWork = new Map<string, Promise<void>>(), artistWork = new Map<string, Promise<void>>();
    const trackArt = new Map<string, string>();
    const ensureAlbum = async (song: Song, context: DownloadContext) => {
      const album = song.albumId ? albumById.get(song.albumId) : albumById.get(`dl-${hashKey(song.album || song.id)}`);
      if (!album) return;
      const existing = albumWork.get(album.id);
      if (existing) {
        try { await existing; return; }
        catch (error) {
          context.check();
          if (!(error instanceof DownloadInterrupted)) throw error;
          if (albumWork.get(album.id) === existing) albumWork.delete(album.id);
          return ensureAlbum(song, context);
        }
      }
      const work = (async () => {
        context.check();
        const cover = await downloadCover(context.auth, dir, album, context.current); context.check();
        const coverId = album.coverArt ?? album.id;
        const own = new Set(pending.filter((track) => track.albumId === album.id && track.coverArt && track.coverArt !== coverId).map((track) => track.coverArt!));
        const [old] = own.size ? await Db.albumsByIds(dir, [album.id]) : [];
        context.check();
        const trackCovers: Record<string, string> = { ...old?.trackCovers }; let artBytes = 0;
        for (const id of own) {
          context.check(); const art = await downloadTrackArt(context.auth, dir, id, context.current); context.check();
          if (art) { trackArt.set(id, art.uri); trackCovers[id] = art.uri; registerCover(id, art.uri); artBytes += art.bytes; }
        }
        context.check();
        await Db.addToCatalog(dir, { albums: [toLocalAlbum(album, cover?.uri, (cover?.bytes ?? 0) + artBytes,
          Object.keys(trackCovers).length ? trackCovers : undefined)] });
        context.check();
        const key = normKey(album.artist || UNKNOWN_ARTIST);
        let artist = artistWork.get(key);
        if (!artist) { artist = saveAlbumArtist(context.auth, dir, album, context.current); artistWork.set(key, artist);
          void artist.catch(() => { if (artistWork.get(key) === artist) artistWork.delete(key); }); }
        await artist; context.check();
      })();
      albumWork.set(album.id, work);
      void work.catch(() => { if (albumWork.get(album.id) === work) albumWork.delete(album.id); });
      return work;
    };
    const promises = pending.map((song) => {
      const suffix = ++sequence;
      let transfer: ReturnType<typeof FileSystem.createDownloadResumable> | undefined;
      let transferAuth: SubsonicAuth | undefined, transferUrl = '', resume = false, offset = 0;
      let response: FileSystem.FileSystemDownloadResult | undefined;
      let part = '', final = '', dlBitRate: number | undefined, moved = false, committed = false, ownsFinal = false, expectedTotal = 0;
      const cleanup = async () => {
        if (part) await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
        const lrc = part ? siblingLrcUri(part) : null;
        if (lrc) await FileSystem.deleteAsync(lrc, { idempotent: true }).catch(() => {});
        if (moved && ownsFinal && !committed) {
          await FileSystem.deleteAsync(final, { idempotent: true }).catch(() => {});
          const ownLrc = siblingLrcUri(final);
          if (ownLrc) await FileSystem.deleteAsync(ownLrc, { idempotent: true }).catch(() => {});
          moved = false; ownsFinal = false; response = undefined; transfer = undefined; resume = false; offset = 0; expectedTotal = 0;
        }
      };
      return queue.add(song, groupKey, async (context) => {
        try {
          context.check();
          await FileSystem.makeDirectoryAsync(`${dir}files/`, { intermediates: true }); context.check();
          await ensureAlbum(song, context); context.check();
          for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            try {
              const source = songFileUrl(context.auth, song);
              const destination = `${dir}files/${hashKey(song.id)}.${source.ext}`;
              if (!part) { final = destination; part = `${dir}files/${hashKey(song.id)}.queue-${suffix}.${source.ext}`; dlBitRate = source.bitRate; }
              if (!response) {
                // A changed source/codec cannot be appended to an old partial.
                if (transfer && (source.url !== transferUrl || transferAuth !== context.auth)) {
                  transfer = undefined; resume = false; offset = 0; await cleanup(); context.check();
                  final = destination; part = `${dir}files/${hashKey(song.id)}.queue-${suffix}.${source.ext}`; dlBitRate = source.bitRate;
                }
                if (!transfer) {
                  transferUrl = source.url; transferAuth = context.auth;
                  transfer = FileSystem.createDownloadResumable(source.url, part, {}, (progress) => {
                    context.progress(progress.totalBytesWritten, progress.totalBytesExpectedToWrite);
                  });
                }
                // Recreate the callback on resume: the old callback belongs to
                // the previous run's owner, and must remain inert after pause.
                else if (resume) {
                  const saved = transfer.savable();
                  // Native pause returns before its last IO callback settles.
                  // This run starts only after the old run ended, so its real
                  // file length is now the authoritative Android Range offset.
                  if (/^\d+$/.test(saved.resumeData ?? '')) { offset = await fileSize(part); saved.resumeData = String(offset); context.check(); }
                  transfer = FileSystem.createDownloadResumable(source.url, part, saved.options, (progress) => {
                    context.progress(progress.totalBytesWritten, progress.totalBytesExpectedToWrite);
                  }, saved.resumeData);
                }
                const currentTransfer = transfer;
                const unbind = context.transfer({
                  pause: async () => {
                    const saved = await currentTransfer.pauseAsync(); resume = true;
                    offset = /^\d+$/.test(saved.resumeData ?? '') ? Number(saved.resumeData) : await fileSize(part);
                  },
                  cancel: async () => { await currentTransfer.cancelAsync(); await cleanup(); },
                });
                const wasResume = resume;
                try { response = await (wasResume ? currentTransfer.resumeAsync() : currentTransfer.downloadAsync()); }
                finally { unbind(); }
                context.check();
                // Android's native downloader appends for every resumeData.
                // A server ignoring Range must restart, never concatenate two
                // full audio files and register corrupt offline media.
                if (wasResume && response) {
                  const range = header(response.headers, 'content-range');
                  const start = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(range ?? '');
                  if (response.status !== 206 || !start || Number(start[1]) !== offset || Number(start[2]) !== Number(start[3]) - 1) {
                    response = undefined; transfer = undefined; resume = false; offset = 0;
                    await cleanup(); context.check();
                    if (attempt === ATTEMPTS) throw new TransferError('Invalid resumed response', 416);
                    continue;
                  }
                  expectedTotal = Number(start[3]);
                } else if (response) {
                  if (response.status === 206) throw new TransferError('Unexpected partial response', 416);
                  expectedTotal = header(response.headers, 'content-encoding') ? 0 : Number(header(response.headers, 'content-length')) || 0;
                }
              }
              if (!response || (response.status !== 200 && response.status !== 206)) throw new TransferError(`HTTP ${response?.status}`, response?.status);
              if (isErrorBody(response.headers)) throw new TransferError('error body, not audio', 200);
              context.check();
              const bytes = moved ? await fileSize(final) : await fileSize(part); context.check();
              if (bytes <= 0 || expectedTotal > 0 && bytes !== expectedTotal) throw new TransferError('incomplete audio file', 200);
              netTally('stream.view (download)', bytes);
              context.progress(bytes, bytes);
              await cacheLyricsForDownload(context.auth, song, moved ? final : part, context.current); context.check();
              if (!moved) {
                ownsFinal = !(await FileSystem.getInfoAsync(final)).exists; context.check();
                await FileSystem.moveAsync({ from: part, to: final }); moved = true; context.check();
              }
              const sourceLrc = siblingLrcUri(part), targetLrc = siblingLrcUri(final);
              if (sourceLrc && targetLrc && (await FileSystem.getInfoAsync(sourceLrc)).exists) {
                context.check(); await FileSystem.moveAsync({ from: sourceLrc, to: targetLrc }); context.check();
              }
              context.check();
              await Db.addToCatalog(dir, { songs: [toLocalSong(song, final, dlBitRate, bytes,
                song.coverArt ? trackArt.get(song.coverArt) : undefined)] }); committed = true; context.check();
              set((state) => ({ files: { ...state.files, [song.id]: final }, dlBitRates: dlBitRate != null
                ? { ...state.dlBitRates, [song.id]: dlBitRate } : state.dlBitRates }));
              resetCatalogCache();
              return;
            } catch (error) {
              if (!context.current()) throw new DownloadInterrupted('Download paused or cancelled');
              const status = error instanceof TransferError ? error.status : undefined;
              if (!moved) { response = undefined; transfer = undefined; resume = false; offset = 0; await cleanup(); }
              if (attempt === ATTEMPTS || !worthRetrying(status)) throw error;
              await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS * attempt)); context.check();
            }
          }
        } catch (error) {
          // Paused partial audio remains resumable. Cancellation removes only
          // this run's temporary file, never a completed canonical download.
          if (context.current() || context.cancelled()) await cleanup();
          throw error;
        }
      }, true, cleanup);
    });
    queue.sync();
    try {
      const result = await Promise.race([Promise.all(promises), stopped]);
      if (useAuthStore.getState().auth !== intent || groupRuns.get(groupId) !== group) return;
      invalidate();
      if (result === 'cancelled') useToast.getState().show(tg('Download stopped'));
      else {
        const failed = result.filter((status) => status === 'failed').length;
        if (!useAuthStore.getState().offline && result.some((status) => status === 'completed')) void mirrorAlbumTracklists(intent, pending);
        if (failed) useToast.getState().show(tg("{n} songs couldn't be downloaded", { n: failed }));
        else if (result.every((status) => status === 'completed')) useToast.getState().show(pending.length === 1
          ? tg('Song downloaded') : tg('{n} songs downloaded', { n: pending.length }));
      }
    } finally {
      if (groupRuns.get(groupId) === group) groupRuns.delete(groupId);
      queue.sync();
    }
  }

  return {
    files: {},
    dlBitRates: {},
    active: {}, queue: [], queuePaused: false,
    pauseAll: () => queue.pauseAll(), resumeAll: () => queue.resumeAll(),
    cancelAll: async () => {
      const auth = useAuthStore.getState().auth;
      if (auth) for (const [key, group] of groupRuns) if (key.startsWith(scope(auth) + '|')) group.cancel();
      await queue.cancelAll();
    },
    hydrated: false,

    hydrate: async () => {
      // Which run this is. Restoring the session re-runs this while the first
      // one is still going, and that first one, having no account yet, reads
      // every profile and so finishes last: it used to land on top of the
      // right answer and leave the store holding every account's downloads at
      // once. A later run always wins.
      const run = ++hydrateRun;
      const files: Record<string, string> = {};
      const dlBitRates: Record<string, number> = {};
      // The active profile's catalog, or every one of them while there isn't
      // one yet (this runs before the session is restored, and runs again once
      // it is). Reading them all was three files and thirty three seconds on an
      // install that had been signed in more than once, for songs belonging to
      // accounts that aren't playing (#50).
      const active = activeServerDir();
      const dirs = active ? [active] : await serverDirs().catch(() => []);
      for (const dir of dirs) {
        try {
          // Two columns out of the database, not every song parsed out of a file.
          // Timed because offline this is on the way in: nothing is drawn until
          // the app knows whether there is anything downloaded, and on a library
          // of fifteen thousand that wait is the whole of the first screen.
          Object.assign(files, await timed('downloads hydrate', () => Db.downloadedFiles(dir)));
        } catch {
          // A catalog that cannot be read leaves this profile without
          // downloads, not the app without an answer: `hydrated` is what the
          // queue waits on before restoring itself.
        }
      }
      if (run !== hydrateRun) return;
      set({ files, hydrated: true });
      // Not on the way in: it may fetch pictures, though only ever once.
      if (active) setTimeout(() => void sweepTrackCovers(), 20_000);
      // The bitrates come after, on their own: nothing on the way in reads
      // them, and digging them out of the rows' JSON is the expensive half of
      // what this used to ask for (see `downloadedBitRates`).
      void (async () => {
        for (const dir of dirs) {
          try {
            Object.assign(
              dlBitRates,
              await timed('downloads bitrates', () => Db.downloadedBitRates(dir)),
            );
          } catch {
            // Same as above: a badge without its number, not an app without
            // its downloads.
          }
        }
        if (run !== hydrateRun) return;
        set({ dlBitRates });
      })();
    },

    downloadAlbum: async (album, songs) => {
      await downloadGroup(`album:${album.id}`, songs, [album]);
    },

    downloadArtist: async (artistId, songs, albums) => {
      await downloadGroup(`artist:${artistId}`, songs, albums);
    },

    downloadSong: async (song) => {
      await downloadGroup(`song:${song.id}`, [song], [albumFromSong(song)]);
    },

    downloadSongs: async (songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      // Unique key: each batch is an ephemeral group without its own progress UI.
      await downloadGroup(`batch:${Date.now()}`, songs, Array.from(byId.values()));
    },

    downloadPlaylist: async (playlist, songs) => {
      const intentAuth = useAuthStore.getState().auth;
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      await downloadGroup(`playlist:${playlist.id}`, songs, Array.from(byId.values()));
      if (useAuthStore.getState().auth !== intentAuth) return;
      // The playlist also exists in the local profile, with its server ids.
      const downloadedIds = songs.map((s) => s.id).filter((id) => get().files[id]);
      if (downloadedIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        await require('@/lib/localQueries').upsertLocalPlaylist(
          `dl_${playlist.id}`,
          playlist.name,
          downloadedIds,
          playlist.comment,
        );
      }
    },

    downloadGenre: async (genre, songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      // Keyed by name, which is what a genre is: the servers give it no id of
      // their own that every backend agrees on, and it is what the screen is
      // routed by.
      await downloadGroup(`genre:${genre}`, songs, Array.from(byId.values()));
    },

    downloadFavorites: async (songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      await downloadGroup('favorites', songs, Array.from(byId.values()));
    },

    cancelDownload: (groupKey) => {
      const auth = useAuthStore.getState().auth;
      if (!auth) return;
      const groupId = `${scope(auth)}|${groupKey}`;
      groupRuns.get(groupId)?.cancel();
      groupRuns.delete(groupId);
      queue.cancelGroup(groupKey);
    },

    deleteSongs: async (songIds) => {
      queue.forget(songIds);
      // The state goes first, before touching the disk: deleting used to show
      // nothing at all until the files were gone, and behind an ongoing
      // download that could be a very long while — long enough to look broken
      // and be retried (#48).
      set((st) => {
        const files = { ...st.files };
        const dlBitRates = { ...st.dlBitRates };
        for (const id of songIds) {
          delete files[id];
          delete dlBitRates[id];
        }
        return { files, dlBitRates };
      });
      // Only the catalog view: the rows already follow `files`, and offline the
      // lists come from a catalog that hasn't changed yet, so asking every
      // screen to re-read here was a full refresh to show the same thing. The
      // one at the end, once the songs are actually gone, is the real one.
      resetCatalogCache();
      await locked(async () => {
        // The signed in profile's, or all of them if there isn't one: opening
        // another account's database has a cost and nothing to find.
        const active = activeServerDir();
        for (const dir of active ? [active] : await serverDirs()) {
          // The rows go first and tell us what they pointed at, so the files
          // are deleted knowing the catalog no longer claims to have them.
          const gone = await Db.removeFromCatalog(dir, songIds);
          for (const s of gone.songs) {
            if (!s.localUri) continue;
            await FileSystem.deleteAsync(s.localUri, { idempotent: true }).catch(() => {});
            // Also the cached lyrics alongside the file, if any.
            const lrc = siblingLrcUri(s.localUri);
            if (lrc) await FileSystem.deleteAsync(lrc, { idempotent: true }).catch(() => {});
          }
          // Albums left with nothing: their cover goes too.
          for (const a of gone.albums) {
            if (a.coverUri) await FileSystem.deleteAsync(a.coverUri, { idempotent: true }).catch(() => {});
            for (const [id, uri] of Object.entries(a.trackCovers ?? {})) {
              forgetCover(id);
              await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
            }
          }
          // And artists left without a single record, picture and all.
          for (const a of await Db.dropEmptyArtists(dir)) {
            if (a.coverUri) await FileSystem.deleteAsync(a.coverUri, { idempotent: true }).catch(() => {});
          }
        }
      });
      invalidate();
    },

    forgetIfMissing: async (songId) => {
      const uri = get().files[songId];
      if (!uri) return false;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists && ((info as { size?: number }).size ?? 1) > 0) return false;
      } catch {
        return false;
      }
      await get().deleteSongs([songId]);
      return true;
    },

    clearAll: async () => {
      for (const group of groupRuns.values()) group.cancel();
      groupRuns.clear();
      await queue.drainAndClear(async () => {
        await locked(async () => {
        // The databases are closed before their directory goes, or the handles
        // would outlive the files they are pointing at.
        await Db.closeCatalogs();
        await FileSystem.deleteAsync(ROOT_DIR, { idempotent: true }).catch(() => {});
        });
      // Local playlists created by downloads no longer resolve songs;
      // they are removed to avoid leaving empty lists.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require('@/lib/localQueries').deleteLocalPlaylistsByPrefix('dl_');
      set({ files: {}, dlBitRates: {}, active: {} });
      invalidate();
      });
    },

    usageBytes: async () => timed('storage used', async () => {
      let total = 0;
      // From the catalog, which knows what each file took when it was written.
      // This used to ask the file system for the size of every single file, one
      // after another: eleven thousand round trips on a large library, each one
      // resolving a promise on the JS thread, so opening this screen made the
      // whole app stutter for as long as it took, and leaving the screen didn't
      // even stop it (#50).
      for (const dir of await serverDirs()) {
        // Added up by the database, which is what a database is for.
        const { known, missing } = await Db.usageBytes(dir);
        total += known;
        // Downloaded before sizes were recorded: measured once, written down,
        // and never measured again.
        if (missing.length > 0) total += await measureMissing(dir, missing);
      }
      return total;
    }),
  };
});

/** State of a group's download button (album/playlist header). */
export function groupDownloadState(
  st: Pick<DownloadsState, 'files' | 'active'>,
  groupKey: string,
  songIds: string[],
): { status: 'none' | 'active' | 'done'; progress: number } {
  const g = st.active[groupKey];
  if (g) return { status: 'active', progress: (g.done + g.fraction) / Math.max(1, g.total) };
  const relevant = songIds.filter(Boolean);
  if (relevant.length > 0 && relevant.every((id) => st.files[id])) {
    return { status: 'done', progress: 1 };
  }
  return { status: 'none', progress: 0 };
}
