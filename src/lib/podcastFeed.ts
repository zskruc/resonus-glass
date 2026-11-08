/**
 * RSS and Atom podcast feeds, read with regexes like `ttml.ts` (React Native
 * has no XML parser): everything wanted is a leaf, and the two formats differ
 * in tag names rather than shape. Entities are decoded once, where a value is
 * read.
 */
import type { PodcastChapter, PodcastTranscript } from '@/api/subsonic';
import { normalizePodcastChapters } from './podcastChapters';
import { MAX_PODCAST_NOTES_CHARS, safePodcastUrl } from './podcastShowNotes';

/** A channel as the feed describes itself, before anything is stored. */
export interface ParsedFeed {
  title?: string;
  author?: string;
  description?: string;
  descriptionHtml?: string;
  showType?: 'episodic' | 'serial';
  imageUrl?: string;
  siteUrl?: string;
  items: ParsedItem[];
}

/** One episode as the feed describes it. Ids are namespaced by `channelId`. */
export interface ParsedItem {
  /** Stable across refreshes, which is what makes an update an update. */
  id: string;
  title: string;
  description?: string;
  descriptionHtml?: string;
  /** Publication date in ms since the epoch. */
  publishedAt?: number;
  episode?: number;
  season?: number;
  episodeType?: 'full' | 'trailer' | 'bonus';
  chapters?: PodcastChapter[];
  chaptersUrl?: string;
  transcripts?: PodcastTranscript[];
  /** Seconds. */
  duration?: number;
  /** Where the audio is. An episode with none of this cannot be played. */
  url?: string;
  mimeType?: string;
  size?: number;
  imageUrl?: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
};

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const code = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 1 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Drops CDATA fences, leaving the text inside them. */
function unwrapCdata(inner: string): string {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : inner;
}

/** The inside of the first matching element, prefixes and CDATA aside. */
function inner(block: string, name: string): string | undefined {
  const m = block.match(
    new RegExp(
      `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`,
      'i',
    ),
  );
  return m ? unwrapCdata(m[1]) : undefined;
}

