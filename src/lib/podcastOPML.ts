/** Bounded OPML exchange. Only subscription metadata is exchanged, never app accounts or audio files. */
export const PODCAST_OPML_MAX_BYTES = 2 * 1024 * 1024;
export const PODCAST_OPML_MAX_ENTRIES = 1000;
const MAX_DEPTH = 32, MAX_TAGS = 20_000, MAX_URL = 4096;

export interface PodcastOPMLEntry { title?: string; feedUrl: string; siteUrl?: string }
export interface PodcastOPMLParseResult { entries: PodcastOPMLEntry[]; duplicates: number; invalid: number }
export type PodcastOPMLErrorCode = 'invalid' | 'unsafeXML' | 'tooLarge' | 'tooMany' | 'stopped' | 'offline' | 'busy';
export class PodcastOPMLError extends Error {
  readonly code: PodcastOPMLErrorCode;
  constructor(code: PodcastOPMLErrorCode) { super(`Podcast OPML: ${code}`); this.name = 'PodcastOPMLError'; this.code = code; }
}

/** Do not infer equivalence between HTTP/HTTPS, paths or signed query parameters. */
export function podcastOPMLURL(raw: string | undefined): string | undefined {
  if (!raw || raw.length > MAX_URL) return;
  try {
    const url = new URL(raw.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname) return;
    url.hash = '';
    return url.toString();
  } catch { return; }
}

function xmlCodePoint(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff
    || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;
}
function entities(raw: string): string {
  return raw.replace(/&([^;]*);|&/g, (_match, entity: string | undefined) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity && Object.hasOwn(predefined, entity)) return predefined[entity];
    if (entity && /^(?:#\d+|#x[\da-fA-F]+)$/.test(entity)) {
      const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (xmlCodePoint(code)) return String.fromCodePoint(code);
    }
    throw new PodcastOPMLError('invalid');
  });
}
const label = (value: string | undefined) => value?.trim().slice(0, 500) || undefined;

/** Small XML tokenizer for OPML: understands quoted `>`, nesting, comments and CDATA; no DTD/entity execution. */
export function parsePodcastOPML(xml: string): PodcastOPMLParseResult {
  if (xml.length > PODCAST_OPML_MAX_BYTES || new TextEncoder().encode(xml).byteLength > PODCAST_OPML_MAX_BYTES) throw new PodcastOPMLError('tooLarge');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) throw new PodcastOPMLError('invalid');
  let at = 0, tags = 0, root = false, closed = false, body = false;
  const stack: string[] = [], seen = new Set<string>();
  const result: PodcastOPMLParseResult = { entries: [], duplicates: 0, invalid: 0 };
  while (at < xml.length) {
    const start = xml.indexOf('<', at), content = xml.slice(at, start < 0 ? xml.length : start);
    if (!stack.length && content.replace(/^\uFEFF/, '').trim()) throw new PodcastOPMLError('invalid');
    entities(content);
    if (start < 0) break;
    at = start;
    if (xml.startsWith('<!--', at)) {
      const end = xml.indexOf('-->', at + 4);
      if (end < 0 || xml.slice(at + 4, end).includes('--')) throw new PodcastOPMLError('invalid');
      at = end + 3; continue;
    }
    if (xml.startsWith('<![CDATA[', at)) {
      const end = xml.indexOf(']]>', at + 9);
      if (end < 0 || !stack.length) throw new PodcastOPMLError('invalid');
      at = end + 3; continue;
    }
    if (xml.startsWith('<?', at)) {
      const end = xml.indexOf('?>', at + 2);
      if (end < 0) throw new PodcastOPMLError('invalid');
      at = end + 2; continue;
    }
    if (xml.startsWith('<!', at)) throw new PodcastOPMLError('unsafeXML');
    let end = at + 1, quote = '';
    for (; end < xml.length; end++) {
      const char = xml[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      else if (char === '<') throw new PodcastOPMLError('invalid');
    }
    if (end === xml.length || quote || ++tags > MAX_TAGS) throw new PodcastOPMLError('invalid');
    const tag = xml.slice(at + 1, end); at = end + 1;
    if (tag.startsWith('/')) {
      const name = /^\/([A-Za-z_][\w.:-]*)\s*$/.exec(tag)?.[1];
      if (!name || stack.pop() !== name) throw new PodcastOPMLError('invalid');
      if (!stack.length) closed = true;
      continue;
    }
    const selfClosing = /\/\s*$/.test(tag), inner = selfClosing ? tag.replace(/\/\s*$/, '') : tag;
    const name = /^([A-Za-z_][\w.:-]*)/.exec(inner)?.[1];
    if (!name || closed) throw new PodcastOPMLError('invalid');
    if (!stack.length) { if (root || name.toLowerCase() !== 'opml') throw new PodcastOPMLError('invalid'); root = true; }
    const attrs: Record<string, string> = Object.create(null);
    let rest = inner.slice(name.length), attributes = 0;
    while (rest.trim()) {
      const attr = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest);
      if (!attr || ++attributes > 32) throw new PodcastOPMLError('invalid');
      const key = attr[1].toLowerCase();
      if (Object.hasOwn(attrs, key)) throw new PodcastOPMLError('invalid');
      attrs[key] = entities(attr[2] ?? attr[3]);
      rest = rest.slice(attr[0].length);
    }
    if (name.toLowerCase() === 'body' && stack.length === 1) body = true;
    if (name.toLowerCase() === 'outline' && stack.some((part) => part.toLowerCase() === 'body')) {
      const raw = attrs.xmlurl ?? (attrs.type?.toLowerCase() === 'rss' ? attrs.url : undefined);
      if (raw !== undefined) {
        const feedUrl = podcastOPMLURL(raw);
        if (!feedUrl) result.invalid++;
        else if (seen.has(feedUrl)) result.duplicates++;
        else {
          if (result.entries.length >= PODCAST_OPML_MAX_ENTRIES) throw new PodcastOPMLError('tooMany');
          seen.add(feedUrl);
          result.entries.push({ feedUrl, ...(label(attrs.title ?? attrs.text) ? { title: label(attrs.title ?? attrs.text) } : {}),
            ...(podcastOPMLURL(attrs.htmlurl) ? { siteUrl: podcastOPMLURL(attrs.htmlurl) } : {}) });
        }
      }
    }
    if (!selfClosing) {
      stack.push(name);
      if (stack.length > MAX_DEPTH) throw new PodcastOPMLError('invalid');
    } else if (!stack.length) closed = true;
  }
  if (!root || !closed || stack.length || !body) throw new PodcastOPMLError('invalid');
  return result;
}

