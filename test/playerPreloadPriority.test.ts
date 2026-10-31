import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { createSlots } from '../src/lib/slots';
import { StreamWarming } from '../src/lib/streamWarming';

const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the real store action and real warming-window function. Only native
// audio, persistence and history are replaced; no imitation playQueue policy.
const sourceText = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('player.ts', sourceText, ts.ScriptTarget.Latest, true);
let action = '', window = '', sourceLoad = '';
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(parsed) === 'playQueue' && ts.isArrowFunction(node.initializer)) action = node.initializer.getText(parsed);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'warmUpcoming') window = node.getText(parsed);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadIndex') sourceLoad = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(action && window && sourceLoad);
const executable = ts.transpileModule(`${window}\n${sourceLoad}\nexports.playQueue = ${action}; exports.warmUpcoming = warmUpcoming; exports.loadIndex = loadIndex;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(enabled = true) {
  const auth = { serverUrl: 'https://example.test' };
  const authState = { auth, offline: false };
  const old = [{ id: 'old' }, { id: 'old-next' }];
  const state: Record<string, any> = { queue: old, index: 0, shuffle: false, repeat: 'off', queuedCount: 0,
    source: null, sourceHref: null, isPlaying: true };
  const loads: { id: string; result: ReturnType<typeof deferred<boolean>> }[] = [];
  const requests: string[] = [];
  const settings = { preloadUpcoming: enabled };
  const warmer = new StreamWarming({ timeoutMs: 120_000, slots: createSlots(4),
    canRequest: (owner, id) => settings.preloadUpcoming && !authState.offline && owner === authState.auth
      && state.queue.slice(state.index + 1, state.index + 6).some((song: { id: string }) => song.id === id),
    request: async (url) => { requests.push(url); } });
  const exported: Record<string, any> = {};
  const noop = () => {};
  const set = (next: Record<string, unknown>) => { Object.assign(state, next); exported.warmUpcoming(); };
  runInNewContext(executable, {
    exports: exported, streamWarming: warmer, bootQuiet: false, PRELOAD_AHEAD: 5,
    remoteKind: () => null, awaitingSpeculativeSource: null,
    useAuthStore: { getState: () => authState }, useSettings: { getState: () => settings },
    useToast: { getState: () => ({ show: noop }) }, useLastPlayed: { getState: () => ({ touch: noop }) },
    usePlayerStore: { getState: () => state },
    localSourceFor: () => undefined, playableOffline: () => true, streamUrl: (_auth: unknown, id: string) => id,
    attachAppState: noop, cancelPlaybackRecovery: noop, pushHistory: noop, forgetHistoryOf: noop,
    contextKey: () => null, dealt: (songs: unknown[]) => songs, tg: (value: string) => value,
    set, get: () => state, autoplayFetchedFor: null, autoplayRound: null, artistFill: null, queueOrigin: null,
    loadIndexSource: () => { const result = deferred<boolean>(); loads.push({ id: state.queue[state.index].id, result }); return result.promise; },
  });
  return { state, authState, settings, old, loads, requests, warmer,
    play: (prefix: string, count = 2) => exported.playQueue(Array.from({ length: count }, (_, index) =>
      ({ id: index === 0 ? prefix : index === 1 ? `${prefix}-next` : `${prefix}-${index}` }))) as Promise<boolean>,
    jump: (index: number) => { set({ index }); return exported.loadIndex(index, true) as Promise<boolean>; } };
}

test('publishing a tapped queue never warms its next song before its own load returns', async (t) => {
  const h = harness(); t.after(() => h.warmer.reset());
  const work = h.play('a'); await tick();
  assert.equal(h.loads[0].id, 'a');
  assert.deepEqual(h.requests, []);
  h.loads[0].result.resolve(true); await work; await tick();
  assert.deepEqual(h.requests, ['a-next']);
});

test('A failure or completion cannot release B hold or roll back B queue', async (t) => {
  for (const firstResult of [false, true]) {
    const h = harness(); t.after(() => h.warmer.reset());
    const a = h.play('a'); const b = h.play('b'); await tick();
    h.loads[0].result.resolve(firstResult); await a; await tick();
    assert.equal(h.state.queue[0].id, 'b');
    assert.equal(h.warmer.held, true);
    assert.deepEqual(h.requests, []);
    h.loads[1].result.resolve(true); await b; await tick();
    assert.equal(h.state.queue[0].id, 'b');
    assert.deepEqual(h.requests, ['b-next']);
  }
});

test('an older A failure after B succeeds cannot restore A or the queue before A', async (t) => {
  const h = harness(); t.after(() => h.warmer.reset());
  const a = h.play('a'); const b = h.play('b');
  h.loads[1].result.resolve(true); await b; await tick();
  h.loads[0].result.resolve(false); await a; await tick();
  assert.equal(h.state.queue[0].id, 'b');
  assert.deepEqual(h.requests, ['b-next']);
});

test('a queue load overtaken by jumpTo keeps the newer source held until it returns', async (t) => {
  for (const firstResult of [false, true]) {
    const h = harness(); t.after(() => h.warmer.reset());
    const a = h.play('a', 3);
    const jump = h.jump(1);
    h.loads[0].result.resolve(firstResult); await a; await tick();
    assert.equal(h.state.queue[0].id, 'a');
    assert.equal(h.state.index, 1);
    assert.equal(h.warmer.held, true);
    assert.deepEqual(h.requests, []);
    h.loads[1].result.resolve(true); await jump; await tick();
    assert.equal(h.warmer.held, false);
    assert.deepEqual(h.requests, ['a-2']);
  }
});

test('a current failed load restores audible playback, while a profile change forbids that rollback', async (t) => {
  for (const changedProfile of [false, true]) {
    const h = harness(); t.after(() => h.warmer.reset());
    const work = h.play('a');
    if (changedProfile) { h.authState.auth = { serverUrl: 'https://other.test' }; h.warmer.invalidate(); }
    h.loads[0].result.resolve(false); await work; await tick();
    assert.equal(h.state.queue[0].id, changedProfile ? 'a' : 'old');
    assert.deepEqual(h.requests, changedProfile ? [] : ['old-next']);
  }
});

test('disabled preloading stays silent, and a thrown native load cannot leave a permanent hold', async (t) => {
  const h = harness(false); t.after(() => h.warmer.reset());
  const work = h.play('a');
  h.loads[0].result.reject(new Error('native failed'));
  await assert.rejects(work, /native failed/);
  assert.equal(h.warmer.held, false);
  const next = h.play('b'); h.loads[1].result.resolve(true); await next; await tick();
  assert.deepEqual(h.requests, []);
});
