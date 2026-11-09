/** Bounded, one-shot preview of genuine publisher RSS/Atom items on one GET. */
import { parseFeed, type ParsedFeed } from './podcastFeed';
import { PodcastXmlScanner } from './podcastXml';

export const PODCAST_FEED_PREVIEW_MAX_BYTES = 512 * 1024;

export function createPodcastFeedPreview(channelId: string, baseUrl?: string, limit = 7) {
  const wanted = Number.isSafeInteger(limit) && limit >= 1 && limit <= 20 ? limit : 7;
  const scanner = new PodcastXmlScanner();
  const blocks: string[] = [];
  const block = new Uint16Array(4096);
  let blockUsed = 0, bytes = 0, previousHighSurrogate = false, items = 0, done = false;
  const release = () => { blocks.length = 0; blockUsed = 0; };
  const emit = (): ParsedFeed | undefined => {
    done = true;
    try {
      const prefix = blocks.join('') + String.fromCharCode(...block.subarray(0, blockUsed));
      const feed = parseFeed(prefix, channelId, baseUrl);
      return feed.items.length === items ? feed : undefined;
    } catch { return undefined; }
    finally { release(); }
  };
  return {
    push(chunk: string): ParsedFeed | undefined {
      if (done) return;
      for (let i = 0; i < chunk.length; i++) {
        const code = chunk.charCodeAt(i);
        // Count UTF-8 bytes even if a caller splits a surrogate pair between
        // pushes. UTF-8 decoding itself belongs to the network caller.
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2
          : code >= 0xdc00 && code <= 0xdfff && previousHighSurrogate ? 1 : 3;
        previousHighSurrogate = code >= 0xd800 && code <= 0xdbff;
        if (bytes > PODCAST_FEED_PREVIEW_MAX_BYTES) { done = true; release(); return; }
        block[blockUsed++] = code;
        if (blockUsed === block.length) { blocks.push(String.fromCharCode(...block)); blockUsed = 0; }
        const item = scanner.next(chunk[i]);
        if (scanner.failed || scanner.unsupported || scanner.rootDetected && !scanner.previewSupported) { done = true; release(); return; }
        if (item && ++items === wanted) return scanner.previewSupported ? emit() : undefined;
      }
    },
    finish(): ParsedFeed | undefined {
      if (done) return;
      if (!scanner.complete || !scanner.previewSupported || scanner.unsupported) { done = true; release(); return; }
      return emit();
    },
  };
}
