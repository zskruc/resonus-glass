import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { SilenceTrimSession } from '../src/lib/silenceTrim';

// Execute the real integration adapter, including its source ownership checks.
const source = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
const names = ['ownsSilenceSession', 'silenceEffectiveEnd', 'silenceTailManaged', 'silenceLoopManaged', 'applySilenceBoundary'];
const code = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''))
  .map((node) => node.getText(ast)).join('\n');
const executable = ts.transpileModule(`${code}\nexports.apply = applySilenceBoundary;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const auth = {}, seeks: number[] = [], fresh = { isLoaded: true, isBuffering: false, playing: true, currentTime: 0, duration: 200 };
  const player = { loop: false, currentStatus: fresh, clearNextSource() { h.cleared++; }, seekTo(sec: number) { seeks.push(sec); } };
  const st = { durationSec: 200, positionSec: 0, queue: [{ id: 'song' }], index: 0 };
  const session = new SilenceTrimSession(); session.begin('bound', true);
  session.accept('bound', { fingerprint: 'file', durationSec: 200, startSec: 2, endSec: 198, complete: true });
  const h: Record<string, any> = { exports: {}, silenceOwner: { load: 4, auth, scope: 'A', player, songId: 'song' },
    loadToken: 4, activePlayer: () => player, useAuthStore: { getState: () => ({ auth }) }, profileScopeId: () => 'A',
    useSilenceTrim: { getState: () => ({ enabled: true }) }, usePlayerStore: { getState: () => st, setState: (patch: object) => Object.assign(st, patch) },
    currentSong: (state: typeof st) => state.queue[state.index], remoteKind: () => null, streamOffsetSec: 0,
    silenceSession: session, pendingSeek: null, fadingOut: null, fadeState: null, queuedNext: {}, cleared: 0, Promise };
  runInNewContext(executable, h);
  return { h, player, st, fresh, session, seeks, apply: () => h.exports.apply(player) };
}

test('all stale source/account/player/route clocks are rejected before a seek', () => {
  for (const mismatch of ['token', 'auth', 'scope', 'player', 'song', 'disabled', 'remote', 'offset', 'pending']) {
    const { h, seeks, apply } = harness();
    if (mismatch === 'token') h.loadToken++;
    if (mismatch === 'auth') h.useAuthStore.getState = () => ({ auth: {} });
    if (mismatch === 'scope') h.profileScopeId = () => 'B';
    if (mismatch === 'player') h.activePlayer = () => ({});
    if (mismatch === 'song') h.currentSong = () => ({ id: 'new' });
    if (mismatch === 'disabled') h.useSilenceTrim.getState = () => ({ enabled: false });
    if (mismatch === 'remote') h.remoteKind = () => 'upnp';
    if (mismatch === 'offset') h.streamOffsetSec = 100;
    if (mismatch === 'pending') h.pendingSeek = { sec: 25 };
    assert.equal(apply(), false, mismatch); assert.deepEqual(seeks, [], mismatch);
  }
});

test('the adapter uses fresh native time rather than an obsolete ready event and preserves absolute lyrics time', () => {
  const { h, player, fresh, st, seeks } = harness();
  fresh.isBuffering = true;
  assert.equal(h.exports.apply(player, { isLoaded: true, playing: true, currentTime: 0 }), false);
  fresh.isBuffering = false;
  assert.equal(h.exports.apply(player, {}), true);
  assert.deepEqual(seeks, [2]); assert.equal(st.positionSec, 2); assert.equal(st.durationSec, 200);
  assert.equal(h.pendingSeek.sec, 2);
});

test('a trimmed tail ends through the ordinary native finish path, clearing gapless and native repeat first', () => {
  const { h, player, st, fresh, session, seeks, apply } = harness();
  session.cancelLeading(); player.loop = true; st.durationSec = 0; fresh.currentTime = 198;
  assert.equal(apply(), true); assert.equal(player.loop, false);
  assert.equal(h.cleared, 1); assert.equal(h.queuedNext, null); assert.deepEqual(seeks, [200]);
  assert.equal(st.positionSec, 200, 'UI duration and absolute clock remain the original file clock');
  assert.equal(st.index, 0, 'adapter does not synthesize a JS queue advance or duplicate ended event');
});

test('manual seek and native finish/error events never trigger an extra edge seek', () => {
  const { h, player, session, seeks, apply } = harness();
  session.manualSeek(); assert.equal(apply(), false); assert.deepEqual(seeks, []);
  assert.equal(h.exports.apply(player, { didJustFinish: true }), false);
  assert.equal(h.exports.apply(player, { error: 'codec' }), false);
});


test('a deferred failed seek cannot clear a newer song’s seek at the same timestamp', async () => {
  const { h, player } = harness(); let reject!: () => void;
  Object.assign(player, { seekTo: () => new Promise<void>((_, fail) => { reject = () => fail(Error('old source')); }) });
  assert.equal(h.exports.apply(player), true);
  h.silenceOwner = { ...h.silenceOwner };
  const nextPending = { sec: 2, at: 100 };
  h.pendingSeek = nextPending; reject(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.pendingSeek, nextPending);
});

test('crossfade can trim the incoming head without consuming its future tail', () => {
  const { h, player, fresh, session } = harness();
  h.fadeState = {}; session.cancelLeading(); fresh.currentTime = 198;
  assert.equal(h.exports.apply(player), false);
  h.fadeState = null;
  assert.equal(h.exports.apply(player), true);
});
