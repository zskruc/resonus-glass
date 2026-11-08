import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPodcastOPMLImporter, exportPodcastOPML, parsePodcastOPML, podcastOPMLURL,
  PODCAST_OPML_MAX_BYTES, PODCAST_OPML_MAX_ENTRIES, type PodcastOPMLImportSnapshot } from '../src/lib/podcastOPML';

const wrap = (body: string) => `<?xml version="1.0"?><opml version="2.0"><head><title>Shows</title></head><body>${body}</body></opml>`;
const outline = (url: string, title = 'Show') => `<outline type="rss" xmlUrl="${url}" title="${title}"/>`;
const entry = (id: string) => ({ title: id, feedUrl: `https://feeds.test/${id}` });
const turn = () => new Promise<void>((done) => setImmediate(done));

test('nested OPML, quoted delimiters, comments and character entities decode without fetching external resources', () => {
  const parsed = parsePodcastOPML(wrap(`<outline text="Folder"><!-- nothing -->
    <outline text="A &amp; B &gt; C" type='rss' xmlUrl='https://feeds.test/a?one=1&amp;two=2' htmlUrl='https://publisher.test/' />
    <outline><outline type="RSS" url="https://feeds.test/b" title="&#x4E2D;&#25991; &quot;show&quot;"/></outline>
    <![CDATA[<outline xmlUrl="https://must-not-be-imported.test"/>]]></outline>`));
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.entries[0], { title: 'A & B > C', feedUrl: 'https://feeds.test/a?one=1&two=2', siteUrl: 'https://publisher.test/' });
  assert.equal(parsed.entries[1].title, '中文 "show"'); assert.equal(parsed.invalid + parsed.duplicates, 0);
});

test('canonical duplicates are skipped without guessing path, scheme or signed query equivalence', () => {
  const parsed = parsePodcastOPML(wrap(outline('https://FEEDS.test:443/a#fragment') + outline('https://feeds.test/a')
    + outline('http://feeds.test/a') + outline('https://feeds.test/a/') + outline('https://feeds.test/a?sig=secret')));
  assert.equal(parsed.duplicates, 1); assert.equal(parsed.entries.length, 4);
  assert.equal(podcastOPMLURL('https://user:password@feeds.test/a'), undefined);
});

test('unsafe URLs are counted and omitted; ordinary web outlines are not mistaken for RSS subscriptions', () => {
  const parsed = parsePodcastOPML(wrap(outline('file:///secret') + outline('javascript:alert(1)')
    + outline('https://user:pass@feeds.test/a') + outline('https://feeds.test/good')
    + '<outline type="link" url="https://site.test/"/>'));
  assert.equal(parsed.invalid, 3); assert.deepEqual(parsed.entries, [entry('good')].map((value) => ({ ...value, title: 'Show' })));
});

test('malformed XML is rejected rather than importing a partial document', () => {
  for (const invalid of ['', '<rss><channel/></rss>', '<opml><body>', '<opml><body></opml></body>',
    '<opml><body/></opml><opml><body/></opml>', '<opml><body><outline xmlUrl=https://feed.test/></body></opml>',
    wrap('<outline xmlUrl="https://feed.test" xmlUrl="https://other.test"/>'),
    wrap('<outline xmlUrl="https://feed.test" title="bad &unknown;"/>'),
    wrap('<outline xmlUrl="https://feed.test" title="bad & broken"/>'), wrap('<outline title="&#0;"/>'),
    wrap('<!-- unclosed'), wrap('<![CDATA[ unclosed'), wrap('<outline xmlUrl="https://feed.test/>'),
    wrap('<outline title="&#xD800;"/>'), '\u0000' + wrap('')]) assert.throws(() => parsePodcastOPML(invalid), invalid);
});

test('DTD and entity declarations are never accepted, and tags mentioned in comments are harmless', () => {
  for (const dtd of ['<!DOCTYPE opml SYSTEM "https://private.test/secrets">',
    '<!DOCTYPE opml [<!ENTITY x SYSTEM "file:///secret">]>', '<!ENTITY x "expanded">']) {
    assert.throws(() => parsePodcastOPML(dtd + wrap('')), (error: any) => error.code === 'unsafeXML');
  }
  assert.equal(parsePodcastOPML('<!-- <!DOCTYPE opml> -->' + wrap('')).entries.length, 0);
});

