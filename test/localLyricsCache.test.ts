import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import type { SongLyrics } from '../src/api/subsonic';
import { parseLrc } from '../src/lib/lrc';
import { parseTtml } from '../src/lib/ttml';
import { createLyricsProviderRequest } from '../src/lib/lyricsProviderRequest';

const executable = ts.transpileModule(readFileSync(new URL('../src/lib/localLyrics.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const text = '[00:01.00]<00:01.00>One <00:01.50>two<00:02.00>\n[00:03.00]Next';
function deferred() { let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
function harness() {
  const files = new Map<string, string>();
  const state = { active: true, requests: 0, writes: 0, manualOffline: false };
  let clock = 0;
  const requested: string[] = [];
  let responses: { status: number; data: unknown; retryAfter?: string }[] = [];
  let mkdir: (() => Promise<void>) | undefined;
  const dependencies: Record<string, unknown> = {
    'expo/fetch': { fetch: async (url: string) => {
      state.requests++;
      requested.push(url);
      const response = responses.shift() ?? { status: 200, data: [{ syncedLyrics: text }] };
      return { ok: response.status >= 200 && response.status < 300, status: response.status,
        headers: new Headers({ 'Content-Type': 'application/json', ...(response.retryAfter ? { 'Retry-After': response.retryAfter } : {}) }),
        text: async () => JSON.stringify(response.data), json: async () => response.data };
    } },
    'expo-constants': { default: { expoConfig: { version: 'test' } } },
    'expo-file-system/legacy': {
      documentDirectory: 'file:///lyric-test/',
      getInfoAsync: async (path: string) => ({ exists: files.has(path), size: files.get(path)?.length ?? 0 }),
      readAsStringAsync: async (path: string) => {
        if (!files.has(path)) throw new Error('not cached');
        return files.get(path);
      },
      makeDirectoryAsync: async () => { await mkdir?.(); },
      writeAsStringAsync: async (path: string, value: string) => { state.writes++; files.set(path, value); },
    },
    './localLibrary': { hashKey: () => 'recording', readTags: async () => ({ lyrics: 'Embedded original' }) },
    './lrc': { parseLrc }, './ttml': { parseTtml },
    '@/api/netGate': { isManualOffline: () => state.manualOffline },
    './project': { PROJECT_NAME: 'Test', REPOSITORY_URL: 'https://example.test' },
    '../../modules/background-downloads': { delay: async (ms: number) => { clock += ms; } },
    './lyricsProviderRequest': { createLyricsProviderRequest: (deps: Parameters<typeof createLyricsProviderRequest>[0]) =>
      createLyricsProviderRequest({ ...deps, now: () => clock, random: () => 0 }) },
  };
  const exported: Record<string, any> = {};
  runInNewContext(executable, { exports: exported, __DEV__: false, URLSearchParams,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { state, files, requested, responses: (value: typeof responses) => { responses = value; },
    candidates: () => exported.findLrclibCandidates({ id: 'song', title: 'Song', artist: 'Artist', duration: 120 }, { stillCurrent: () => state.active }),
    localCandidates: (localUri = 'file:///music/song.mp3') => exported.getOnDeviceLyricCandidates({ id: 'song', title: 'Song', localUri }, () => state.active),
    mkdir: (work: () => Promise<void>) => { mkdir = work; },
    read: (strict = true, metadata = {}) => exported.getOnlineLyrics({ id: 'song', artist: 'Artist', title: 'Song', ...metadata },
      { strict, stillCurrent: () => state.active }) as Promise<SongLyrics | null>,
  };
}

test('a stopped lyric lookup waiting on directory creation cannot write a late LRCLIB cache file', async () => {
  for (const strict of [true, false]) {
    const h = harness(), entered = deferred(), release = deferred();
    h.mkdir(async () => { entered.resolve(); await release.promise; });
    const work = h.read(strict);
    await entered.promise;
    assert.equal(h.state.requests, 1, 'the provider already returned valid enhanced LRC');
    h.state.active = false; release.resolve();
    await assert.rejects(work, /Lyrics request stopped/);
    assert.equal(h.state.writes, 0); assert.equal(h.files.size, 0);
  }
});

test('an exact instrumental answer does not issue another search or become a provider failure', async () => {
  const h = harness();
  h.responses([{ status: 200, data: { instrumental: true, syncedLyrics: null, plainLyrics: null } },
    { status: 503, data: { name: 'ServerOverloaded' }, retryAfter: '1' }]);
  assert.equal(await h.read(true, { album: 'Album', duration: 180 }), null);
  assert.equal(h.state.requests, 1); assert.equal(h.state.writes, 0);
  assert.equal(new URL(h.requested[0]).pathname, '/api/get');
});

test('long ASMR metadata omits an unsupported duration instead of sending a 400-causing or invented value', async () => {
  const h = harness();
  h.responses([{ status: 404, data: { name: 'TrackNotFound' } }, { status: 200, data: [] }]);
  assert.equal(await h.read(true, { album: 'Long recording', duration: 3645 }), null);
  const exact = new URL(h.requested[0]);
  assert.equal(exact.pathname, '/api/get'); assert.equal(exact.searchParams.has('duration'), false);
  assert.equal(exact.searchParams.get('album_name'), 'Long recording');
  assert.equal(new URL(h.requested[1]).pathname, '/api/search');
});

test('overload retry can recover a lyric while an exhausted overload never becomes a saved missing answer', async () => {
  const recovered = harness();
  recovered.responses([{ status: 503, data: { name: 'ServerOverloaded' }, retryAfter: '1' },
    { status: 200, data: [{ syncedLyrics: text }] }]);
  assert.ok((await recovered.read())?.lines[0].words?.length);
  assert.equal(recovered.state.requests, 2); assert.equal(recovered.state.writes, 1);
  const failed = harness();
  failed.responses(Array.from({ length: 3 }, () => ({ status: 503, data: { name: 'ServerOverloaded' }, retryAfter: '1' })));
  await assert.rejects(failed.read());
  assert.equal(failed.state.requests, 3); assert.equal(failed.state.writes, 0);
});

test('a nonempty unsupported lyrics document is not misclassified as confirmed missing', async () => {
  const h = harness();
  h.responses([{ status: 200, data: { instrumental: false, syncedLyrics: null, plainLyrics: null,
    lyricsfile: "version: '1.0'\nlines: [{text: 'words'}]" } }]);
  await assert.rejects(h.read(true, { album: 'Album', duration: 100 }), /format is not supported/);
  assert.equal(h.state.writes, 0); assert.equal(h.state.requests, 1);
});

test('an active lookup caches once and retains exact line and word timing on cache reuse', async () => {
  const h = harness();
  const first = await h.read();
  assert.ok(first?.synced);
  assert.equal(first.lines[0].start, 1000);
  assert.equal(first.lines[0].value, 'One two');
  assert.deepEqual(first.lines[0].words, [
    { start: 1000, value: 'One ' },
    { start: 1500, end: 2000, value: 'two' },
  ]);
  assert.equal(first.lines[1].start, 3000);
  assert.equal([...h.files.values()][0], text, 'the cached source text is not flattened or retimed');
  assert.deepEqual(await h.read(), first);
  assert.equal(h.state.requests, 1); assert.equal(h.state.writes, 1);
});

test('source candidates read all on-device formats without network and reject oversized sidecars before parsing', async () => {
  const h = harness();
  h.files.set('file:///music/song.ttml', '<tt><body><p begin="1s">TTML original<span ttm:role="x-translation">翻译</span></p></body></tt>');
  h.files.set('file:///music/song.lrc', text);
  const candidates = await h.localCandidates();
  assert.deepEqual(Array.from(candidates, (candidate: any) => candidate.kind), ['sidecar-ttml', 'sidecar-lrc', 'embedded']);
  assert.equal(candidates[0].lyrics.lines[0].translation, '翻译'); assert.equal(h.state.requests, 0);
  h.files.set('file:///music/song.ttml', 'x'.repeat(1_000_001));
  assert.deepEqual(Array.from(await h.localCandidates(), (candidate: any) => candidate.kind), ['sidecar-lrc', 'embedded']);
});

test('explicit provider candidate search stays paced, recording-labelled and capped, and manual offline makes no request', async () => {
  const h = harness(); h.state.manualOffline = true;
  await assert.rejects(h.candidates(), /Offline mode/); assert.equal(h.state.requests, 0);
  h.state.manualOffline = false;
  h.responses([{ status: 200, data: Array.from({ length: 30 }, (_, index) => ({ id: index, trackName: 'Song', artistName: 'Artist',
    albumName: `Edition ${index}`, duration: 100 + index, syncedLyrics: text })) }]);
  const candidates = await h.candidates();
  assert.equal(candidates.length, 10); assert.equal(candidates[0].id, 'lrclib:20');
  assert.match(candidates[0].label, /Edition 20.*120 s/); assert.equal(h.state.requests, 1); assert.equal(h.state.writes, 0);
  h.state.active = false; await assert.rejects(h.candidates(), /request stopped/); assert.equal(h.state.requests, 1);
});
