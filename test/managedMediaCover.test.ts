import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { withSpeculativeSlot } from '../src/lib/netBudget';
import { createSlots } from '../src/lib/slots';
import { PlaybackLoadGate } from '../src/lib/playbackLoadGate';

const executable = ts.transpileModule(readFileSync(new URL('../src/lib/mirrorCovers.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = async () => { for (let index = 0; index < 60; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function harness() {
  const pool = createSlots(4), files = new Map<string, number>(), rows = new Map<string, any>();
  const playbackGate = new PlaybackLoadGate();
  const registrations = new Map<string, string>(), downloads: string[] = [], timers: (() => void)[] = [];
  const state = { owner: {}, offline: false, status: 200, mime: 'image/webp', size: 2200, paused: 0 };
  let smallGate: Promise<void> | undefined, fullGate: Promise<void> | undefined;
  const dependencies: Record<string, unknown> = {
    'expo-file-system/legacy': {
      documentDirectory: 'file:///test/', makeDirectoryAsync: async () => {},
      readAsStringAsync: async () => { throw new Error('no legacy index'); },
      getInfoAsync: async (file: string) => files.has(file) ? { exists: true, size: files.get(file) } : { exists: false },
      deleteAsync: async (file: string) => { files.delete(file); },
      moveAsync: async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!); files.delete(from); },
      downloadAsync: async (url: string, file: string) => {
        downloads.push('small:' + url); await smallGate; files.set(file, 600); return { status: 200 };
      },
      createDownloadResumable: (url: string, file: string) => {
        const cancelled = deferred<void>(); let stopped = false;
        return { pauseAsync: async () => { state.paused++; stopped = true; cancelled.resolve(); },
          downloadAsync: async () => {
            downloads.push('full:' + url);
            if (fullGate) await Promise.race([fullGate, cancelled.promise]);
            if (stopped) return undefined;
            files.set(file, state.size);
            return { status: state.status, headers: { 'Content-Type': state.mime } };
          } };
      },
    },
    '@/api/backend': { COVER: { card: 600 }, coverArtUrl: (_auth: unknown, id: string, size: number) => `https://covers.test/${id}?size=${size}` },
    '@/api/netGate': { isOfflineMode: () => state.offline }, '@/lib/idle': { whenIdle: (callback: () => void) => callback() },
    '@/lib/netBudget': { withSpeculativeSlot: (current: () => boolean, work: () => Promise<unknown>) => withSpeculativeSlot(current, work, pool) },
    '@/lib/playbackLoadGate': { playbackLoadGate: playbackGate },
    '@/lib/perfLog': { bump: () => {}, netTally: () => {} },
    '@/lib/localLibrary': { hashKey: (id: string) => id, localCoverUrl: (id: string) => registrations.get(id),
      registerCover: (id: string, file: string) => registrations.set(id, file) },
    './mirrorDb': { allCovers: async () => [...rows.values()], putCovers: async (_base: string, _profile: string, values: any[]) => {
      for (const value of values) rows.set(value.id, value);
    } },
  };
  const exported: Record<string, any> = {};
  runInNewContext(executable, { exports: exported, Date, AbortController,
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  const owner = state.owner;
  const current = () => state.owner === owner;
  return { pool, playbackGate, state, files, rows, registrations, downloads,
    smallGate: (gate: Promise<void>) => { smallGate = gate; }, fullGate: (gate: Promise<void>) => { fullGate = gate; },
    load: () => exported.loadMirrorCovers('one'),
    keep: () => exported.keepMirrorCovers('one', owner, ['cover'], current),
    flush: async () => { for (const callback of timers.splice(0)) callback(); await tick(); },
    full: (signal = new AbortController().signal) => exported.cacheManagedCover('one', owner,
      { from: 'cover', keys: ['cover', 'artist'], size: 1200 }, current, signal) as Promise<{ outcome: string; uri?: string }>,
  };
}

test('a full-size cache upgrade waits for the existing small write and is reused for every display role', async () => {
  const h = harness(), small = deferred<void>(); await h.load(); h.smallGate(small.promise);
  h.keep(); await h.flush();
  const full = h.full(); await tick();
  assert.equal(h.downloads.length, 1, 'the full upgrade cannot race the automatic small write');
  small.resolve(); const result = await full; await tick();
  assert.equal(result.outcome, 'success'); assert.equal(h.downloads.length, 2);
  assert.equal(h.files.get(result.uri!), 2200);
  assert.equal(h.registrations.get('artist'), result.uri);
  assert.equal(h.rows.get('cover').bytes, 2200, 'a late automatic batch cannot overwrite the upgraded size');
  assert.equal(h.rows.get('full-1200|cover').aliasOf, 'cover');
  assert.equal((await h.full()).outcome, 'cached'); assert.equal(h.downloads.length, 2);
  assert.equal([...h.files.keys()].filter((path) => !path.endsWith('.part')).length, 1, 'one durable file serves thumb/card/hero');
});

test('a confirmed missing cover is distinct from HTTP, content and truncated-file failures; the old cover is retained', async () => {
  for (const failure of ['missing', 'http', 'mime', 'short'] as const) {
    const h = harness(); await h.load(); h.keep(); await h.flush();
    const canonical = h.registrations.get('cover')!; assert.equal(h.files.get(canonical), 600);
    if (failure === 'missing') h.state.status = 404;
    if (failure === 'http') h.state.status = 503;
    if (failure === 'mime') h.state.mime = 'application/json';
    if (failure === 'short') h.state.size = 10;
    if (failure === 'missing') assert.equal((await h.full()).outcome, 'missing');
    else await assert.rejects(h.full(), /Cover download failed|Invalid cover/);
    assert.equal(h.files.get(canonical), 600, 'unsuccessful upgrade never deletes the existing usable image');
    assert.equal(h.rows.has('full-1200|cover'), false);
    assert.equal([...h.files.keys()].some((file) => file.endsWith('.part')), false);
  }
});

test('waiting on a shared resource rechecks offline or replaced credentials before sending a cover request', async () => {
  for (const offline of [false, true]) {
    const h = harness(); await h.load();
    await Promise.all(Array.from({ length: 4 }, () => h.pool.take()));
    const work = h.full(); await tick();
    if (offline) h.state.offline = true; else h.state.owner = {};
    for (let index = 0; index < 4; index++) h.pool.release();
    await assert.rejects(work, /stopped/);
    assert.equal(h.downloads.length, 0); assert.equal(h.registrations.size, 0);
  }
});

test('cancelling an active full cover pauses the transfer and releases its slot without indexing a partial file', async () => {
  const h = harness(), gate = deferred<void>(), control = new AbortController();
  await h.load(); h.fullGate(gate.promise);
  const work = h.full(control.signal); await tick(); control.abort();
  await assert.rejects(work, /stopped/); await tick();
  assert.equal(h.state.paused, 1); assert.equal(h.registrations.size, 0); assert.equal(h.files.size, 0);
  const acquired: number[] = [];
  for (let index = 0; index < 4; index++) void h.pool.take().then(() => acquired.push(index));
  await tick(); assert.equal(acquired.length, 4);
  for (let index = 0; index < 4; index++) h.pool.release();
});

test('an automatic cover waiting for playback cannot lock out an explicit full-size cache request', async (t) => {
  const h = harness(); await h.load();
  const hold = h.playbackGate.hold(); t.after(() => h.playbackGate.release(hold));
  h.keep(); await h.flush(); assert.equal(h.downloads.length, 0);
  const result = await h.full();
  assert.equal(result.outcome, 'success');
  assert.equal(h.downloads.length, 1);
  assert.ok(h.downloads[0].startsWith('full:'));
  h.playbackGate.release(hold); await tick();
  assert.equal(h.downloads.length, 1, 'the later automatic pass sees the completed full file');
  assert.equal(h.files.get(result.uri!), 2200);
});