test('byte, entry and nesting limits prevent oversized imports, including multibyte documents', () => {
  assert.throws(() => parsePodcastOPML(wrap(' '.repeat(PODCAST_OPML_MAX_BYTES))), (error: any) => error.code === 'tooLarge');
  assert.throws(() => parsePodcastOPML(wrap('中'.repeat(Math.ceil(PODCAST_OPML_MAX_BYTES / 3)))), (error: any) => error.code === 'tooLarge');
  assert.throws(() => parsePodcastOPML(wrap(Array.from({ length: PODCAST_OPML_MAX_ENTRIES + 1 }, (_, index) => outline(`https://feeds.test/${index}`)).join(''))),
    (error: any) => error.code === 'tooMany');
  assert.throws(() => parsePodcastOPML(wrap('<outline>'.repeat(33) + '</outline>'.repeat(33))));
});

test('export is standard UTF-8 OPML that round-trips Unicode and XML characters, without internal state fields', () => {
  const output = exportPodcastOPML([{ title: '中文 <A> & "B"', feedUrl: 'https://feeds.test/a?x=1&y=2', siteUrl: 'https://site.test/' }], new Date('2026-11-09T00:00:00Z'));
  assert.match(output.xml, /encoding="UTF-8"/); assert.match(output.xml, /2026-11-09T00:00:00\.000Z/);
  assert.equal(output.exported, 1); assert.equal(output.skippedSensitive + output.skippedInvalid, 0);
  assert.deepEqual(parsePodcastOPML(output.xml).entries, [{ title: '中文 <A> & "B"', feedUrl: 'https://feeds.test/a?x=1&y=2', siteUrl: 'https://site.test/' }]);
  const extra = exportPodcastOPML([{ ...entry('a'), auth: { password: 'never-export' }, artFile: 'file:///private/' } as any]);
  assert.doesNotMatch(extra.xml, /never-export|file:\/\/\/private/);
});

test('export excludes credential-bearing URLs instead of creating a broken public version or leaking credentials', () => {
  const secret = ['https://user:pass@feeds.test/a', 'https://feeds.test/a?token=secret', 'https://feeds.test/a?api_key=secret', 'https://feeds.test/a?Password=secret'];
  const result = exportPodcastOPML([...secret.map((feedUrl) => ({ title: 'Private', feedUrl })),
    { ...entry('public'), siteUrl: 'https://site.test/?access_token=secret' }, { ...entry('public') }]);
  assert.equal(result.exported, 1); assert.equal(result.skippedSensitive, 4); assert.doesNotMatch(result.xml, /secret|user:pass|htmlUrl/);
  assert.equal(parsePodcastOPML(result.xml).entries[0].feedUrl, 'https://feeds.test/public');
});

function harness() {
  let owner: unknown = {}, profile = 'one', online = true;
  let list: { id: string; feedUrl: string }[] = [{ id: 'old', feedUrl: entry('old').feedUrl }];
  let reader = async () => list;
  const calls: { url: string; options: any }[] = [];
  let run = async (url: string, _options: any) => ({ id: url.split('/').at(-1)! });
  const control = createPodcastOPMLImporter({ owner: () => owner, profile: () => profile, allowed: () => online,
    added: () => reader(), subscribe: async (url, options) => { calls.push({ url, options }); return run(url, options); } });
  return { control, calls, setRunner(value: typeof run) { run = value; }, setReader(value: typeof reader) { reader = value; },
    switchAccount() { owner = {}; profile = profile === 'one' ? 'two' : 'one'; }, offline() { online = false; control.stop(); }, online() { online = true; },
    setAdded(value: typeof list) { list = value; } };
}

test('preview never subscribes; old feeds are marked existing, duplicate inputs are removed and all admission is serial', async () => {
  const h = harness(); let active = 0, maximum = 0;
  h.setRunner(async (url) => { active++; maximum = Math.max(maximum, active); await turn(); active--; return { id: url.split('/').at(-1)! }; });
  const plan = await h.control.prepare([entry('old'), entry('a'), entry('a'), entry('b')]); assert.ok(plan);
  assert.equal(h.calls.length, 0); assert.equal(plan.rows[0].status, 'existing'); assert.equal(plan.rows.length, 3);
  const result = await h.control.start(plan, () => {});
  assert.equal(maximum, 1); assert.equal(h.calls.length, 2); assert.deepEqual(result.rows.map((row) => row.status), ['existing', 'imported', 'imported']);
  assert.ok(h.calls.every((call) => call.options.expectedProfile === 'one'));
  await h.control.start(plan, () => {}); assert.equal(h.calls.length, 2, 'completed rows cannot be imported twice');
});

