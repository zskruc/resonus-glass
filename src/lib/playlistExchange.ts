/** Portable metadata playlists: paths/URLs are never fetched or used as credentials. */
import type { Song } from '@/api/subsonic';
export interface PortableTrack { title: string; artist?: string; album?: string; duration?: number; }
export interface PortablePlaylist { name: string; tracks: PortableTrack[]; }
const MAX_TRACKS = 10000;
const clean = (value: unknown, max = 500): string => typeof value === 'string' ? value.replace(/[\r\n\0]/g, ' ').trim().slice(0, max) : '';
export function parsePlaylistFile(text: string, filename: string): PortablePlaylist {
  if (text.length > 5_000_000) throw new Error('Playlist file is too large');
  text = text.replace(/^\uFEFF/, '');
  let playlist: PortablePlaylist;
  if (/^\s*[{[]/.test(text)) {
    const value = JSON.parse(text);
    if (value?.format !== 'resonus-playlist' || value.version !== 1 || !Array.isArray(value.tracks)) throw new Error('Unsupported playlist file');
    if (value.tracks.length > MAX_TRACKS) throw new Error('Playlist has too many tracks');
    playlist = { name: clean(value.name) || clean(filename.replace(/\.json$/i, '')), tracks: value.tracks.map((track: PortableTrack) => ({
      title: clean(track?.title), artist: clean(track?.artist), album: clean(track?.album),
      duration: typeof track?.duration === 'number' && Number.isFinite(track.duration) && track.duration >= 0 ? track.duration : undefined,
    })) };
  } else {
    const tracks: PortableTrack[] = [];
    let info: PortableTrack | undefined;
    let artist = '', album = '', explicitTitle = '', name = clean(filename.replace(/\.(m3u8?|txt)$/i, ''));
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#PLAYLIST:')) { name = clean(line.slice(10)) || name; continue; }
      if (line.startsWith('#EXTINF:')) {
        const match = /^#EXTINF:([\d.-]+),(.*)$/.exec(line);
        if (!match) throw new Error('Unsupported playlist file');
        const label = match[2], split = label.indexOf(' - '), seconds = Number(match[1]);
        info = { title: clean(split >= 0 ? label.slice(split + 3) : label), artist: split >= 0 ? clean(label.slice(0, split)) : undefined,
          duration: Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined };
        continue;
      }
      if (line.startsWith('#EXTART:')) { artist = clean(line.slice(8)); continue; }
      if (line.startsWith('#EXTALB:')) { album = clean(line.slice(8)); continue; }
      // EXTINF's human-readable separator is ambiguous when an artist itself
      // contains " - ". Our explicit field preserves a portable round trip.
      if (line.startsWith('#EXTTITLE:')) { explicitTitle = clean(line.slice(10)); continue; }
      if (line.startsWith('#')) continue;
      // A remote URL may be listed, but it is only a label: never request it.
      let fallback = line.split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? '';
      try { fallback = decodeURIComponent(fallback); } catch { /* Keep malformed filenames as text. */ }
      tracks.push({ ...(info ?? { title: clean(fallback.replace(/\.[a-z0-9]{2,5}$/i, '')) }),
        ...(explicitTitle ? { title: explicitTitle } : {}),
        ...(artist ? { artist } : {}), ...(album ? { album } : {}) });
      info = undefined; artist = ''; album = ''; explicitTitle = '';
      if (tracks.length > MAX_TRACKS) throw new Error('Playlist has too many tracks');
    }
    playlist = { name, tracks };
  }
  if (playlist.tracks.length > MAX_TRACKS) throw new Error('Playlist has too many tracks');
  if (!playlist.tracks.length || playlist.tracks.some((track) => !track.title)) throw new Error('Playlist contains no valid tracks');
  return playlist;
}
const norm = (value?: string) => (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export interface PlaylistMatch { track: PortableTrack; candidates: Song[]; selected?: Song; }
const MAX_CANDIDATES = 50;
const MATCH_BATCH = 512;
interface Sample { count: number; songs: Song[]; }
interface MatchGroup {
  all: Sample;
  unknown: Sample;
  timed?: Map<number, Sample>;
  durations: number[];
  totals: number[];
}
interface ArtistIndex { all: MatchGroup; albums: Map<string, MatchGroup>; }
interface TitleIndex { all: MatchGroup; artists: Map<string, ArtistIndex>; albums: Map<string, MatchGroup>; }
interface MatchPlan {
  key: string; title?: MatchGroup; exact?: MatchGroup; album?: MatchGroup;
  duration?: number; automatic: boolean;
}
interface MatchDecision { candidates: Song[]; selected?: Song; }
const sample = (): Sample => ({ count: 0, songs: [] });
function remember(bucket: Sample, song: Song) {
  bucket.count++;
  if (bucket.songs.length < MAX_CANDIDATES) bucket.songs.push(song);
}
function validDuration(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function rememberInGroup(group: MatchGroup, song: Song, duration: number | undefined) {
  remember(group.all, song);
  if (!group.timed) return;
  if (duration === undefined) { remember(group.unknown, song); return; }
  let bucket = group.timed.get(duration);
  if (!bucket) { bucket = sample(); group.timed.set(duration, bucket); }
  remember(bucket, song);
}
function bound(values: number[], target: number, after: boolean): number {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target || after && values[middle] === target) low = middle + 1;
    else high = middle;
  }
  return low;
}
/** Sort bounded runs and merge cooperatively, including one very large title bucket. */
function* sortDurations(values: number[]): Generator<undefined, number[]> {
  const run = 1024;
  if (values.length <= run) return values.sort((a, b) => a - b);
  let sorted: number[] = [];
  for (let start = 0; start < values.length; start += run) {
    sorted.push(...values.slice(start, start + run).sort((a, b) => a - b));
    yield;
  }
  for (let width = run; width < sorted.length; width *= 2) {
    const next = new Array<number>(sorted.length);
    let work = 0;
    for (let start = 0; start < sorted.length; start += width * 2) {
      const middle = Math.min(start + width, sorted.length), end = Math.min(start + width * 2, sorted.length);
      let left = start, right = middle;
      for (let to = start; to < end; to++) {
        next[to] = left < middle && (right >= end || sorted[left] <= sorted[right]) ? sorted[left++] : sorted[right++];
        if (++work % (MATCH_BATCH * 4) === 0) yield;
      }
    }
    sorted = next;
  }
  return sorted;
}
function windowIn(group: MatchGroup | undefined, duration?: number, knownOnly = false): Sample {
  if (!group) return sample();
  if (duration === undefined) return group.all;
  const from = bound(group.durations, duration - 3, false), to = bound(group.durations, duration + 3, true);
  const count = group.totals[to] - group.totals[from] + (knownOnly ? 0 : group.unknown.count);
  const songs: Song[] = [];
  for (let i = from; i < to && songs.length < MAX_CANDIDATES; i++) {
    const bucket = group.timed!.get(group.durations[i])!;
    for (const song of bucket.songs) {
      songs.push(song);
      if (songs.length === MAX_CANDIDATES) break;
    }
  }
  if (!knownOnly) for (const song of group.unknown.songs) {
    if (songs.length === MAX_CANDIDATES) break;
    songs.push(song);
  }
  return { count, songs };
}

/**
 * Only requested metadata gets indexed. Counts always cover the full catalogue;
 * samples stay bounded, so 10,000 repeated occurrences do not copy a huge bucket.
 * Yields cover planning, indexing, duration sorting and result construction.
 */
function* matching(playlist: PortablePlaylist, songs: Song[]): Generator<number | undefined, PlaylistMatch[]> {
  const index = new Map<string, TitleIndex>(), groups: MatchGroup[] = [], plans: MatchPlan[] = [];
  const group = () => {
    const value: MatchGroup = { all: sample(), unknown: sample(), durations: [], totals: [0] };
    groups.push(value); return value;
  };
  const planCache = new Map<string, MatchPlan>();
  for (let i = 0; i < playlist.tracks.length; i++) {
    const track = playlist.tracks[i], title = norm(track.title), artist = norm(track.artist), album = norm(track.album);
    const duration = validDuration(track.duration);
    const key = JSON.stringify([title, track.artist ? artist : null, track.album ? album : null, duration ?? null]);
    let plan = planCache.get(key);
    if (!plan) {
      plan = { key, duration, automatic: !!title && (!track.artist || !!artist) && (!track.album || !!album) };
      if (title) {
        let titleIndex = index.get(title);
        if (!titleIndex) { titleIndex = { all: group(), artists: new Map(), albums: new Map() }; index.set(title, titleIndex); }
        plan.title = titleIndex.all;
        let albums = titleIndex.albums;
        if (track.artist) {
          let artistIndex = titleIndex.artists.get(artist);
          if (!artistIndex) { artistIndex = { all: group(), albums: new Map() }; titleIndex.artists.set(artist, artistIndex); }
          plan.exact = artistIndex.all; albums = artistIndex.albums;
        } else plan.exact = titleIndex.all;
        if (track.album) {
          let albumGroup = albums.get(album);
          if (!albumGroup) { albumGroup = group(); albums.set(album, albumGroup); }
          plan.album = albumGroup;
        } else plan.album = plan.exact;
        if (duration !== undefined) {
          plan.exact.timed ??= new Map(); plan.album.timed ??= new Map();
        }
      }
      planCache.set(key, plan);
    }
    plans.push(plan);
    if ((i + 1) % MATCH_BATCH === 0) yield;
  }
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i], title = index.get(norm(song.title));
    if (title) {
      const artist = norm(song.artist), album = norm(song.album), duration = validDuration(song.duration);
      rememberInGroup(title.all, song, duration);
      const artistIndex = title.artists.get(artist), albumGroup = title.albums.get(album);
      if (albumGroup) rememberInGroup(albumGroup, song, duration);
      if (artistIndex) {
        rememberInGroup(artistIndex.all, song, duration);
        const group = artistIndex.albums.get(album);
        if (group) rememberInGroup(group, song, duration);
      }
    }
    if ((i + 1) % MATCH_BATCH === 0) yield;
  }
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group.timed) {
      group.durations = yield* sortDurations([...group.timed.keys()]);
      for (let j = 0; j < group.durations.length; j++) {
        group.totals.push(group.totals[j] + group.timed.get(group.durations[j])!.count);
        if ((j + 1) % MATCH_BATCH === 0) yield;
      }
    }
    if ((i + 1) % MATCH_BATCH === 0) yield;
  }
  const decisions = new Map<string, MatchDecision>(), result: PlaylistMatch[] = [];
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    let decision = decisions.get(plan.key);
    if (!decision) {
      const preferred = windowIn(plan.album, plan.duration), timed = preferred.count ? preferred : windowIn(plan.exact, plan.duration);
      const fallback = timed.count ? timed : plan.exact?.all.count ? plan.exact.all : plan.title?.all;
      const confident = windowIn(plan.album, plan.duration, true);
      decision = { candidates: fallback?.songs ?? [], selected: plan.automatic && confident.count === 1 ? confident.songs[0] : undefined };
      decisions.set(plan.key, decision);
    }
    result.push({ track: playlist.tracks[i], ...decision });
    if ((i + 1) % MATCH_BATCH === 0) yield i + 1;
  }
  return result;
}
export function matchPlaylist(playlist: PortablePlaylist, songs: Song[]): PlaylistMatch[] {
  const iterator = matching(playlist, songs);
  let next = iterator.next();
  while (!next.done) next = iterator.next();
  return next.value;
}
export interface PlaylistMatchingOptions {
  isCurrent?: () => boolean;
  /** Completed input occurrences, rather than the number of catalogue candidates. */
  onProgress?: (processed: number, total: number) => void;
}
export async function matchPlaylistAsync(playlist: PortablePlaylist, songs: Song[], options: PlaylistMatchingOptions = {}): Promise<PlaylistMatch[]> {
  const check = () => { if (options.isCurrent && !options.isCurrent()) throw new Error('Playlist matching cancelled'); };
  check(); options.onProgress?.(0, playlist.tracks.length);
  const iterator = matching(playlist, songs);
  while (true) {
    check();
    const next = iterator.next();
    if (next.done) {
      check(); options.onProgress?.(next.value.length, playlist.tracks.length); check();
      return next.value;
    }
    if (next.value !== undefined) options.onProgress?.(next.value, playlist.tracks.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
export function playlistJson(name: string, songs: Song[]): string {
  return JSON.stringify({ format: 'resonus-playlist', version: 1, name: clean(name), tracks: songs.map((song) => ({
    title: clean(song.title), artist: clean(song.artist), album: clean(song.album), duration: song.duration,
  })) }, null, 2);
}
function portablePath(song: Song): string {
  const raw = (song as Song & { path?: unknown }).path;
  const path = (typeof raw === 'string' ? raw : '').replace(/\\/g, '/');
  if (path && !/^(?:[a-z][a-z\d+.-]*:|\/|\.\.)/i.test(path) && !/[\r\n\0?#]/.test(path) && !path.split('/').includes('..')) return path;
  return [song.artist, song.album, `${song.title}.${song.suffix || 'audio'}`].filter(Boolean)
    .map((value) => clean(value).replace(/[<>:"/\\|?*]/g, '_')).join('/');
}
export function playlistM3u(name: string, songs: Song[]): string {
  return ['#EXTM3U', `#PLAYLIST:${clean(name)}`, ...songs.flatMap((song) => [
    `#EXTINF:${Math.round(song.duration ?? -1)},${clean(song.artist)} - ${clean(song.title)}`,
    `#EXTTITLE:${clean(song.title)}`, `#EXTART:${clean(song.artist)}`, `#EXTALB:${clean(song.album)}`, portablePath(song),
  ])].join('\n') + '\n';
}
export function unmatchedReport(matches: PlaylistMatch[]): string {
  return JSON.stringify({ format: 'resonus-playlist', version: 1, name: 'Unmatched tracks',
    tracks: matches.filter((match) => !match.selected).map((match) => match.track) }, null, 2);
}
