import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import { parseFeed, sortEpisodes } from '../src/lib/podcastFeed';
import { podcastUrlExtension } from '../src/lib/podcastMedia';
import * as directory from '../src/lib/podcastDirectory';

const tick = async () => { for (let at = 0; at < 30; at++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function compile(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, AbortController, URL, ...globals,
    require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } }); return exports;
}
function clock() {
  let sequence = 0; const timers = new Map<number, { run: () => void; ms: number }>();
  return { setTimeout: (run: () => void, ms: number) => { const id = ++sequence; timers.set(id, { run, ms }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); }, count: () => timers.size,
    fire: (ms: number) => { const timer = [...timers].find(([, value]) => value.ms === ms); assert.ok(timer, `no ${ms}ms deadline armed`);
      timers.delete(timer[0]); timer[1].run(); } };
}
const xml = '<rss><channel><title>Show</title><item><guid>one</guid><title>Episode</title><enclosure url="https://audio.test/one.mp3"/></item></channel></rss>';
function feedHarness() {
  const timers = clock(), auth = createStore(() => ({ auth: { username: 'A' }, offline: false, autoOffline: false }));
  const headers = deferred<any>(), body = deferred<string>(); let bodyReads = 0, saves = 0;
  let mode: 'headers' | 'body' | 'fast' = 'headers'; const requests: AbortSignal[] = [];
  const response = () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => {
    bodyReads++; return mode === 'fast' ? xml : body.promise;
  } });
  const imports: Record<string, unknown> = {
    'expo/fetch': { fetch: async (_url: string, options: any) => { requests.push(options.signal); return mode === 'headers' ? headers.promise : response(); } },
    './netGate': { assertCanRequest() {}, isManualOffline: () => false, OfflineError: class extends Error {} },
    '@/store/auth': { profileScopeId: () => auth.getState().auth.username, useAuthStore: auth },
    '@/store/podcastDownloads': { usePodcastDownloads: { getState: () => ({ download: async () => {} }) } },
    '@/store/player': {}, '@/lib/podcastProgress': {}, '@/lib/episodeResume': {},
    '@/lib/localLibrary': { hashKey: (value: string) => value },
    '@/lib/query': { queryClient: { invalidateQueries: async () => {} } },
    '@/lib/podcastDb': { getChannel: async () => undefined, listAllEpisodes: async () => [],
      saveChannel: async () => { saves++; }, replaceEpisodes: async () => { saves++; } },
    '@/lib/podcastFeed': { parseFeed, sortEpisodes }, '@/lib/podcastDirectory': directory,
  };
  const api = compile('../src/api/podcasts.ts', imports, timers);
  return { api, timers, requests, headers, body, response, bodyReads: () => bodyReads, saves: () => saves,
    mode: (value: typeof mode) => { mode = value; } };
}

test('RSS header and body deadlines settle even when native transport ignores abort, and late results never write', async () => {
  for (const phase of ['headers', 'body'] as const) {
    const h = feedHarness(); h.mode(phase);
    const work = h.api.refreshChannel('https://feed.test/rss');
    const rejected = assert.rejects(work, (error: any) => error.code === 'http'); await tick();
    assert.equal(h.requests.length, 1); h.timers.fire(20_000); await rejected;
    assert.equal(h.requests[0].aborted, true); assert.equal(h.timers.count(), 0); assert.equal(h.saves(), 0);
    h.headers.resolve(h.response()); h.body.resolve(xml); await tick();
    assert.equal(h.saves(), 0); if (phase === 'headers') assert.equal(h.bodyReads(), 0, 'a late header cannot start another native read');
  }
});

test('caller abort promptly settles a stalled RSS transport or body instead of waiting for the 20-second timer', async () => {
  for (const phase of ['headers', 'body'] as const) {
    const h = feedHarness(); h.mode(phase); const controller = new AbortController();
    const work = h.api.refreshChannel('https://feed.test/rss', { signal: controller.signal, expectedProfile: 'A' });
    const rejected = assert.rejects(work, (error: any) => error.code === 'stopped'); await tick();
    controller.abort(); await rejected;
    assert.equal(h.requests[0].aborted, true); assert.equal(h.timers.count(), 0);
    h.headers.resolve(h.response()); h.body.resolve(xml); await tick(); assert.equal(h.saves(), 0);
  }
});

test('a quick successful RSS read still stores its channel and episodes and clears its deadline', async () => {
  const h = feedHarness(); h.mode('fast'); const channel = await h.api.refreshChannel('https://feed.test/rss');
  assert.equal(channel.title, 'Show'); assert.equal(h.saves(), 2); assert.equal(h.timers.count(), 0);
});

