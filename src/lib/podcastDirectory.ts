/** Apple podcast directory values. Public metadata only; subscriptions stay in podcastDb. */
export interface PodcastDirectoryShow {
  id: number;
  title: string;
  author?: string;
  imageUrl?: string;
  /** Charts omit the feed. Resolve this show's ID only when it is opened or subscribed to. */
  feedUrl?: string;
  genre?: string;
  episodeCount?: number;
  /** Milliseconds since the epoch. */
  latestReleaseAt?: number;
  summary?: string;
  /** Position in the original chart, unaffected by lookup response order. */
  rank?: number;
}

/** Apple first-level podcast categories; labels are translated by the existing app dictionary. */
export const PODCAST_DIRECTORY_GENRES = [
  { id: 1324, key: 'Society & Culture' }, { id: 1489, key: 'News' },
  { id: 1303, key: 'Comedy' }, { id: 1318, key: 'Technology' },
  { id: 1321, key: 'Business' }, { id: 1304, key: 'Education' },
  { id: 1301, key: 'Arts' }, { id: 1487, key: 'History' },
  { id: 1533, key: 'Science' }, { id: 1512, key: 'Health & Fitness' },
  { id: 1502, key: 'Leisure' }, { id: 1310, key: 'Music' },
  { id: 1309, key: 'TV & Film' }, { id: 1545, key: 'Sports' },
  { id: 1483, key: 'Fiction' }, { id: 1488, key: 'True Crime' },
  { id: 1305, key: 'Kids & Family' }, { id: 1314, key: 'Religion & Spirituality' },
  { id: 1511, key: 'Government' },
] as const;

export type PodcastDirectoryErrorCode = 'response' | 'tooLarge' | 'http' | 'offline' | 'stopped' | 'timeout';
export class PodcastDirectoryError extends Error {
  readonly code: PodcastDirectoryErrorCode;
  constructor(code: PodcastDirectoryErrorCode) {
    super(`Podcast directory: ${code}`);
    this.name = 'PodcastDirectoryError';
    this.code = code;
  }
}

export function normalizePodcastDirectoryCountry(country?: string): string {
  const value = country?.trim().toLowerCase();
  return value && /^[a-z]{2}$/.test(value) ? value : 'us';
}

function positiveId(value: unknown): number | undefined {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Accept official show links, including episode links, without mistaking the episode's `i` for a show ID. */
export function podcastAppleDirectoryId(input: string): number | undefined {
  const text = input.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !['podcasts.apple.com', 'itunes.apple.com'].includes(url.hostname.toLowerCase())
      || (url.port && url.port !== '80' && url.port !== '443')) return;
    for (const part of url.pathname.split('/').reverse()) {
      const found = /^id(\d+)$/i.exec(part);
      if (found) return positiveId(found[1]);
    }
    return positiveId(url.searchParams.get('id'));
  } catch { return; }
}

const BASE = 'https://itunes.apple.com';
const boundedLimit = (limit: number, fallback: number) => Number.isFinite(limit)
  ? Math.max(1, Math.min(200, Math.floor(limit))) : fallback;

export function podcastDirectorySearchUrl(term: string, country = 'us', limit = 40): string {
  const query = term.trim().slice(0, 300);
  const url = new URL(`${BASE}/search`);
  url.searchParams.set('media', 'podcast'); url.searchParams.set('entity', 'podcast');
  url.searchParams.set('term', query); url.searchParams.set('country', normalizePodcastDirectoryCountry(country));
  url.searchParams.set('limit', String(boundedLimit(limit, 40)));
  return url.toString();
}

export function podcastDirectoryLookupUrl(ids: readonly number[], country = 'us'): string {
  const unique = [...new Set(ids.filter((id) => positiveId(id) !== undefined))].slice(0, 200);
  if (!unique.length) throw new PodcastDirectoryError('response');
  const url = new URL(`${BASE}/lookup`);
  url.searchParams.set('id', unique.join(',')); url.searchParams.set('entity', 'podcast');
  url.searchParams.set('country', normalizePodcastDirectoryCountry(country));
  return url.toString();
}

