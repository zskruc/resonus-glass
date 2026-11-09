import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import { parseFeed, parseFeedAsync, sortEpisodes } from '../src/lib/podcastFeed';
import { createPodcastFeedPreview } from '../src/lib/podcastFeedStream';
import * as directory from '../src/lib/podcastDirectory';

const rss = `<rss xmlns:itunes="urn:itunes" xmlns:podcast="urn:podcast"><channel><title>A &amp; B</title><itunes:type>serial</itunes:type>
  <description><![CDATA[<p>A show &amp; its history.</p>]]></description><itunes:image href="https://art.test/show.jpg"/>
  <item><guid>one</guid><title>First &lt;title&gt;</title><pubDate>Tue, 14 Nov 2023 22:13:20 GMT</pubDate><itunes:duration>1:02:03</itunes:duration>
    <description><![CDATA[<p>Notes <a href="https://example.test">here</a></p>]]></description><itunes:season>2</itunes:season>
    <podcast:chapters url="/chapters.json" type="application/json+chapters"/><podcast:transcript url="/text.vtt" type="text/vtt" language="en"/>
    <enclosure url="https://audio.test/one.mp3" type="audio/mpeg" length="1000"/></item>
  <item><guid>two</guid><title>中文與カタカナ</title><description>Plain &quot;notes&quot;</description><itunes:episodeType>bonus</itunes:episodeType></item>
</channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom title</title><author><name>Author</name></author>
  <link rel="self" href="https://example.test/feed"/><link href="https://example.test/site"/>
  <entry><id>entry-1</id><title>Entry</title><updated>2023-11-14T22:13:20Z</updated><summary><![CDATA[<p>Atom content</p>]]></summary>
    <link rel="enclosure" href="https://audio.test/atom.m4a" type="audio/mp4"/></entry>
  <entry><title>Undated</title></entry></feed>`;
function largeFeed(count = 2000) {
  const notes = '<p>Public-format synthetic text and <a href="https://example.test/notes">links</a>.</p>'.repeat(10);
  return '<rss><channel><title>Synthetic</title>' + Array.from({ length: count }, (_, index) =>
    `<item><guid>${index}</guid><title>Episode ${index}</title><description><![CDATA[${notes}]]></description><enclosure url="https://audio.test/${index}.mp3"/></item>`).join('') + '</channel></rss>';
}

test('sync and cooperatively scheduled parsing preserve complete RSS, Atom and whole-document CDATA results', async () => {
  for (const source of [rss, atom, `<![CDATA[${rss}]]>`, '<rss><channel><title>Empty</title></channel></rss>']) {
    let checks = 0;
    assert.deepEqual(await parseFeedAsync(source, 'show', 'https://publisher.test/feed', { check() { checks++; } }),
      parseFeed(source, 'show', 'https://publisher.test/feed'));
    assert.ok(checks >= 4);
  }
});

test('the production default scheduler lets a real timer run midway through a two-thousand-item feed', async () => {
  const xml = largeFeed(), expected = parseFeed(xml, 'show');
  let checks = 0, finished = false;
  const heartbeat = new Promise<void>((resolve) => setTimeout(() => {
    assert.equal(finished, false); assert.ok(checks > 2 && checks < 2000, `parser checks ${checks}`); resolve();
  }, 0));
  const parsing = parseFeedAsync(xml, 'show', undefined, { check() { checks++; } }).then((value) => { finished = true; return value; });
  await heartbeat;
  assert.deepEqual(await parsing, expected, 'yielding never publishes or loses a partial feed');
});

test('a batch has at most32 items even when the parser clock never advances', async (context) => {
  context.mock.method(performance, 'now', () => 0);
  let checks = 0, previous = 0, yields = 0;
  const result = await parseFeedAsync(largeFeed(100), 'show', undefined, {
    check() { checks++; }, async yieldControl() {
      const delta = checks - previous; previous = checks; yields++;
      assert.ok(delta <= 35, `no more than32 item checks plus entry/ownership checks per batch: ${delta}`);
    },
  });
  assert.equal(result.items.length, 100); assert.equal(yields, 3);
});

test('the four-millisecond parser budget yields before32 items on a slower clock', async (context) => {
  let clock = 0; context.mock.method(performance, 'now', () => clock += 2);
  let yields = 0;
  const result = await parseFeedAsync(largeFeed(10), 'show', undefined, { async yieldControl() { yields++; } });
  assert.equal(result.items.length, 10); assert.equal(yields, 5);
});

test('abort or owner invalidation at a yield rejects the partial parse and never returns an assembled feed', async () => {
  for (const kind of ['signal', 'owner']) {
    const ctl = new AbortController(); let current = true, yields = 0;
    await assert.rejects(parseFeedAsync(largeFeed(100), 'show', undefined, {
      signal: ctl.signal, check() { if (!current) throw new Error('owner changed'); },
      async yieldControl() { yields++; if (kind === 'signal') ctl.abort(); else current = false; },
    }), kind === 'signal' ? { name: 'AbortError' } : /owner changed/);
    assert.equal(yields, 1);
  }
  const ctl = new AbortController(); ctl.abort(); let scheduled = 0;
  await assert.rejects(parseFeedAsync(rss, 'show', undefined, { signal: ctl.signal, async yieldControl() { scheduled++; } }), { name: 'AbortError' });
  assert.equal(scheduled, 0);
});

test('the actual feed refresh cancels while parsing a large response without writing its channel, validators or episodes', async () => {
  const auth = createStore(() => ({ auth: { username: 'A' }, offline: false, autoOffline: false }));
  const xml = largeFeed(); let writes = 0, previousEpisodeReads = 0;
  const exports: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    'expo/fetch': { fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'new-etag' }, text: async () => xml }) },
    './netGate': { isManualOffline: () => false, assertCanRequest() {} },
    '@/store/auth': { profileScopeId: () => auth.getState().auth.username, useAuthStore: auth },
    '@/store/podcastDownloads': {}, '@/store/player': {}, '@/lib/podcastProgress': {}, '@/lib/episodeResume': {},
    '@/lib/localLibrary': { hashKey: (value: string) => value }, '@/lib/query': { queryClient: { invalidateQueries() {} } },
    '@/lib/podcastFeed': { parseFeedAsync, sortEpisodes }, '@/lib/podcastDirectory': directory,
    '@/lib/podcastFeedStream': { createPodcastFeedPreview },
    '@/lib/podcastDb': { getChannel: async () => undefined,
      listAllEpisodes: async () => { previousEpisodeReads++; return []; },
      saveChannel: async () => { writes++; }, replaceEpisodes: async () => { writes++; },
      saveFeedSnapshot: async () => { writes++; } },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/api/podcasts.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, AbortController, Date, setTimeout, clearTimeout,
    require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 0);
  await assert.rejects(exports.refreshChannel('https://publisher.test/feed', { signal: ctl.signal, expectedProfile: 'A' }),
    (error: any) => error.code === 'stopped');
  assert.equal(writes, 0); assert.equal(previousEpisodeReads, 0, 'the canceled parse stops before subsequent catalog work');
});
