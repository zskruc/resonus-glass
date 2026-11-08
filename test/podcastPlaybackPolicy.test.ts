import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import { DEFAULT_PODCAST_PLAYBACK, podcastOutroReached, podcastPlaybackPreferences, podcastStartPosition } from '../src/lib/podcastPlaybackPolicy';

test('podcast skip defaults preserve existing playback and clamp corrupt settings', () => {
  assert.deepEqual(podcastPlaybackPreferences(null), DEFAULT_PODCAST_PLAYBACK);
  assert.deepEqual(podcastPlaybackPreferences({ introSec: -4, outroSec: Infinity, continuous: false }), { introSec: 0, outroSec: 0, continuous: false });
  assert.equal(podcastPlaybackPreferences({ introSec: 100000 }).introSec, 600);
  assert.equal(podcastOutroReached(95, 100, DEFAULT_PODCAST_PLAYBACK), false);
});
test('intro respects saved progress and never skips a short trailer or unknown-length source', () => {
  const pref = { introSec: 60, outroSec: 30, continuous: true };
  assert.equal(podcastStartPosition(0, 3600, pref), 60);
  assert.equal(podcastStartPosition(150, 3600, pref), 150);
  assert.equal(podcastStartPosition(0, 20, pref), 0);
  assert.equal(podcastStartPosition(0, 0, pref), 0);
  assert.equal(podcastStartPosition(0, Infinity, pref), 0);
  assert.equal(podcastStartPosition(NaN, 3600, pref), 60);
});
test('outro requires a finite known duration and leaves real content between intro and outro', () => {
  const pref = { introSec: 60, outroSec: 30, continuous: false };
  assert.equal(podcastOutroReached(3570, 3600, pref), true);
  assert.equal(podcastOutroReached(3569, 3600, pref), false);
  for (const duration of [0, 89, 90, NaN, Infinity]) assert.equal(podcastOutroReached(75, duration, pref), false);
  assert.equal(podcastOutroReached(3600, 3600, pref), false);
});

const turn = () => new Promise<void>((yes) => setImmediate(yes));
function preferencesHarness() {
  const a = { username: 'A' }, b = { username: 'B' };
  const auth = createStore(() => ({ auth: a, offline: false }));
  const disk = new Map<string, string>(), writes: string[] = [];
  let readFailure = false, writeFailure = false, held: (() => void) | undefined, hold = false;
  let writeHeld: (() => void) | undefined, holdWrite = false;
  const module: Record<string, any> = {};
  const imports = { zustand: { create: createStore }, '@/lib/localLibrary': { hashKey: (s: string) => s },
    '@/lib/storage': { getItem: async (key: string) => {
      if (readFailure) throw Error('Keystore read failed');
      if (hold) { hold = false; await new Promise<void>((resolve) => { held = resolve; }); }
      return disk.get(key) ?? null;
    }, setItemStrict: async (key: string, value: string) => {
      if (writeFailure) throw Error('Storage full');
      if (holdWrite) { holdWrite = false; await new Promise<void>((resolve) => { writeHeld = resolve; }); }
      writes.push(key); disk.set(key, value);
    }, deleteItem: async (key: string) => { disk.delete(key); } },
    '@/lib/podcastPlaybackPolicy': { podcastPlaybackPreferences, DEFAULT_PODCAST_PLAYBACK },
    './auth': { profileScopeId: () => auth.getState().auth.username, useAuthStore: auth },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/podcastPreferences.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: module, require: (id: string) => { assert.ok(Object.hasOwn(imports, id), id); return imports[id as keyof typeof imports]; } });
  return { store: module.usePodcastPreferences, get: module.getPodcastPreferences, clear: module.clearPodcastPreferencesProfile, disk, writes,
    switchTo: (name: 'A' | 'B') => auth.setState({ auth: name === 'A' ? a : b }),
    failRead: () => { readFailure = true; }, failWrite: () => { writeFailure = true; },
    holdRead: () => { hold = true; }, release: () => { held?.(); },
    holdWrite: () => { holdWrite = true; }, releaseWrite: () => { writeHeld?.(); } };
}
test('per-show settings survive a reload and remain separate between profiles', async () => {
  const h = preferencesHarness(), pref = { introSec: 30, outroSec: 45, continuous: false };
  assert.equal(await h.store.getState().save('show', pref), true);
  assert.equal(h.get('show').introSec, 30);
  h.switchTo('B'); await h.store.getState().load(); assert.equal(h.get('show').introSec, 0);
  h.switchTo('A'); await h.store.getState().load(); assert.equal(h.get('show').introSec, 30);
});
test('a suspended old load cannot revive a previous account snapshot after A-B-A', async () => {
  const h = preferencesHarness(); h.holdRead(); const load = h.store.getState().load(); await turn();
  h.switchTo('B'); h.switchTo('A'); h.release(); await load;
  assert.equal(h.store.getState().ready, false);
  assert.equal(h.get('show').introSec, 0);
});
test('queued preference saves abort across account ABA and cannot write the returned account', async () => {
  const h = preferencesHarness(); h.holdRead();
  const save = h.store.getState().save('show', { introSec: 60, outroSec: 0, continuous: true }); await turn();
  h.switchTo('B'); h.switchTo('A'); h.release(); assert.equal(await save, false); assert.equal(h.writes.length, 0);
});
test('storage failures stay visible and cannot replace unread preferences with defaults', async () => {
  const h = preferencesHarness(); h.failRead();
  await assert.rejects(h.store.getState().save('show', DEFAULT_PODCAST_PLAYBACK)); assert.equal(h.writes.length, 0);
  const w = preferencesHarness(); await w.store.getState().load(); w.failWrite();
  await assert.rejects(w.store.getState().save('show', { introSec: 60, outroSec: 0, continuous: true }));
  assert.equal(w.get('show').introSec, 0);
});
test('returning during a durable save reads the accepted write before a later edit', async () => {
  const h = preferencesHarness(); await h.store.getState().load(); h.holdWrite();
  const save = h.store.getState().save('first', { introSec: 30, outroSec: 0, continuous: true }); await turn();
  h.switchTo('B'); h.switchTo('A'); const load = h.store.getState().load();
  h.releaseWrite(); await save; await load;
  assert.equal(h.get('first').introSec, 30);
  await h.store.getState().save('second', DEFAULT_PODCAST_PLAYBACK);
  assert.equal(JSON.parse(h.disk.get('resonus.podcastPreferences.A')!).first.introSec, 30);
});
test('deleting a profile waits for its native write and prevents storage resurrection', async () => {
  const h = preferencesHarness(); await h.store.getState().load(); h.holdWrite();
  const save = h.store.getState().save('first', { introSec: 30, outroSec: 0, continuous: true }); await turn();
  h.switchTo('B'); const clear = h.clear('A'); h.releaseWrite(); await save; await clear;
  assert.equal(h.disk.has('resonus.podcastPreferences.A'), false);
  h.switchTo('A'); await h.store.getState().load(); assert.equal(h.get('first').introSec, 0);
});

