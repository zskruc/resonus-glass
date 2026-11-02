import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { untilAborted } from '../src/api/deadline';
import { createSlots } from '../src/lib/slots';

const source = ts.transpileModule(readFileSync(new URL('../src/api/subsonic.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness() {
  const sent: string[] = [], headers: (() => void)[] = [];
  let timers = 0, offline = false;
  const deadlines: number[] = [];
  const response = () => ({ ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ 'subsonic-response': { status: 'ok', lyricsList: { structuredLyrics: [] },
      album: { id: 'album', name: 'Album', song: [] } } }) });
  const deps: Record<string, unknown> = {
    'expo-crypto': {},
    'expo/fetch': { fetch: (url: string) => {
      const endpoint = new URL(url).pathname.split('/').at(-1)!; sent.push(endpoint);
      if (endpoint === 'getAlbum.view') return Promise.resolve(response());
      return new Promise((resolve) => headers.push(() => resolve(response())));
    } },
    '@/i18n': { tg: (value: string) => value },
    '@/lib/absentCovers': { omitsAbsentCovers: () => false },
    '@/lib/lyricWords': {}, '@/lib/navidromeIds': {},
    '@/lib/perfLog': { timed: (_label: string, work: () => unknown) => work(), netTally: () => {} },
    '@/lib/slots': { createSlots }, './deadline': { untilAborted },
    './netGate': { assertCanRequest: () => { if (offline) throw new Error('offline'); } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, __DEV__: false, AbortController, URLSearchParams,
    setTimeout: (_work: unknown, ms: number) => { deadlines.push(ms); return ++timers; }, clearTimeout: () => {},
    require(name: string) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  const auth = { serverUrl: 'https://music.test', username: 'test', token: 'test', salt: 'test' };
  return { sent, headers, deadlines, timers: () => timers, offline: () => { offline = true; },
    lyric: (id: string) => exports.getLyricsBySongId(auth, id), album: () => exports.getAlbum(auth, 'album') };
}

test('cold server lyric reads use two slots, start deadlines only on dispatch, and leave ordinary album reads available', async () => {
  const h = harness(); const work = ['a', 'b', 'c', 'd'].map(h.lyric);
  await tick(); assert.equal(h.sent.length, 2); assert.equal(h.timers(), 2);
  assert.deepEqual(h.deadlines, [30_000, 30_000]);
  await h.album(); assert.equal(h.sent.at(-1), 'getAlbum.view');
  assert.equal(h.deadlines.at(-1), 15_000, 'ordinary interactive requests retain their original deadline');
  h.headers[0](); await tick(); assert.equal(h.sent.filter((x) => x === 'getLyricsBySongId.view').length, 3);
  h.headers[1](); await tick(); assert.equal(h.sent.filter((x) => x === 'getLyricsBySongId.view').length, 4);
  h.headers[2](); h.headers[3](); await Promise.all(work);
});

test('lyrics that waited for a server slot recheck offline policy before opening a connection or arming a deadline', async () => {
  const h = harness(); const active = [h.lyric('a'), h.lyric('b')];
  const queued = Promise.allSettled([h.lyric('c'), h.lyric('d')]);
  await tick(); h.offline(); h.headers[0](); h.headers[1]();
  await Promise.all(active); const results = await queued;
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(h.sent.length, 2); assert.equal(h.timers(), 2);
});
