import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseFeed } from '../src/lib/podcastFeed';
import * as notes from '../src/lib/podcastShowNotes';
import { normalizePodcastChapters, parsePodcastChapters } from '../src/lib/podcastChapters';
import { playPodcastEpisodeAt } from '../src/lib/podcastEpisodePlayback';

const fixture = `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:p="https://podcastindex.org/namespace/1.0"
  xmlns:c="http://podlove.org/simple-chapters"><channel><title>Show</title><itunes:type>serial</itunes:type>
  <item><guid>ep</guid><title>Episode</title><itunes:season>2</itunes:season><itunes:episode>3</itunes:episode>
  <itunes:episodeType>bonus</itunes:episodeType><description><![CDATA[<p>Short summary</p>]]></description>
  <content:encoded><![CDATA[<h2>Topics</h2><p>00:30 <b>Introduction</b> &amp; a <a href="/extra">link</a></p>]]></content:encoded>
  <c:chapters><c:chapter start="00:30" title="Later" href="/later"/><c:chapter start="0" title="Start &amp; go"/>
   <c:chapter start="00:30" title="Duplicate"/><c:chapter start="bad" title="Broken"/></c:chapters>
  <p:chapters url="/chapters.json" type="application/json+chapters"/>
  <p:transcript url="/transcript.vtt" type="text/vtt" language="zh" rel="captions"/>
  <p:transcript url="javascript:alert(1)" type="text/html"/>
  <enclosure url="https://audio.test/ep.mp3" type="audio/mpeg"/></item></channel></rss>`;

test('the real RSS parser keeps old summaries/IDs while retaining rich text, season/type and opt-in chapter/transcript metadata', () => {
  const feed = parseFeed(fixture, 'show', 'https://publisher.test/rss');
  assert.equal(feed.showType, 'serial'); const item = feed.items[0];
  assert.equal(item.id, 'show/ep'); assert.equal(item.description, 'Short summary');
  assert.match(item.descriptionHtml!, /<h2>Topics<\/h2>/); assert.equal(item.season, 2); assert.equal(item.episode, 3); assert.equal(item.episodeType, 'bonus');
  assert.deepEqual(item.chapters?.map((chapter) => [chapter.startSec, chapter.title]), [[0, 'Start & go'], [30, 'Later']]);
  assert.equal(item.chapters?.[1].url, 'https://publisher.test/later');
  assert.equal(item.chaptersUrl, 'https://publisher.test/chapters.json');
  assert.deepEqual(item.transcripts, [{ url: 'https://publisher.test/transcript.vtt', type: 'text/vtt', language: 'zh', rel: 'captions' }]);
  const old = parseFeed('<rss><channel><item><title>Old feed</title></item></channel></rss>', 'c').items[0];
  assert.equal(old.season, undefined); assert.equal(old.chapters, undefined); assert.equal(old.transcripts, undefined);
});

test('unknown optional tags and unsafe chapter/transcript URLs do not become invented metadata', () => {
  const item = parseFeed('<rss><channel><itunes:type>other</itunes:type><item><itunes:season>-2</itunes:season><itunes:episodeType>ad</itunes:episodeType>'
    + '<podcast:chapters url="file:///private/data"/><podcast:transcript url="data:text/html,hi"/></item></channel></rss>', 'c').items[0];
  assert.equal(item.season, undefined); assert.equal(item.episodeType, undefined); assert.equal(item.chaptersUrl, undefined); assert.equal(item.transcripts, undefined);
});

test('native show notes preserve paragraphs, emphasis, safe links and seek timestamps without scripts, images or active HTML', () => {
  const blocks = notes.podcastShowNotes('<h2>Topics</h2><p><strong>Hello</strong> at 01:02:03.250 and <em>again</em> 05:30.</p>'
    + '<ul><li><a href="/page?a=1&amp;b=2">Read</a></li></ul><script>secret()</script><iframe>hidden</iframe><img src="https://image.test/pixel">', 'https://publisher.test/rss');
  assert.deepEqual(blocks.map((block) => block.kind), ['heading', 'paragraph', 'listItem']);
  const spans = blocks.flatMap((block) => block.spans);
  assert.ok(spans.some((span) => span.bold && span.text === 'Hello'));
  assert.deepEqual(spans.filter((span) => span.startSec !== undefined).map((span) => span.startSec), [3723.25, 330]);
  assert.equal(spans.find((span) => span.href)?.href, 'https://publisher.test/page?a=1&b=2');
  assert.doesNotMatch(JSON.stringify(blocks), /secret|hidden|pixel/);
  assert.equal(notes.podcastShowNotes('<p>Visible</p><script>unclosed')[0].spans[0].text, 'Visible');
});