test('the actual player outro callback pauses once, marks complete and obeys continuous/sleep/ownership', () => {
  const file = ts.createSourceFile('player.ts', readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'maybeFinishPodcastOutro');
  assert.ok(fn);
  for (const mode of ['continuous', 'stop', 'sleep', 'old-owner'] as const) {
    const song = { id: 'episode', podcastChannelId: 'show' };
    let state = { queue: [song, { id: 'next' }], index: 0, isPlaying: true, repeat: 'off' };
    const calls: string[] = [];
    const exports: Record<string, any> = {};
    const source = `let podcastOutroLoad = -1; ${fn.getText(file)}; exports.finish=maybeFinishPodcastOutro;`;
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, loadToken: 7, currentSong: () => song,
      longFormOwner: { songId: 'episode', scope: mode === 'old-owner' ? 'B' : 'A', version: 1, pendingResume: false },
      profileScopeId: () => 'A', remoteKind: () => false,
      usePlayerStore: { getState: () => state, setState: (patch: any) => { state = { ...state, ...patch }; } },
      getPodcastPreferences: () => ({ introSec: 0, outroSec: 30, continuous: mode !== 'stop' }), podcastOutroReached,
      writePodcastProgress: async (_song: unknown, position: number) => { calls.push(`mark:${position}`); },
      cutCrossfade: () => {}, activePlayer: () => ({ pause: () => calls.push('pause') }),
      handleSleepAtSongEnd: () => mode === 'sleep', nextIndex: () => 1, pushHistory: () => {},
      loadIndex: (index: number) => { calls.push(`load:${index}`); },
    });
    assert.equal(exports.finish(3570, 3600), mode !== 'old-owner');
    assert.equal(exports.finish(3571, 3600), false, 'duplicate native ticks cannot advance twice');
    assert.equal(calls.filter((call) => call.startsWith('mark')).length, mode === 'old-owner' ? 0 : 1);
    assert.equal(calls.includes('load:1'), mode === 'continuous');
  }
});
test('the actual natural-end branch keeps manual music behavior while honoring podcast continuous playback', () => {
  const file = ts.createSourceFile('player.ts', readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const onStatus = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'onStatus') as ts.FunctionDeclaration;
  const branch = onStatus.body!.statements.find((node) => ts.isIfStatement(node) && node.expression.getText(file) === 'status.didJustFinish');
  assert.ok(branch);
  for (const mode of ['music', 'continuous', 'stop', 'repeat', 'sleep'] as const) {
    const state = { isPlaying: true, index: 0, repeat: mode === 'repeat' ? 'one' : 'off' };
    const loaded: number[] = [], exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(`exports.finish=function(){${branch.getText(file)}}`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, status: { didJustFinish: true },
      handleSleepAtSongEnd: () => mode === 'sleep',
      usePlayerStore: { getState: () => state, setState: (patch: any) => Object.assign(state, patch) },
      currentSong: () => ({ podcastChannelId: mode === 'music' ? undefined : 'show' }),
      getPodcastPreferences: () => ({ continuous: mode !== 'stop' && mode !== 'repeat' }),
      loadIndex: (index: number) => { loaded.push(index); }, nextIndex: () => 1, pushHistory: () => {}, clearFinishedAudiobookProgress: () => {},
    });
    exports.finish();
    assert.deepEqual(loaded, mode === 'sleep' || mode === 'stop' ? [] : mode === 'repeat' ? [0] : [1]);
    if (mode === 'stop') assert.equal(state.isPlaying, false);
  }
});
