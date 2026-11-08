import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { untilAborted } from '../src/api/deadline';
import { createSlots } from '../src/lib/slots';
import * as lyricWords from '../src/lib/lyricWords';

const source = ts.transpileModule(readFileSync(new URL('../src/api/subsonic.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness(structuredLyrics: unknown[] = []) {
  const sent: string[] = [], headers: (() => void)[] = [];
  let timers = 0, offline = false;
  const deadlines: number[] = [];
  const response = () => ({ ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ 'subsonic-response': { status: 'ok', lyricsList: { structuredLyrics },
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
    '@/lib/lyricWords': lyricWords, '@/lib/navidromeIds': {},
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

test('the production enhanced lyric reader aligns supplied companions by independent clocks, not missing row positions', async () => {
  const h = harness([
    { kind: 'main', synced: true, offset: 100, line: [{ start: 1100, value: 'One' }, { start: 2100, value: 'Two' }, { start: 3100, value: 'Three' }] },
    { kind: 'translation', synced: true, offset: 200, line: [{ start: 1200, value: '一' }, { start: 3200, value: '三' }] },
    { kind: 'pronunciation', synced: true, line: [{ start: 1010, value: 'yi' }, { start: 3000, value: 'san' }] },
  ]);
  const work = h.lyric('song'); await tick(); h.headers[0](); const result = await work;
  assert.deepEqual(Array.from(result.lines, (line: any) => [line.start, line.value, line.translation, line.romanization]), [
    [1000, 'One', '一', 'yi'], [2000, 'Two', undefined, undefined], [3000, 'Three', '三', 'san'],
  ]);
});

test('a long enhanced transcript associates all companions without per-line companion-array scans', async () => {
  const translation = Array.from({ length: 5000 }, (_, index) => ({ start: index * 1000, value: `Translation ${index}` }));
  Object.defineProperty(translation, 'find', { value: () => { throw new Error('quadratic companion scan'); } });
  const h = harness([{ kind: 'main', synced: true, line: translation.map((line) => ({ ...line, value: 'Original' })) },
    { kind: 'translation', synced: true, line: translation }]);
  const work = h.lyric('long'); await tick(); h.headers[0](); const result = await work;
  assert.equal(result.lines.length, 5000); assert.equal(result.lines[4999].translation, 'Translation 4999');
});