function artHarness() {
  const timers = clock(), result = deferred<any>();
  const files = new Map<string, number>(), parts: string[] = [], moves: { from: string; to: string }[] = [], deleted: string[] = [];
  let cancels = 0, active = true, cleanupStalls = false, quick = false;
  const imports = {
    'expo-file-system/legacy': { documentDirectory: 'file:///sandbox/',
      getInfoAsync: async (uri: string) => ({ exists: files.has(uri), size: files.get(uri) ?? 0 }),
      makeDirectoryAsync: async () => {},
      createDownloadResumable: (_url: string, part: string) => {
        parts.push(part); return { downloadAsync: async () => {
          const response = quick ? { status: 200, headers: { 'content-type': 'image/jpeg' } } : await result.promise;
          files.set(part, 512); return response;
        }, cancelAsync: async () => { cancels++; return new Promise<void>(() => {}); } };
      },
      moveAsync: async (move: { from: string; to: string }) => { moves.push(move); files.set(move.to, files.get(move.from)!); files.delete(move.from); },
      deleteAsync: async (uri: string) => { deleted.push(uri); if (cleanupStalls) return new Promise<void>(() => {}); files.delete(uri); },
    },
    'expo-sqlite': {}, '@/lib/localLibrary': { hashKey: () => 'image' }, './podcastMedia': { podcastUrlExtension }, '@/api/netGate': { isManualOffline: () => false },
  };
  const db = compile('../src/lib/podcastDb.ts', imports, timers);
  return { db, timers, result, files, parts, moves, deleted, cancels: () => cancels, current: () => active,
    stop: () => { active = false; }, quick: () => { quick = true; }, stallCleanup: () => { cleanupStalls = true; } };
}

test('a hanging artwork download returns the known cover within 2 seconds and cancels the real resumable task', async () => {
  const h = artHarness(); h.stallCleanup();
  const work = h.db.savePodcastArt('A', 'show', 'https://art.test/image.jpg', 'file:///known-cover.jpg', h.current); await tick();
  assert.equal(h.parts.length, 1); h.timers.fire(2000);
  assert.equal(await work, 'file:///known-cover.jpg'); assert.ok(h.cancels() >= 1); assert.equal(h.timers.count(), 0);
  h.result.resolve({ status: 200, headers: { 'content-type': 'image/jpeg' } }); await tick();
  assert.equal(h.moves.length, 0, 'late native completion may clean its part but cannot publish an image');
  assert.ok(h.deleted.every((uri) => uri === h.parts[0]));
});

test('route cancellation during artwork returns promptly, keeps the prior cover and cleans only its unique part', async () => {
  const h = artHarness(), controller = new AbortController();
  const work = h.db.savePodcastArt('A', 'show', 'https://art.test/image.jpg', 'file:///known-cover.jpg', h.current, controller.signal); await tick();
  controller.abort(); assert.equal(await work, 'file:///known-cover.jpg'); assert.ok(h.cancels() >= 1); assert.equal(h.timers.count(), 0);
  h.result.resolve({ status: 200, headers: { 'content-type': 'image/jpeg' } }); await tick();
  assert.equal(h.moves.length, 0); assert.equal(h.files.has(h.parts[0]), false);
  assert.ok(!h.deleted.includes('file:///known-cover.jpg'));
});

test('quick artwork and an existing valid cached cover retain the success path without leaking deadlines', async () => {
  const h = artHarness(); h.quick();
  const file = await h.db.savePodcastArt('A', 'show', 'https://art.test/image.jpg', undefined, h.current);
  assert.equal(file, 'file:///sandbox/podcasts/A/art/image.jpg'); assert.equal(h.moves.length, 1); assert.equal(h.files.get(file), 512);
  assert.equal(h.timers.count(), 0); assert.equal(h.cancels(), 0);
  assert.equal(await h.db.savePodcastArt('A', 'show', 'https://art.test/image.jpg', file, h.current), file);
  assert.equal(h.parts.length, 1, 'cached bytes skip the network entirely');
});

test('simultaneous artwork attempts have distinct part files and a changed account cannot promote late bytes', async () => {
  const h = artHarness();
  const first = h.db.savePodcastArt('A', 'show', 'https://art.test/image.jpg', undefined, h.current);
  const second = h.db.savePodcastArt('A', 'show', 'https://art.test/image.jpg', undefined, h.current); await tick();
  assert.equal(h.parts.length, 2); assert.notEqual(h.parts[0], h.parts[1]); h.stop();
  h.result.resolve({ status: 200, headers: { 'content-type': 'image/jpeg' } }); await Promise.all([first, second]);
  assert.equal(h.moves.length, 0); assert.equal(h.files.size, 0); assert.equal(h.timers.count(), 0);
});