test('plain and escaped notes stay bounded, invalid clocks do not seek, and non-http links never become actions', () => {
  const blocks = notes.podcastShowNotes('&lt;p&gt;00:00 Start&lt;/p&gt;&lt;p&gt;12:99 invalid&lt;/p&gt;');
  assert.equal(blocks.length, 2); assert.equal(blocks[0].spans[0].startSec, 0); assert.equal(blocks[1].spans.some((span) => span.startSec !== undefined), false);
  assert.equal(notes.podcastShowNotes(Array.from({ length: 1000 }, () => 'line').join('\n')).length, 300);
  for (const url of ['javascript:alert(1)', 'file:///a', 'data:text/html,Hi', 'intent://other', 'https://user:password@host.test/']) assert.equal(notes.safePodcastUrl(url), undefined);
  assert.equal(notes.podcastTimestamp('99:99'), undefined); assert.equal(notes.podcastTimestamp(-1), undefined);
});

test('Podcasting 2.0 chapter JSON is sorted, bounded and deduplicated, with invalid positions and hidden TOC rows excluded', () => {
  const chapters = parsePodcastChapters({ version: '1.2.0', chapters: [{ startTime: 20, title: 'B', url: '/more' },
    { startTime: 0, title: 'A', img: 'javascript:bad' }, { startTime: 20, title: 'Duplicate' }, { startTime: -2, title: 'Invalid' }, { startTime: 30, title: 'Hidden', toc: false }] }, 'https://publisher.test/a.json');
  assert.deepEqual(chapters.map((row) => row.title), ['A', 'B']); assert.equal(chapters[0].imageUrl, undefined); assert.equal(chapters[1].url, 'https://publisher.test/more');
  assert.equal(normalizePodcastChapters(Array.from({ length: 5000 }, (_, startTime) => ({ startTime, title: 'Chapter' }))).length, 1000);
  assert.throws(() => parsePodcastChapters({ media: 'audio' }));
});

function chapterRequestHarness() {
  let timer!: () => void, pendingTimers = 0, requestSignal!: AbortSignal, cancelled = 0, reads = 0;
  const dependencies = { './podcastShowNotes': notes };
  const exported: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/podcastChapters.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: exported, AbortController, TextDecoder, TextEncoder,
    setTimeout: (callback: () => void, ms: number) => { assert.equal(ms, 20000); timer = callback; pendingTimers++; return 1; },
    clearTimeout: () => { pendingTimers = 0; }, require: (name: string) => { assert.ok(name in dependencies); return (dependencies as any)[name]; } });
  let active = true, offline = false;
  const options = { current: () => active, offline: () => offline,
    fetch: async (_url: string, init: any): Promise<any> => { requestSignal = init.signal; assert.equal(init.credentials, 'omit'); assert.equal('authorization' in init.headers, false);
      return { ok: true, headers: { get: () => null }, text: async () => { reads++; return '{"chapters":[{"startTime":0,"title":"Start"}]}'; } }; } };
  return { api: exported, options, expire: () => timer(), timers: () => pendingTimers, signal: () => requestSignal,
    offline: () => { offline = true; }, stop: () => { active = false; }, cancelled: () => cancelled, reads: () => reads,
    response: (value: any) => { options.fetch = async (_url, init) => { requestSignal = init.signal; return value; }; },
    oversizedStream: () => { options.fetch = async (_url, init) => { requestSignal = init.signal; return { ok: true, headers: { get: () => null }, body: { getReader: () => ({
      read: async () => ({ done: false, value: new Uint8Array(512 * 1024 + 1) }), cancel: async () => { cancelled++; }, releaseLock() {},
    }) } }; }; } };
}

test('external chapters use a hard 20-second deadline/caller abort even when headers or the body never settle', async () => {
  for (const phase of ['headers', 'body']) {
    const h = chapterRequestHarness();
    if (phase === 'headers') h.options.fetch = async () => new Promise(() => {});
    else h.response({ ok: true, headers: { get: () => null }, text: async () => new Promise(() => {}) });
    const work = h.api.fetchPodcastChapters('https://publisher.test/chapters.json', h.options);
    const rejected = assert.rejects(work, (error: any) => error.code === 'timeout'); await Promise.resolve(); h.expire(); await rejected;
    assert.equal(h.timers(), 0);
  }
  const h = chapterRequestHarness(), controller = new AbortController(); h.options.fetch = async () => new Promise(() => {});
  const work = h.api.fetchPodcastChapters('https://publisher.test/chapters.json', { ...h.options, signal: controller.signal });
  const rejected = assert.rejects(work, (error: any) => error.code === 'stopped'); controller.abort(); await rejected; assert.equal(h.timers(), 0);
});