function escapeXML(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function credentialURL(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return true;
    return [...url.searchParams.keys()].some((name) => /^(?:user(?:name)?|pass(?:word|wd)?|auth(?:orization)?|(?:access[_-]?|api[_-]?)?(?:token|key)|secret|credential|signature|sig|jwt|[puts])$/i.test(name));
  } catch { return true; }
}

/** Credential-bearing feed URLs are excluded, not silently stripped into broken subscriptions. */
export function exportPodcastOPML(shows: readonly { title?: string; feedUrl?: string; siteUrl?: string }[], now = new Date()): {
  xml: string; exported: number; skippedSensitive: number; skippedInvalid: number;
} {
  const seen = new Set<string>(), entries: string[] = [];
  let skippedSensitive = 0, skippedInvalid = 0;
  for (const show of shows) {
    if (show.feedUrl && credentialURL(show.feedUrl)) { skippedSensitive++; continue; }
    const feed = podcastOPMLURL(show.feedUrl);
    if (!feed) { skippedInvalid++; continue; }
    if (seen.has(feed)) continue;
    if (entries.length >= PODCAST_OPML_MAX_ENTRIES) throw new PodcastOPMLError('tooMany');
    seen.add(feed);
    const title = escapeXML(label(show.title) ?? new URL(feed).hostname);
    const site = show.siteUrl && !credentialURL(show.siteUrl) ? podcastOPMLURL(show.siteUrl) : undefined;
    entries.push(`    <outline type="rss" text="${title}" title="${title}" xmlUrl="${escapeXML(feed)}"${site ? ` htmlUrl="${escapeXML(site)}"` : ''} />`);
  }
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">',
    '  <head><title>Resonus Glass Podcasts</title>', `    <dateCreated>${now.toISOString()}</dateCreated></head>`, '  <body>',
    ...entries, '  </body>', '</opml>', ''].join('\n');
  if (new TextEncoder().encode(xml).byteLength > PODCAST_OPML_MAX_BYTES) throw new PodcastOPMLError('tooLarge');
  return { xml, exported: entries.length, skippedSensitive, skippedInvalid };
}

