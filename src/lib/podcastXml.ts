/** Incremental XML boundaries only. No entity expansion, DOM, or retained document. */
export interface PodcastXmlItem {
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

type Mode = 'text' | 'open' | 'name' | 'attributes' | 'bang' | 'comment' | 'cdata' | 'pi' | 'declaration';
const localName = (name: string) => name.slice(name.lastIndexOf(':') + 1);
const white = (character: string) => character === ' ' || character === '\n' || character === '\r' || character === '\t';

/** Each UTF-16 unit is inspected once. Quoted >, CDATA and XML comments are
 * lexical content, never structural item/entry markers. State crosses chunks. */
export class PodcastXmlScanner {
  private mode: Mode = 'text';
  private position = 0;
  private tokenStart = 0;
  private name = '';
  private closing = false;
  private quote = '';
  private last = '';
  private bang = '';
  private terminator = 0;
  private declarationDepth = 0;
  private stack: string[] = [];
  private root: string | undefined;
  private closedRoot = false;
  private currentItem: { start: number; contentStart: number; depth: number; name: string } | undefined;
  failed = false;
  unsupported = false;
  firstItemStart: number | undefined;

  get previewSupported() { return this.root === 'rss' || this.root === 'feed'; }
  get rootDetected() { return this.root !== undefined; }
  get feedRootDetected() { return this.previewSupported || this.root === 'channel' || this.root === 'rdf'; }
  get complete() { return !this.failed && this.mode === 'text' && this.closedRoot && this.stack.length === 0; }

  next(character: string): PodcastXmlItem | undefined {
    if (this.failed) return;
    const at = this.position++;
    if (this.mode === 'comment' || this.mode === 'cdata') {
      const marker = this.mode === 'comment' ? '-' : ']';
      if (character === marker) this.terminator = Math.min(2, this.terminator + 1);
      else if (character === '>' && this.terminator === 2) { this.mode = 'text'; this.terminator = 0; }
      else this.terminator = 0;
      return;
    }
    if (this.mode === 'pi') {
      if (character === '>' && this.terminator) { this.mode = 'text'; this.terminator = 0; }
      else this.terminator = character === '?' ? 1 : 0;
      return;
    }
    if (this.mode === 'declaration') {
      if (this.quote) { if (character === this.quote) this.quote = ''; }
      else if (character === '"' || character === "'") this.quote = character;
      else if (character === '[') this.declarationDepth++;
      else if (character === ']') this.declarationDepth = Math.max(0, this.declarationDepth - 1);
      else if (character === '>' && this.declarationDepth === 0) this.mode = 'text';
      return;
    }
    if (this.mode === 'bang') {
      this.bang += character;
      if (this.bang === '!--') { this.mode = 'comment'; this.terminator = 0; }
      else if (this.bang === '![CDATA[') { this.mode = 'cdata'; this.terminator = 0; }
      else if (!'!--'.startsWith(this.bang) && !'![CDATA['.startsWith(this.bang)) {
        // DTDs/custom declarations are outside the preview contract. The full
        // parser may still read its ordinary items; no external entity is read.
        this.unsupported = true; this.mode = 'declaration';
        this.declarationDepth = this.bang.includes('[') ? 1 : 0;
        if (character === '>') this.mode = 'text';
      }
      return;
    }
    if (this.mode === 'text') {
      if (character === '<') { this.mode = 'open'; this.tokenStart = at; }
      else if (!this.stack.length && !white(character) && !(at === 0 && character === '\uFEFF')) this.failed = true;
      return;
    }
    if (this.mode === 'open') {
      if (character === '!') { this.mode = 'bang'; this.bang = '!'; return; }
      if (character === '?') { this.mode = 'pi'; this.terminator = 0; return; }
      this.closing = character === '/'; this.name = ''; this.quote = ''; this.last = '';
      this.mode = 'name';
      if (this.closing) return;
    }
    if (this.mode === 'name') {
      if (white(character) || character === '/' || character === '>') {
        if (!this.name) { this.failed = true; return; }
        this.mode = 'attributes';
        if (character === '>') return this.closeToken(at);
        this.last = white(character) ? '' : character;
      } else if (character === '<' || character === '=' || character === '"' || character === "'" || this.name.length >= 256) this.failed = true;
      else this.name += character.toLowerCase();
      return;
    }
    // attributes: a > inside either quoted value is not the end of a tag.
    if (this.quote) { if (character === this.quote) { this.quote = ''; this.last = character; } return; }
    if (character === '"' || character === "'") { this.quote = character; return; }
    if (character === '>') return this.closeToken(at);
    if (character === '<' || this.closing && !white(character)) { this.failed = true; return; }
    if (!white(character)) this.last = character;
  }

  private closeToken(at: number): PodcastXmlItem | undefined {
    const name = this.name, local = localName(name), selfClosing = !this.closing && this.last === '/';
    this.mode = 'text';
    if (this.closing) {
      if (this.stack.at(-1) !== name) { this.failed = true; return; }
      const item = this.currentItem;
      this.stack.pop();
      if (!this.stack.length) this.closedRoot = true;
      if (item && this.stack.length === item.depth && name === item.name) {
        this.currentItem = undefined;
        return { start: item.start, contentStart: item.contentStart, contentEnd: this.tokenStart, end: at + 1 };
      }
      return;
    }
    if (!this.stack.length) {
      if (this.root !== undefined) { this.failed = true; return; }
      this.root = local;
    }
    const parent = localName(this.stack.at(-1) ?? '');
    const genuine = local === 'item' && (this.root === 'rss' && this.stack.length === 2 && parent === 'channel'
      || this.root === 'channel' && this.stack.length === 1 || this.root === 'rdf' && this.stack.length === 1)
      || local === 'entry' && this.root === 'feed' && this.stack.length === 1;
    if (genuine) {
      this.firstItemStart ??= this.tokenStart;
      // Preserve the old parser's omission of empty <item/> / <entry/>.
      if (!selfClosing) this.currentItem = { start: this.tokenStart, contentStart: at + 1, depth: this.stack.length, name };
    }
    if (selfClosing) { if (!this.stack.length) this.closedRoot = true; }
    else {
      if (this.stack.length >= 128) { this.failed = true; return; }
      this.stack.push(name);
    }
  }
}

/** Lazy: a cooperative full parser scans only as far as its next genuine item. */
export function* podcastXmlItems(xml: string, requireComplete = false): Generator<PodcastXmlItem> {
  const scanner = new PodcastXmlScanner();
  for (let i = 0; i < xml.length && !scanner.failed; i++) {
    const item = scanner.next(xml[i]);
    if (item) yield item;
  }
  if (scanner.failed || requireComplete && (!scanner.complete || !scanner.feedRootDetected))
    throw new Error('Invalid or incomplete podcast XML');
}

/** Header search uses the same lexical rules, not fake markers in descriptions. */
export function podcastXmlHeaderEnd(xml: string): number {
  const scanner = new PodcastXmlScanner();
  for (let i = 0; i < xml.length && !scanner.failed; i++) {
    scanner.next(xml[i]);
    if (scanner.firstItemStart !== undefined) return scanner.firstItemStart;
  }
  return xml.length;
}
