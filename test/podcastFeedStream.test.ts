import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFeed, parseFeedAsync } from '../src/lib/podcastFeed';
import { createPodcastFeedPreview, PODCAST_FEED_PREVIEW_MAX_BYTES } from '../src/lib/podcastFeedStream';
import { podcastXmlItems } from '../src/lib/podcastXml';

const item = (index: number, extra = '') => `<item note="quoted > is not the tag end"><title>Episode ${index}</title><guid>guid-${index}&amp;x</guid>${extra}<enclosure url="https://audio.test/${index}.mp3" type="audio/mpeg"/></item>`;
const feed = (items: string) => `<?xml version="1.0"?><rss><channel><title>Publisher</title><description><![CDATA[Show notes]]></description>${items}</channel></rss>`;

test('one-character chunks publish exactly the first seven complete canonical RSS items once', () => {
  const xml = feed(Array.from({ length: 10 }, (_, index) => item(index)).join(''));
  const reader = createPodcastFeedPreview('same-feed-hash', 'https://publisher.test/rss');
  const emitted = [];
  let when = -1;
  for (let i = 0; i < xml.length; i++) {
    const result = reader.push(xml[i]);
    if (result) { emitted.push(result); when = i + 1; }
  }
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], { ...parseFeed(xml, 'same-feed-hash', 'https://publisher.test/rss'),
    items: parseFeed(xml, 'same-feed-hash', 'https://publisher.test/rss').items.slice(0, 7) });
  assert.equal(emitted[0].items[0].id, 'same-feed-hash/guid-0&x');
  assert.equal(when, xml.indexOf(item(6)) + item(6).length);
  assert.equal(reader.finish(), undefined);
  assert.equal(reader.push(xml), undefined);
});

test('CDATA, comments, processing instructions and nested markup cannot manufacture episode boundaries', () => {
  const fake = '<item><guid>fake</guid></item>';
  const notes = '<description><![CDATA[<p>Real notes</p></item>' + fake + ' and > stays text]]></description>';
  const xml = feed(`<!-- ${fake} --><?ignore ${fake} ?>` + item(0, notes)
    + `<description><item><guid>nested-not-an-episode</guid></item></description>` + item(1));
  const reader = createPodcastFeedPreview('c', undefined, 2);
  let emitted;
  // Every lexical terminator crosses a different chunk boundary.
  for (let i = 0; i < xml.length; i += 3) emitted ??= reader.push(xml.slice(i, i + 3));
  assert.ok(emitted);
  assert.deepEqual(emitted.items.map((entry) => entry.id), ['c/guid-0&x', 'c/guid-1&x']);
  assert.match(emitted.items[0].descriptionHtml!, /<guid>fake<\/guid>/);
  assert.deepEqual(emitted.items, parseFeed(xml, 'c').items);
  assert.equal([...podcastXmlItems(xml)].length, 2);
});

test('a real item title is not mistaken for the feed title because a comment mentioned item earlier', () => {
  const xml = '<rss><channel><!-- <item> --> <title>Real publisher</title>' + item(0) + '</channel></rss>';
  const reader = createPodcastFeedPreview('c', undefined, 1);
  const result = reader.push(xml)!;
  assert.equal(result.title, 'Real publisher');
  assert.equal(result.items[0].title, 'Episode 0');
});

test('Atom entries use the same enclosure, entity-decoded ids, metadata and ordering as the full parser', () => {
  const entries = Array.from({ length: 9 }, (_, index) => `<entry><id>urn:uuid:${index}&amp;ok</id><title>Atom ${index}</title>`
    + `<summary><![CDATA[Literal </entry><entry> is a note]]></summary><link rel="enclosure" href="https://audio.test/${index}.m4a" type="audio/mp4"/></entry>`).join('');
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom publisher</title><author><name>Author</name></author>${entries}</feed>`;
  const reader = createPodcastFeedPreview('atom');
  const result = reader.push(xml)!;
  assert.equal(result.items.length, 7);
  assert.deepEqual(result.items, parseFeed(xml, 'atom').items.slice(0, 7));
  assert.equal(result.items[0].url, 'https://audio.test/0.m4a');
});

test('finish publishes fewer genuine items only after a complete feed, including a valid empty feed', () => {
  for (const count of [0, 1, 6]) {
    const xml = feed(Array.from({ length: count }, (_, index) => item(index)).join(''));
    const reader = createPodcastFeedPreview('c');
    assert.equal(reader.push(xml), undefined);
    assert.deepEqual(reader.finish(), parseFeed(xml, 'c'));
    assert.equal(reader.finish(), undefined);
  }
  const incomplete = createPodcastFeedPreview('c');
  assert.equal(incomplete.push('<rss><channel>' + item(0) + '<item><guid>incomplete'), undefined);
  assert.equal(incomplete.finish(), undefined);
});

test('malformed, unsupported or over-budget prefixes fail closed without throwing or later emitting', () => {
  const sources = [
    '<rss><channel><item><guid>x</item></channel></rss>',
    '<html><channel>' + item(0) + '</channel></html>',
    '<!DOCTYPE rss [<!ENTITY x "literal">]>' + feed(item(0)),
    '<rss><channel><description><![CDATA[' + 'x'.repeat(PODCAST_FEED_PREVIEW_MAX_BYTES) + ']]></description>' + item(0) + '</channel></rss>',
  ];
  for (const xml of sources) {
    const reader = createPodcastFeedPreview('c', undefined, 1);
    assert.equal(reader.push(xml), undefined);
    assert.equal(reader.finish(), undefined);
    assert.equal(reader.push(feed(item(0))), undefined);
  }
});

test('the prefix byte cap counts UTF-8 rather than only JS code units, including split surrogate pairs', () => {
  const large = feed(item(0, '<description><![CDATA[' + '中'.repeat(Math.ceil(PODCAST_FEED_PREVIEW_MAX_BYTES / 3)) + ']]></description>'));
  assert.ok(large.length < PODCAST_FEED_PREVIEW_MAX_BYTES);
  assert.equal(createPodcastFeedPreview('c', undefined, 1).push(large), undefined);
  const xml = feed(item(0, '<description><![CDATA[😀𠀀]]></description>'));
  const reader = createPodcastFeedPreview('c', undefined, 1);
  let result;
  for (let i = 0; i < xml.length; i++) result ??= reader.push(xml[i]);
  assert.deepEqual(result, parseFeed(xml, 'c'));
});

test('a huge incoming chunk can still publish an early bounded prefix without retaining its tail', () => {
  const prefix = feed(Array.from({ length: 7 }, (_, index) => item(index)).join(''));
  const reader = createPodcastFeedPreview('c');
  const result = reader.push(prefix + 'x'.repeat(PODCAST_FEED_PREVIEW_MAX_BYTES * 2));
  assert.equal(result?.items.length, 7);
  assert.equal(reader.finish(), undefined);
});

test('full async promotion rejects mismatched or truncated XML after complete early items', async () => {
  for (const xml of [feed(item(0)).slice(0, -6), '<rss><channel>' + item(0) + '<item><guid>broken</item></channel></rss>']) {
    await assert.rejects(parseFeedAsync(xml, 'c', undefined, { requireComplete: true }), /Invalid or incomplete/);
  }
  // The prefix parser intentionally accepts complete items under an unfinished
  // parent; only full network promotion requires the closing root.
  const prefix = '<rss><channel>' + item(0);
  assert.equal(parseFeed(prefix, 'c').items.length, 1);
  await assert.rejects(parseFeedAsync(prefix, 'c', undefined, { requireComplete: true }), /Invalid or incomplete/);
});
