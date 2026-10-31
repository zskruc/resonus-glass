import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { withSpeculativeSlot } from '../src/lib/netBudget';
import { createSlots } from '../src/lib/slots';
import { PlaybackLoadGate } from '../src/lib/playbackLoadGate';

const tick = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const executable = ts.transpileModule(readFileSync(new URL('../src/lib/mirrorCovers.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Run the actual mirror batch against controlled file/DB/network boundaries.
// Its deduplication, profile state, idle scheduling and policy are unchanged.
function harness() {
  const pool = createSlots(4);
  const playbackGate = new PlaybackLoadGate();
  const state = { offline: false, fail: false, auth: {} };
  const timers: (() => void)[] = [];
  const idle: (() => void)[] = [];
  let delayIdle = false;
  const downloads: string[] = [];
  const registered: { id: string; file: string }[] = [];
  const exported: Record<string, any> = {};
  const dependencies: Record<string, unknown> = {
    'expo-file-system/legacy': {
      documentDirectory: 'file:///mirror-test/',
      readAsStringAsync: async () => { throw new Error('no legacy index'); },
      deleteAsync: async () => {}, makeDirectoryAsync: async () => {},
      getInfoAsync: async () => ({ exists: true, size: 100 }),
      downloadAsync: async (url: string) => {
        downloads.push(url);
        if (state.fail) throw new Error('network failure');
        return { status: 200 };
      },
    },
    '@/api/backend': { COVER: { card: 600 }, coverArtUrl: (_auth: unknown, id: string) => `https://covers.test/${id}` },
    '@/api/netGate': { isOfflineMode: () => state.offline },
    '@/lib/idle': { whenIdle: (callback: () => void) => { if (delayIdle) idle.push(callback); else callback(); } },
    '@/lib/netBudget': { withSpeculativeSlot: (wanted: () => boolean, work: () => Promise<unknown>, _slots: unknown, gate: PlaybackLoadGate) => withSpeculativeSlot(wanted, work, pool, gate) },
    '@/lib/playbackLoadGate': { playbackLoadGate: playbackGate },
    '@/lib/perfLog': { bump: () => {}, netTally: () => {} },
    '@/lib/localLibrary': { hashKey: (id: string) => id, localCoverUrl: () => undefined,
      registerCover: (id: string, file: string) => registered.push({ id, file }) },
    './mirrorDb': { allCovers: async () => [], putCovers: async () => {} },
  };
  runInNewContext(executable, { exports: exported, Date,
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { pool, playbackGate, state, downloads, registered,
    load: (profile: string) => exported.loadMirrorCovers(profile) as Promise<void>,
    keep: (profile: string, id = 'same-cover') => {
      const owner = state.auth;
      exported.keepMirrorCovers(profile, owner, [id], () => state.auth === owner);
    },
    deferIdle: () => { delayIdle = true; },
    flushIdle: async () => { delayIdle = false; for (const callback of idle.splice(0)) callback(); await tick(); },
    run: async () => { for (const callback of timers.splice(0)) callback(); await tick(); },
  };
}

test('mirror downloads waiting for a shared slot stop on offline or a profile replacement', async () => {
  for (const changedProfile of [false, true]) {
    const h = harness(); await h.load('one');
    await Promise.all(Array.from({ length: 4 }, () => h.pool.take()));
    h.keep('one'); await h.run();
    assert.deepEqual(h.downloads, []);
    if (changedProfile) { h.state.auth = {}; await h.load('two'); } else h.state.offline = true;
    for (let i = 0; i < 4; i++) h.pool.release();
    await tick();
    assert.deepEqual(h.downloads, []);
    assert.deepEqual([...h.registered], []);
    h.state.offline = false;
    const currentProfile = changedProfile ? 'two' : 'one';
    h.keep(currentProfile); await h.run();
    assert.equal(h.downloads.length, 1, 'skipped work neither leaks its slot nor strands its in-flight marker');
    assert.equal(h.registered.length, 1);
    assert.ok(h.registered[0].file.includes(`${currentProfile}_same-cover`));
  }
});

test('an old timer or idle callback cannot reload the previous account or stale credentials', async () => {
  for (const stage of ['timer', 'idle'] as const) for (const sameProfile of [false, true]) {
    const h = harness(); await h.load('one');
    if (stage === 'idle') h.deferIdle();
    h.keep('one');
    if (stage === 'idle') await h.run();
    h.state.auth = {};
    if (!sameProfile) await h.load('two');
    if (stage === 'timer') await h.run(); else await h.flushIdle();
    assert.deepEqual(h.downloads, [], `${stage}, sameProfile=${sameProfile}`);
    assert.deepEqual([...h.registered], []);
    const profile = sameProfile ? 'one' : 'two';
    h.keep(profile); await h.run();
    assert.equal(h.downloads.length, 1);
    assert.ok(h.registered[0].file.includes(`${profile}_same-cover`));
  }
});

test('a failed mirror download frees the shared slot and its ID can be retried', async () => {
  const h = harness(); await h.load('one');
  h.state.fail = true; h.keep('one'); await h.run();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.registered.length, 0);
  h.state.fail = false; h.keep('one'); await h.run();
  assert.equal(h.downloads.length, 2);
  assert.equal(h.registered.length, 1);
  const acquired: number[] = [];
  for (let i = 0; i < 4; i++) void h.pool.take().then(() => acquired.push(i));
  await tick();
  assert.equal(acquired.length, 4);
  for (let index = 0; index < acquired.length; index++) h.pool.release();
});

test('automatic mirror covers wait for playable audio and recheck offline after that wait', async (t) => {
  const h = harness(); await h.load('one');
  const hold = h.playbackGate.hold(); t.after(() => h.playbackGate.release(hold));
  h.keep('one'); await h.run();
  assert.equal(h.downloads.length, 0);
  h.state.offline = true; h.playbackGate.release(hold); await tick();
  assert.equal(h.downloads.length, 0);
  h.state.offline = false; h.keep('one'); await h.run();
  assert.equal(h.downloads.length, 1);
});
