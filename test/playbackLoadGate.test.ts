import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { PlaybackLoadGate } from '../src/lib/playbackLoadGate';
import { withSpeculativeSlot } from '../src/lib/netBudget';
import { createSlots } from '../src/lib/slots';
import { StreamWarming } from '../src/lib/streamWarming';

const tick = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

test('background work waits without taking slots, while explicit downloads remain independent', async (t) => {
  const gate = new PlaybackLoadGate(); const hold = gate.hold(); t.after(() => gate.release(hold));
  const slots = createSlots(1); const started: string[] = [];
  const mirror = withSpeculativeSlot(() => true, async () => { started.push('mirror'); }, slots, gate);
  await tick();
  await withSpeculativeSlot(() => true, async () => { started.push('user-download'); }, slots);
  assert.deepEqual(started, ['user-download']);
  gate.release(hold); await mirror;
  assert.deepEqual(started, ['user-download', 'mirror']);
});

test('a newer load during slot acquisition returns the permit and waits; obsolete policy issues no request', async (t) => {
  const gate = new PlaybackLoadGate(); const slots = createSlots(1);
  await slots.take(); let wanted = true, requests = 0;
  const work = withSpeculativeSlot(() => wanted, async () => { requests++; }, slots, gate);
  await tick(); const hold = gate.hold(); t.after(() => gate.release(hold));
  slots.release(); await tick();
  await withSpeculativeSlot(() => true, async () => {}, slots);
  assert.equal(requests, 0);
  wanted = false; gate.release(hold); await work;
  assert.equal(requests, 0, 'offline/account cancellation is rechecked after the playback wait');
});

test('only the latest owner or its bounded deadline can release priority', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = new PlaybackLoadGate(120); let opened = 0;
  gate.onOpen(() => opened++);
  const a = gate.hold(); t.mock.timers.tick(100); const b = gate.hold();
  assert.equal(gate.release(a), false); t.mock.timers.tick(21);
  assert.equal(gate.held, true); assert.equal(opened, 0);
  const waiting = gate.wait(); t.mock.timers.tick(100); await waiting;
  assert.equal(gate.held, false); assert.equal(opened, 1); assert.equal(gate.release(b), false);
});

test('returning from source installation cannot release warming or mirror work before native readiness', async (t) => {
  const gate = new PlaybackLoadGate(); const requests: string[] = [];
  const warmer = new StreamWarming({ gate, timeoutMs: 1000, canRequest: () => true,
    request: async (url) => { requests.push(url); } });
  t.after(() => warmer.reset());
  gate.onOpen(() => warmer.enqueue('next', 'next', {}));
  const queue = warmer.beginQueue(), source = warmer.beginSource();
  warmer.releaseSource(source); warmer.release(queue);
  const cover = withSpeculativeSlot(() => true, async () => { requests.push('cover'); }, createSlots(1), gate);
  warmer.enqueue('next', 'next', {}); await tick();
  assert.equal(warmer.held, true); assert.equal(requests.length, 0);
  warmer.sourceReady(source); await cover; await tick();
  assert.equal(warmer.held, false); assert.ok(requests.includes('next')); assert.ok(requests.includes('cover'));
});

test('an old ready/failure and disabled preloading cannot release a newer source priority', async (t) => {
  const gate = new PlaybackLoadGate();
  const warmer = new StreamWarming({ gate, timeoutMs: 1000, canRequest: () => false, request: async () => {} });
  t.after(() => warmer.reset());
  const a = warmer.beginSource(), b = warmer.beginSource();
  assert.equal(warmer.sourceReady(a), false); warmer.releaseSource(a); warmer.invalidate();
  assert.equal(gate.held, true);
  warmer.releaseSource(b); assert.equal(gate.held, true);
  assert.equal(warmer.sourceReady(b), true); assert.equal(gate.held, false);
  const c = warmer.beginSource(); warmer.releaseSource(c); warmer.cancelSourcePriority();
  assert.equal(gate.held, false, 'pause/offline/terminal failure can explicitly give up priority');
});

test('the deadline or explicit pause can release optional work even if native installation never returns', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = new PlaybackLoadGate(120); const requests: string[] = [];
  const warmer = new StreamWarming({ gate, timeoutMs: 1000, canRequest: () => true,
    request: async (url) => { requests.push(url); } });
  t.after(() => warmer.reset());
  gate.onOpen(() => warmer.enqueue('next', 'next', {}));
  warmer.beginQueue(); warmer.beginSource();
  t.mock.timers.tick(121); await tick();
  assert.equal(warmer.held, false); assert.deepEqual(requests, ['next']);
  warmer.beginSource(); warmer.cancelSourcePriority(); await tick();
  assert.equal(warmer.held, false);
});

