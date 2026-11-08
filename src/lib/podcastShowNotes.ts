/** Bounded native text rendering model. No WebView, scripts or automatic media. */
export const MAX_PODCAST_NOTES_CHARS = 128_000;
export interface PodcastNoteSpan { text: string; href?: string; startSec?: number; bold?: boolean; italic?: boolean; }
export interface PodcastNoteBlock { kind: 'paragraph' | 'heading' | 'listItem' | 'quote'; spans: PodcastNoteSpan[]; }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©', reg: '®' };
export function decodePodcastText(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi, (raw, entity: string) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? raw;
    const hex = /^#x/i.test(entity), code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) && code >= 1 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : raw;
  });
}
export function safePodcastUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return undefined;
  try {
    const url = base ? new URL(value.trim(), base) : new URL(value.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
/** PSC Normal Play Time and visible show-note clocks; zero is a valid chapter. */
export function podcastTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 604800 ? value : undefined;
  if (typeof value !== 'string' || !/^\d{1,6}(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value.trim())) return undefined;
  const parts = value.trim().split(':').map(Number);
  if (parts.slice(1).some((part) => part >= 60)) return undefined;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) && seconds <= 604800 ? seconds : undefined;
}
const CLOCKS = /\b(?:\d{1,3}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?\b/g;
function timedSpans(span: PodcastNoteSpan): PodcastNoteSpan[] {
  if (span.href) return [span];
  const result: PodcastNoteSpan[] = []; let from = 0;
  for (const match of span.text.matchAll(CLOCKS)) {
    const at = match.index ?? 0, seconds = podcastTimestamp(match[0]);
    if (seconds === undefined) continue;
    if (at > from) result.push({ ...span, text: span.text.slice(from, at) });
    result.push({ ...span, text: match[0], startSec: seconds }); from = at + match[0].length;
  }
  if (from < span.text.length) result.push({ ...span, text: span.text.slice(from) });
  return result.length ? result : [span];
}
/** Parse a conservative subset into paragraph/link/text spans. Feed markup is
 * untrusted; style attributes, remote images and embedded documents are ignored. */
export function podcastShowNotes(source: string | undefined, base?: string): PodcastNoteBlock[] {
  if (!source?.trim()) return [];
  let raw = source.slice(0, MAX_PODCAST_NOTES_CHARS);
  if (!/<[a-z/!][^>]*>/i.test(raw) && /&lt;(?:p|div|br|a|ul|li|h[1-6])\b/i.test(raw)) raw = decodePodcastText(raw);
  const hasTags = /<[a-z/!][^>]*>/i.test(raw);
  if (!hasTags) return raw.split(/\r?\n/).filter((text) => text.trim()).slice(0, 300)
    .map((text) => ({ kind: 'paragraph', spans: timedSpans({ text: decodePodcastText(text.trim()) }) }));
  raw = raw.replace(/<(script|style|iframe|object|svg|form)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  const blocks: PodcastNoteBlock[] = []; let kind: PodcastNoteBlock['kind'] = 'paragraph', spans: PodcastNoteSpan[] = [];
  let bold = 0, italic = 0, href: string | undefined;
  const flush = () => {
    if (spans.some((span) => span.text.trim()) && blocks.length < 300) {
      if (spans.length) { spans[0].text = spans[0].text.trimStart(); spans[spans.length - 1].text = spans[spans.length - 1].text.trimEnd(); }
      blocks.push({ kind, spans: spans.flatMap(timedSpans) });
    }
    spans = [];
  };
  for (const match of raw.matchAll(/<([^>]+)>|([^<]+)/g)) {
    if (blocks.length >= 300) break;
    if (match[2] !== undefined) {
      const text = decodePodcastText(match[2]).replace(/\s+/g, ' ');
      if (text) spans.push({ text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(href ? { href } : {}) });
      continue;
    }
    const tag = match[1].trim(), closing = tag.startsWith('/'), name = tag.replace(/^\//, '').split(/[\s/]/)[0].toLowerCase();
    if (/^(?:p|div|section|article|br|hr|blockquote|li|ul|ol|h[1-6]|pre|tr)$/.test(name)) {
      flush(); kind = !closing && /^h[1-6]$/.test(name) ? 'heading' : !closing && name === 'li' ? 'listItem' : !closing && name === 'blockquote' ? 'quote' : 'paragraph';
    } else if (name === 'b' || name === 'strong') bold = Math.max(0, bold + (closing ? -1 : 1));
    else if (name === 'i' || name === 'em') italic = Math.max(0, italic + (closing ? -1 : 1));
    else if (name === 'a') {
      const value = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      href = closing ? undefined : safePodcastUrl(value ? decodePodcastText(value[1] ?? value[2] ?? value[3]) : undefined, base);
    }
  }
  flush(); return blocks;
}