test('chapter transport rejects audio and oversized data before rendering, and manual offline makes zero requests', async () => {
  const offline = chapterRequestHarness(); offline.offline(); let calls = 0; offline.options.fetch = async () => { calls++; return {}; };
  await assert.rejects(offline.api.fetchPodcastChapters('https://publisher.test/chapters.json', offline.options), (error: any) => error.code === 'offline'); assert.equal(calls, 0);
  const h = chapterRequestHarness(); let bodyReads = 0;
  h.response({ ok: true, headers: { get: (name: string) => name === 'content-type' ? 'audio/mpeg' : null }, text: async () => { bodyReads++; return ''; } });
  await assert.rejects(h.api.fetchPodcastChapters('https://publisher.test/wrong', h.options), (error: any) => error.code === 'invalid'); assert.equal(bodyReads, 0);
  h.oversizedStream(); await assert.rejects(h.api.fetchPodcastChapters('https://publisher.test/huge', h.options), (error: any) => error.code === 'tooLarge');
  assert.equal(h.cancelled(), 1); assert.equal(h.signal().aborted, true); assert.equal(h.timers(), 0);
});

test('small chapter documents load once with credential-free transport and reject a late profile replacement', async () => {
  const h = chapterRequestHarness();
  assert.equal((await h.api.fetchPodcastChapters('https://publisher.test/chapters.json', h.options))[0].title, 'Start'); assert.equal(h.reads(), 1); assert.equal(h.timers(), 0);
  h.response({ ok: true, headers: { get: () => null }, text: async () => { h.stop(); return '{"chapters":[]}'; } });
  await assert.rejects(h.api.fetchPodcastChapters('https://publisher.test/chapters.json', h.options), (error: any) => error.code === 'stopped');
});

function playback() {
  const episode = { id: 'feed/episode', channelId: 'feed', title: 'Episode', url: 'https://audio.test/a.mp3', duration: 200 };
  const channel = { id: 'feed', title: 'Show' };
  let state = { songId: 'other', channelId: 'other', queue: [{}] as any[], index: 0, seekVersion: 0, playing: true, loading: false }, active = true;
  const seeks: number[] = [], songs: any[] = []; let toggles = 0, finish!: (value: boolean) => void;
  const actions = { current: () => active, read: () => state, available: () => true,
    toSong: (item: any, show: any) => ({ id: item.id, title: item.title, url: item.url, vod: true, podcastChannelId: show.id }),
    play: async (song: any) => { songs.push(song); state = { ...state, songId: song.id, channelId: song.podcastChannelId, queue: [song] };
      return new Promise<boolean>((resolve) => { finish = resolve; }); },
    seek: (seconds: number) => { seeks.push(seconds); state = { ...state, seekVersion: state.seekVersion + 1 }; }, toggle: () => { toggles++; state = { ...state, playing: !state.playing }; } };
  return { episode, channel, actions, seeks, songs, toggles: () => toggles, state: () => state, update: (change: Partial<typeof state>) => { state = { ...state, ...change }; },
    stop: () => { active = false; }, finish: (value = true) => finish(value) };
}
test('chapter playback uses the real RSS enclosure identity and seeks only after its own queue is accepted', async () => {
  const h = playback(), work = playPodcastEpisodeAt(h.episode, h.channel, 80, h.actions); assert.equal(h.seeks.length, 0);
  assert.equal(h.songs[0].id, h.episode.id); assert.equal(h.songs[0].url, h.episode.url); assert.equal(h.songs[0].podcastChannelId, 'feed');
  h.finish(); assert.equal(await work, 'played'); assert.deepEqual(h.seeks, [80]);
});
test('ordinary Play retains resume/intro policies, while explicit same-episode timestamps seek and resume a paused player', async () => {
  const h = playback(), normal = playPodcastEpisodeAt(h.episode, h.channel, undefined, h.actions); h.finish(); await normal; assert.deepEqual(h.seeks, []);
  h.update({ playing: false }); assert.equal(await playPodcastEpisodeAt(h.episode, h.channel, 0, h.actions), 'played'); assert.deepEqual(h.seeks, [0]); assert.equal(h.toggles(), 1);
});
test('current-id loading restarts under an owned queue instead of seeking the previous native source', async () => {
  const h = playback(); h.update({ songId: h.episode.id, channelId: h.channel.id, loading: true });
  const work = playPodcastEpisodeAt(h.episode, h.channel, 50, h.actions); assert.equal(h.songs.length, 1); assert.equal(h.seeks.length, 0);
  h.finish(); assert.equal(await work, 'played'); assert.deepEqual(h.seeks, [50]);
});
test('late chapter seeks cannot override profile/route cancellation, a newer queue or a manual seek', async () => {
  for (const replacement of ['owner', 'queue', 'seek']) {
    const h = playback(), work = playPodcastEpisodeAt(h.episode, h.channel, 100, h.actions);
    if (replacement === 'owner') h.stop(); else if (replacement === 'queue') h.update({ queue: [{}] }); else h.update({ seekVersion: 1 });
    h.finish(); assert.equal(await work, 'superseded'); assert.deepEqual(h.seeks, []);
  }
  const h = playback(); h.actions.available = () => false;
  assert.equal(await playPodcastEpisodeAt(h.episode, h.channel, 20, h.actions), 'unavailable'); assert.equal(h.songs.length, 0);
});