test('a failed item does not block later items, and retry only runs failed entries', async () => {
  const h = harness(); let fail = true;
  h.setRunner(async (url) => { if (url.endsWith('/a') && fail) throw Error('Unavailable'); return { id: url }; });
  const plan = await h.control.prepare([entry('a'), entry('b')]); assert.ok(plan);
  const first = await h.control.start(plan, () => {}); assert.deepEqual(first.rows.map((row) => row.status), ['failed', 'imported']);
  fail = false; await h.control.start(plan, () => {}, true);
  assert.deepEqual(h.calls.map((call) => call.url), [entry('a').feedUrl, entry('b').feedUrl, entry('a').feedUrl]);
});

test('an alternate feed resolving to a known show ID is existing, not counted as a new subscription', async () => {
  const h = harness(); h.setRunner(async () => ({ id: 'old' }));
  const plan = await h.control.prepare([entry('alias')]); assert.ok(plan);
  assert.equal((await h.control.start(plan, () => {})).rows[0].status, 'existing');
});

test('stopping aborts the active request, leaves remaining rows resumable and retains completed subscriptions', async () => {
  const h = harness(); const events: PodcastOPMLImportSnapshot[] = [];
  h.setRunner(async (url, options) => url.endsWith('/b') ? new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true })) : { id: url });
  const plan = await h.control.prepare([entry('a'), entry('b'), entry('c')]); assert.ok(plan);
  const running = h.control.start(plan, (state) => events.push(state));
  while (h.calls.length < 2) await turn(); h.control.stop();
  const stopped = await running;
  assert.deepEqual(stopped.rows.map((row) => row.status), ['imported', 'pending', 'pending']); assert.equal(stopped.stopped, true);
  assert.equal(h.calls[1].options.signal.aborted, true);
  h.setRunner(async (url) => ({ id: url }));
  await h.control.start(plan, () => {}); assert.equal(h.calls.length, 4);
  assert.equal(events.at(-1)?.running, false);
});

test('profile ABA, late list preparation and cancel never publish or admit subscriptions under a new owner', async () => {
  const h = harness(); let resolve!: (value: { id: string; feedUrl: string }[]) => void;
  h.setReader(() => new Promise((done) => { resolve = done; }));
  const pending = h.control.prepare([entry('a')]); h.switchAccount(); h.switchAccount(); resolve([]);
  assert.equal(await pending, null); assert.equal(h.calls.length, 0);
  h.setReader(async () => []); const plan = await h.control.prepare([entry('a')]); assert.ok(plan);
  h.control.cancel(); await assert.rejects(h.control.start(plan, () => {}), (error: any) => error.code === 'stopped');
  assert.equal(h.calls.length, 0);
});

test('offline refuses admission, a late unabortable result is rejected and double start cannot enqueue another run', async () => {
  const h = harness(); const plan = await h.control.prepare([entry('a'), entry('b')]); assert.ok(plan);
  h.offline(); await assert.rejects(h.control.start(plan, () => {}), (error: any) => error.code === 'offline'); assert.equal(h.calls.length, 0);
  h.online(); let resolve!: (value: { id: string }) => void;
  h.setRunner(async () => new Promise((done) => { resolve = done; }));
  const running = h.control.start(plan, () => {});
  await assert.rejects(h.control.start(plan, () => {}), (error: any) => error.code === 'busy');
  h.offline(); h.online(); resolve({ id: 'a' });
  const stopped = await running; assert.equal(stopped.stopped, true); assert.equal(h.calls.length, 1);
  assert.deepEqual(stopped.rows.map((row) => row.status), ['pending', 'pending']);
});

test('database preparation failures are visible and cannot masquerade as an empty subscription library', async () => {
  const h = harness(); h.setReader(async () => { throw Error('DB unavailable'); });
  await assert.rejects(h.control.prepare([entry('old')]), /DB unavailable/); assert.equal(h.calls.length, 0);
});