/** The attributes of the first matching element, self-closing or not. */
function openTag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<(?:[\\w.-]+:)?${name}(\\s[^>]*?)?/?>`, 'i'));
  return m ? (m[1] ?? '') : undefined;
}

/** An attribute by its local name, whatever prefix it was written with. */
function attr(attrs: string | undefined, name: string): string | undefined {
  if (!attrs) return undefined;
  const m = attrs.match(
    new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  if (!m) return undefined;
  const raw = m[1] ?? m[2] ?? m[3] ?? '';
  return raw ? decode(raw).trim() : undefined;
}

/** A leaf value as text: entities resolved, whitespace trimmed. */
function text(block: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const found = inner(block, name);
    if (found === undefined) continue;
    const out = decode(found).replace(/\s+/g, ' ').trim();
    if (out) return out;
  }
  return undefined;
}

/** Any tag at all, for telling escaped markup from real markup. */
const HAS_TAG = /<[a-z/!][^>]*>/i;

/** Tags that become a space when stripped; inline ones (`<b>`, `<a>`) just go. */
const BLOCK_TAG =
  'blockquote|figcaption|section|article|header|footer|figure|pre|table|h[1-6]|hr|br|div|p|li|ul|ol|tr|td|th';

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(new RegExp(`</?(?:${BLOCK_TAG})\\b[^>]*>`, 'gi'), ' ')
    .replace(/<[^>]*>/g, '');
}

/**
 * A value that is usually HTML, as plain text. Escaped HTML only shows its tags
 * after one decode and then needs a second; CDATA HTML needs just one, or a
 * literal `&amp;` in it would be decoded twice.
 */
function plain(block: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const found = inner(block, name);
    if (found === undefined) continue;
    const decoded = decode(found);
    const escaped = HAS_TAG.test(decoded) && !HAS_TAG.test(found);
    const out = decode(stripTags(escaped ? decoded : found))
      .replace(/\s+/g, ' ')
      .trim();
    if (out) return out;
  }
  return undefined;
}

/** Rich text stays separate: existing compact rows keep their plain summary. */
function rich(block: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const found = inner(block, name)?.trim();
    if (!found) continue;
    const decoded = decode(found);
    return (HAS_TAG.test(decoded) && !HAS_TAG.test(found) ? decoded : found).slice(0, MAX_PODCAST_NOTES_CHARS);
  }
  return undefined;
}
function episodeExtras(block: string, base?: string): Pick<ParsedItem, 'season' | 'episodeType' | 'chapters' | 'chaptersUrl' | 'transcripts'> {
  const extra: ReturnType<typeof episodeExtras> = {};
  const season = Number(text(block, 'season')), kind = text(block, 'episodeType')?.toLowerCase();
  if (Number.isSafeInteger(season) && season > 0 && season <= 100000) extra.season = season;
  if (kind === 'full' || kind === 'bonus' || kind === 'trailer') extra.episodeType = kind;
  const embedded = inner(block, 'chapters');
  if (embedded) {
    const rows = [];
    for (const entry of embedded.matchAll(/<(?:[\w.-]+:)?chapter\b([^>]*)\/?>/gi)) {
      rows.push({ start: attr(entry[1], 'start'), title: attr(entry[1], 'title'), href: attr(entry[1], 'href'), image: attr(entry[1], 'image') });
      if (rows.length === 3000) break;
    }
    const chapters = normalizePodcastChapters(rows, base); if (chapters.length) extra.chapters = chapters;
  }
  for (const entry of block.matchAll(/<(?:[\w.-]+:)?chapters\b([^>]*)\/?>/gi)) {
    const url = safePodcastUrl(attr(entry[1], 'url'), base), type = attr(entry[1], 'type');
    if (url && (!type || /json/i.test(type))) { extra.chaptersUrl = url; break; }
  }
  const transcripts: PodcastTranscript[] = [], seen = new Set<string>();
  for (const entry of block.matchAll(/<(?:[\w.-]+:)?transcript\b([^>]*)\/?>/gi)) {
    const url = safePodcastUrl(attr(entry[1], 'url'), base); if (!url || seen.has(url)) continue;
    seen.add(url);
    const type = attr(entry[1], 'type')?.slice(0, 100), language = attr(entry[1], 'language')?.slice(0, 100), rel = attr(entry[1], 'rel')?.slice(0, 100);
    transcripts.push({ url, ...(type ? { type } : {}), ...(language ? { language } : {}), ...(rel ? { rel } : {}) });
    if (transcripts.length === 10) break;
  }
  if (transcripts.length) extra.transcripts = transcripts;
  return extra;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const RFC822 =
  /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([A-Za-z]{1,5}|[+-]\d{4})?/;

/** A zone as minutes east of UTC, or undefined if nobody knows the name. */
function zoneMinutes(zone: string | undefined): number | undefined {
  if (!zone) return 0;
  const numeric = zone.match(/^([+-])(\d{2})(\d{2})?$/);
  if (numeric) {
    const magnitude = Number(numeric[2]) * 60 + Number(numeric[3] ?? 0);
    return numeric[1] === '-' ? -magnitude : magnitude;
  }
  if (/^(ut|gmt|utc|z)$/i.test(zone)) return 0;
  const named: Record<string, number> = {
    est: -300, edt: -240, cst: -360, cdt: -300,
    mst: -420, mdt: -360, pst: -480, pdt: -420,
  };
  return named[zone.toLowerCase()];
}

/**
 * A date as ms since the epoch. RFC 822 (RSS) is read by hand so a missing
 * leading zero, missing seconds, named zones and two-digit years don't depend
 * on the engine's `Date.parse`; ISO 8601 (Atom) goes to `Date.parse`.
 */
export function parseFeedDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const raw = value.trim();

  const rfc = raw.match(RFC822);
  if (rfc) {
    const month = MONTHS[rfc[2].toLowerCase()];
    const minutes = zoneMinutes(rfc[7]);
    if (month !== undefined && minutes !== undefined) {
      const year = Number(rfc[3]);
      // POSIX: 70-99 is 19xx, 00-69 is 20xx.
      const full = year < 100 ? (year > 69 ? year + 1900 : year + 2000) : year;
      const asUtc = Date.UTC(
        full,
        month,
        Number(rfc[1]),
        Number(rfc[4]),
        Number(rfc[5]),
        Number(rfc[6] ?? 0),
      );
      if (Number.isFinite(asUtc)) return asUtc - minutes * 60_000;
    }
  }

  const direct = Date.parse(raw);
  return Number.isFinite(direct) ? direct : undefined;
}

/** `itunes:duration` in seconds: `H:MM:SS`, `M:SS` or a bare count of seconds. */
export function parseDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const clock = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/);
  if (clock) {
    const [, h, m, s] = clock;
    return h === undefined
      ? Number(m) * 60 + Number(s)
      : Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  const seconds = Number(v);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  return undefined;
}

/** The enclosure of an item: RSS `<enclosure>`, or Atom's `rel="enclosure"` link. */
function enclosure(block: string): { url?: string; type?: string; length?: number } {
  const attrs = openTag(block, 'enclosure');
  if (attrs) {
    const length = Number(attr(attrs, 'length'));
    return {
      url: attr(attrs, 'url'),
      type: attr(attrs, 'type'),
      length: Number.isFinite(length) && length > 0 ? length : undefined,
    };
  }
  for (const m of block.matchAll(/<link(\s[^>]*?)?\/?>/gi)) {
    const linkAttrs = m[1];
    if ((attr(linkAttrs, 'rel') ?? '').toLowerCase() !== 'enclosure') continue;
    const length = Number(attr(linkAttrs, 'length'));
    return {
      url: attr(linkAttrs, 'href'),
      type: attr(linkAttrs, 'type'),
      length: Number.isFinite(length) && length > 0 ? length : undefined,
    };
  }
  return {};
}

/** Who publishes the show. Atom nests the name in `<author><name>`. */
function feedAuthor(header: string): string | undefined {
  return (
    text(header, 'itunes:author', 'managingEditor', 'creator', 'owner') ??
    text(inner(header, 'author') ?? '', 'name') ??
    text(header, 'author')
  );
}

/** The channel's artwork: `itunes:image`, RSS `<image><url>`, Atom logo. */
function feedImage(header: string): string | undefined {
  return (
    attr(openTag(header, 'image'), 'href') ??
    text(inner(header, 'image') ?? '', 'url') ??
    text(header, 'logo', 'icon')
  );
}

/** An episode's id across refreshes: its `guid`, else its enclosure, else title and date. */
function itemKey(block: string, title: string, publishedAt: number | undefined): string {
  const guid = text(block, 'guid', 'id');
  if (guid) return guid;
  const url = enclosure(block).url;
  if (url) return url;
  return `${title}|${publishedAt ?? 0}`;
}

/** The show's web page: Atom's first non-`self` link, or RSS's `<link>`. */
function siteLink(header: string): string | undefined {
  for (const m of header.matchAll(/<link(\s[^>]*?)?\/?>/gi)) {
    const rel = (attr(m[1], 'rel') ?? '').toLowerCase();
    if (rel === 'self' || rel === 'enclosure' || rel === 'hub' || rel === 'search') continue;
    const href = attr(m[1], 'href');
    if (href) return href;
  }
  // Unprefixed only: a self-closing `<atom:link/>` before it would be read as
  // its opening tag.
  const rss = header.match(/<link\s*>([\s\S]*?)<\/link\s*>/i);
  const site = rss ? decode(unwrapCdata(rss[1])).trim() : '';
  return site || undefined;
}

/** Reads a feed. Episode ids are prefixed with `channelId`: guids collide across feeds. */
export function parseFeed(xml: string, channelId: string, baseUrl?: string): ParsedFeed {
  const body = unwrapCdata(xml);
  const items: ParsedItem[] = [];

  for (const m of body.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)) {
    const block = m[2];
    // Empty, not a placeholder: the screen translates that.
    const title = text(block, 'title') ?? '';
    const publishedAt = parseFeedDate(text(block, 'pubDate', 'published', 'updated', 'date'));
    const enc = enclosure(block);
    const item: ParsedItem = {
      id: `${channelId}/${itemKey(block, title, publishedAt)}`,
      title,
      publishedAt,
      duration: parseDuration(text(block, 'duration')),
      url: enc.url,
      mimeType: enc.type,
      size: enc.length,
    };
    const description = plain(block, 'description', 'summary', 'content', 'encoded');
    const descriptionHtml = rich(block, 'encoded', 'content', 'description', 'summary');
    const episodeNumber = Number(text(block, 'episode'));
    if (Number.isFinite(episodeNumber) && Math.floor(episodeNumber) > 0) item.episode = Math.floor(episodeNumber);
    if (description) item.description = description;
    if (descriptionHtml) item.descriptionHtml = descriptionHtml;
    Object.assign(item, episodeExtras(block, baseUrl));
    const image = attr(openTag(block, 'image'), 'href');
    if (image) item.imageUrl = image;
    items.push(item);
  }

  // The channel's own fields come before its first item, in RSS and Atom alike.
  const firstItem = body.search(/<(item|entry)\b/i);
  const header = firstItem === -1 ? body : body.slice(0, firstItem);

  const feed: ParsedFeed = { items };
  const title = text(header, 'title');
  if (title) feed.title = title;
  const author = feedAuthor(header);
  if (author) feed.author = author;
  const description = plain(header, 'description', 'subtitle');
  if (description) feed.description = description;
  const descriptionHtml = rich(header, 'description', 'subtitle'); if (descriptionHtml) feed.descriptionHtml = descriptionHtml;
  const showType = text(header, 'itunes:type')?.toLowerCase();
  if (showType === 'episodic' || showType === 'serial') feed.showType = showType;
  const imageUrl = feedImage(header);
  if (imageUrl) feed.imageUrl = imageUrl;
  const siteUrl = siteLink(header);
  if (siteUrl) feed.siteUrl = siteUrl;
  return feed;
}

/** Newest first, undated last, the feed's own order breaking ties. */
export function sortEpisodes(items: ParsedItem[]): ParsedItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = a.item.publishedAt;
      const right = b.item.publishedAt;
      if (left === undefined && right === undefined) return a.index - b.index;
      if (left === undefined) return 1;
      if (right === undefined) return -1;
      return right - left || a.index - b.index;
    })
    .map((entry) => entry.item);
}