export type PodcastOPMLStatus = 'pending' | 'existing' | 'working' | 'imported' | 'failed';
export interface PodcastOPMLImportRow { entry: PodcastOPMLEntry; status: PodcastOPMLStatus }
export interface PodcastOPMLImportSnapshot { rows: PodcastOPMLImportRow[]; running: boolean; stopped: boolean }
export interface PodcastOPMLImportPlan { readonly owner: unknown; readonly profile: string; readonly rows: readonly PodcastOPMLImportRow[] }

/** A plan owns its account and opening. Cancellation stops admission; completed subscriptions are kept. */
export function createPodcastOPMLImporter(deps: {
  owner(): unknown;
  profile(): string;
  allowed(): boolean;
  added(): Promise<readonly { id: string; feedUrl?: string }[]>;
  subscribe(feed: string, options: { signal: AbortSignal; current(): boolean; expectedProfile: string }): Promise<{ id: string }>;
}) {
  let active: PodcastOPMLImportPlan | null = null, preparing: object | null = null;
  let run: { controller: AbortController } | null = null;
  let knownIds = new Set<string>();
  const owns = (plan: PodcastOPMLImportPlan) => active === plan && plan.owner === deps.owner() && plan.profile === deps.profile();
  const snapshot = (plan: PodcastOPMLImportPlan, running = false, stopped = false): PodcastOPMLImportSnapshot => ({
    rows: plan.rows.map((row) => ({ entry: { ...row.entry }, status: row.status })), running, stopped,
  });
  const cancel = () => { run?.controller.abort(); active = null; preparing = null; };
  return {
    owns,
    cancel,
    stop() { run?.controller.abort(); },
    snapshot,
    async prepare(entries: readonly PodcastOPMLEntry[]): Promise<PodcastOPMLImportPlan | null> {
      cancel();
      const ticket = {}, owner = deps.owner(), profile = deps.profile(); preparing = ticket;
      const added = await deps.added();
      if (preparing !== ticket || owner !== deps.owner() || profile !== deps.profile()) return null;
      const feeds = new Set(added.flatMap((show) => { const feed = podcastOPMLURL(show.feedUrl); return feed ? [feed] : []; }));
      knownIds = new Set(added.map((show) => show.id));
      const seen = new Set<string>();
      const rows: PodcastOPMLImportRow[] = [];
      for (const entry of entries) {
        const feedUrl = podcastOPMLURL(entry.feedUrl);
        if (!feedUrl || seen.has(feedUrl)) continue;
        if (rows.length >= PODCAST_OPML_MAX_ENTRIES) throw new PodcastOPMLError('tooMany');
        seen.add(feedUrl); rows.push({ entry: { ...entry, feedUrl }, status: feeds.has(feedUrl) ? 'existing' : 'pending' });
      }
      const plan = { owner, profile, rows }; active = plan; return plan;
    },
    async start(plan: PodcastOPMLImportPlan, notify: (value: PodcastOPMLImportSnapshot) => void, retryFailed = false): Promise<PodcastOPMLImportSnapshot> {
      if (!owns(plan)) throw new PodcastOPMLError('stopped');
      if (run) throw new PodcastOPMLError('busy');
      if (!deps.allowed()) throw new PodcastOPMLError('offline');
      const work = { controller: new AbortController() }; run = work;
      const current = () => owns(plan) && run === work && !work.controller.signal.aborted && deps.allowed();
      try {
        notify(snapshot(plan, true));
        for (const row of plan.rows) {
          if (!current()) break;
          if (row.status !== (retryFailed ? 'failed' : 'pending')) continue;
          const before = row.status;
          row.status = 'working'; notify(snapshot(plan, true));
          try {
            const show = await deps.subscribe(row.entry.feedUrl, { signal: work.controller.signal, current, expectedProfile: plan.profile });
            if (!current()) { row.status = before; break; }
            row.status = knownIds.has(show.id) ? 'existing' : 'imported'; knownIds.add(show.id);
          } catch {
            row.status = current() ? 'failed' : before;
          }
          if (current()) notify(snapshot(plan, true));
        }
        const result = snapshot(plan, false, !current());
        if (owns(plan)) notify(result);
        return result;
      } finally { if (run === work) run = null; }
    },
  };
}