export function podcastDirectoryChartUrl(country = 'us', genreId?: number, limit = 50): string {
  if (genreId !== undefined && !PODCAST_DIRECTORY_GENRES.some((genre) => genre.id === genreId)) {
    throw new PodcastDirectoryError('response');
  }
  return `${BASE}/${normalizePodcastDirectoryCountry(country)}/rss/toppodcasts/limit=${boundedLimit(limit, 50)}`
    + (genreId === undefined ? '' : `/genre=${genreId}`) + '/json';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown, max = 2000): string | undefined {
  if (typeof value !== 'string') return;
  return value.trim().slice(0, max) || undefined;
}
function httpUrl(value: unknown): string | undefined {
  const raw = text(value, 8000); if (!raw) return;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined;
  } catch { return; }
}

/** Apple chart artwork has a small size in its path. Leave other publishers' URLs untouched. */
export function podcastDirectoryArtwork(value: unknown): string | undefined {
  const raw = httpUrl(value); if (!raw) return;
  const url = new URL(raw);
  if (/(^|\.)mzstatic\.com$/i.test(url.hostname)) {
    url.pathname = url.pathname.replace(/\/\d+x\d+(?:bb)?\.(png|jpe?g|webp)$/i, '/600x600bb.$1');
  }
  return url.toString();
}

export function decodePodcastDirectorySearch(payload: unknown): PodcastDirectoryShow[] {
  const rows = record(payload)?.results;
  if (!Array.isArray(rows)) throw new PodcastDirectoryError('response');
  const seen = new Set<number>(), shows: PodcastDirectoryShow[] = [];
  for (const value of rows.slice(0, 200)) {
    const item = record(value); if (!item || (item.kind !== undefined && item.kind !== 'podcast')) continue;
    const id = positiveId(item.collectionId) ?? positiveId(item.trackId);
    const title = text(item.collectionName) ?? text(item.trackName);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const show: PodcastDirectoryShow = { id, title };
    const author = text(item.artistName), feed = httpUrl(item.feedUrl);
    const art = httpUrl(item.artworkUrl600) ?? podcastDirectoryArtwork(item.artworkUrl100);
    const genre = text(item.primaryGenreName), date = text(item.releaseDate, 80);
    if (author) show.author = author;
    if (feed) show.feedUrl = feed;
    if (art) show.imageUrl = art;
    if (genre) show.genre = genre;
    if (typeof item.trackCount === 'number' && Number.isSafeInteger(item.trackCount) && item.trackCount >= 0) show.episodeCount = item.trackCount;
    const at = date ? Date.parse(date) : NaN;
    if (Number.isFinite(at)) show.latestReleaseAt = at;
    shows.push(show);
  }
  return shows;
}

export function decodePodcastDirectoryChart(payload: unknown): PodcastDirectoryShow[] {
  const feed = record(record(payload)?.feed);
  if (!feed) throw new PodcastDirectoryError('response');
  const entries = feed.entry;
  if (entries === undefined || entries === null) return [];
  const rows = Array.isArray(entries) ? entries : record(entries) ? [entries] : undefined;
  if (!rows) throw new PodcastDirectoryError('response');
  const seen = new Set<number>(), shows: PodcastDirectoryShow[] = [];
  for (let index = 0; index < Math.min(rows.length, 200); index++) {
    const item = record(rows[index]); if (!item) continue;
    const id = positiveId(record(record(item.id)?.attributes)?.['im:id']);
    const title = text(record(item['im:name'])?.label);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const show: PodcastDirectoryShow = { id, title, rank: index + 1 };
    const author = text(record(item['im:artist'])?.label);
    if (author) show.author = author;
    const images = Array.isArray(item['im:image']) ? item['im:image'] : [];
    let height = -1;
    for (const image of images) {
      const raw = record(image), art = podcastDirectoryArtwork(raw?.label);
      const at = Number(record(raw?.attributes)?.height) || 0;
      if (art && at > height) { show.imageUrl = art; height = at; }
    }
    const genre = text(record(record(item.category)?.attributes)?.label);
    const summary = text(record(item.summary)?.label, 8000);
    if (genre) show.genre = genre;
    if (summary) show.summary = summary;
    shows.push(show);
  }
  return shows;
}