// Execute the actual status-to-priority adapter against fresh native snapshots.
const source = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
const helper = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'releaseLoadedSpeculation')!;
const executable = ts.transpileModule(`${helper.getText(ast)}\nexports.ready = releaseLoadedSpeculation;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test('only the current song/player/account load with a fresh playable native snapshot opens the gate', () => {
  for (const mismatch of ['buffering', 'old-token', 'old-owner', 'old-player', 'old-song', 'stale-ready', 'error', 'ended', 'none'] as const) {
    const owner = {}, player = { currentStatus: { isLoaded: true, isBuffering: false } };
    const token = {}; let released = 0;
    const context: Record<string, any> = { exports: {}, awaitingSpeculativeSource: { source: token, load: 1, owner, player, songId: 'current' },
      loadToken: 1, activePlayer: () => player, useAuthStore: { getState: () => ({ auth: owner }) },
      currentSong: () => ({ id: 'current' }), usePlayerStore: { getState: () => ({}) },
      streamWarming: { sourceReady(value: object) { assert.equal(value, token); released++; } } };
    const status = { isLoaded: true, isBuffering: false, error: null as string | null, didJustFinish: false };
    if (mismatch === 'buffering') status.isBuffering = true;
    if (mismatch === 'old-token') context.loadToken = 2;
    if (mismatch === 'old-owner') context.useAuthStore.getState = () => ({ auth: {} });
    if (mismatch === 'old-player') context.activePlayer = () => ({});
    if (mismatch === 'old-song') context.currentSong = () => ({ id: 'other' });
    if (mismatch === 'stale-ready') player.currentStatus.isBuffering = true;
    if (mismatch === 'error') status.error = 'failed';
    if (mismatch === 'ended') status.didJustFinish = true;
    runInNewContext(executable, context); context.exports.ready(status);
    assert.equal(released, mismatch === 'none' ? 1 : 0, mismatch);
  }
});

test('only a current native pause releases loading priority; stale events cannot update the store or cancel its new hold', () => {
  const callback = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'onStatus')!;
  const pauseGuard = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'nativePauseIsCurrent')!;
  const compiled = ts.transpileModule(`${pauseGuard.getText(ast)}\n${callback.getText(ast)}\nexports.status = onStatus;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const mode of ['current-pause', 'routine-buffering', 'stale-pause-playing', 'before-install', 'old-load', 'old-owner', 'old-player', 'old-song'] as const) {
    const owner = {}, player = { currentStatus: { playing: false } };
    const waiting = { source: {}, load: 1, owner, player, songId: 'current' };
    let released = 0, cancelledRecovery = 0, continued = false;
    const end = {};
    const context: Record<string, any> = { exports: {}, beat() {}, remoteKind: () => null,
      stoppingFailedPlayback: false, awaitingSpeculativeSource: waiting, loadToken: 1,
      activePlayer: () => player, streamWarming: { held: true },
      useAuthStore: { getState: () => ({ auth: owner }) }, currentSong: () => ({ id: 'current' }),
      usePlayerStore: { getState: () => ({}) },
      cancelSpeculativePriority() { released++; },
      cancelPlaybackRecovery() { cancelledRecovery++; },
      sleepDeadline() { continued = true; throw end; } };
    if (mode === 'stale-pause-playing') player.currentStatus.playing = true;
    if (mode === 'before-install') context.awaitingSpeculativeSource = null;
    if (mode === 'old-load') context.loadToken = 2;
    if (mode === 'old-owner') context.useAuthStore.getState = () => ({ auth: {} });
    if (mode === 'old-player') context.activePlayer = () => ({ currentStatus: { playing: false } });
    if (mode === 'old-song') context.currentSong = () => ({ id: 'other' });
    runInNewContext(compiled, context);
    const processStatus = () => context.exports.status({ playing: false, isLoaded: false, isBuffering: true,
      ...(mode === 'routine-buffering' ? {} : { playWhenReady: false }) });
    const current = mode === 'current-pause';
    if (current || mode === 'routine-buffering') assert.throws(processStatus, (error) => error === end);
    else assert.doesNotThrow(processStatus);
    assert.equal(released, current ? 1 : 0, mode);
    assert.equal(cancelledRecovery, current ? 1 : 0, mode);
    assert.equal(continued, current || mode === 'routine-buffering', `${mode}: stale pause cannot reach store updates`);
  }
});
