import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { chapterStopReached } from '../src/lib/localChapters';

function productionFunction(path: string, name: string) {
  const ast = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)!;
  return ts.transpileModule(`${node.getText(ast)}\nexports.run=${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
test('actual chapter completion pauses exactly once and suppresses queued gapless work before state publication', () => {
  const state: any = { queue: [{ id: 'a' }], index: 0, isPlaying: true,
    chapterStop: { songId: 'a', chapterStart: 30, end: 60, title: 'One' } };
  let pauses = 0, scheduled = 0; const module: Record<string, any> = {};
  const context: any = { exports: module, usePlayerStore: { getState: () => state, setState: (value: object) => {
    assert.equal(context.chapterStoppedLoad, 23, 'native gapless is blocked before observers can publish another source'); Object.assign(state, value);
  } }, currentSong: (s: any) => s.queue[s.index], remoteKind: () => null, chapterStopReached,
    chapterStoppedLoad: -1, loadToken: 23, cutCrossfade: () => {}, cancelPlaybackRecovery: () => {}, activePlayer: () => ({ pause: () => { pauses++; } }),
    scheduleNextSource: () => { scheduled++; } };
  runInNewContext(productionFunction('../src/store/player.ts', 'maybeFinishChapterStop'), context);
  assert.equal(module.run(59, false), false); assert.equal(pauses, 0);
  assert.equal(module.run(60, false), true); assert.equal(pauses, 1); assert.equal(state.chapterStop, null); assert.equal(state.isPlaying, false); assert.equal(state.positionSec, 60);
  assert.equal(module.run(61, true), false); assert.equal(pauses, 1); assert.equal(scheduled, 1);
});
test('session re-resolution retains repeated occurrences, remaps gaps, and refuses a missing selected track', () => {
  const module: Record<string, any> = {};
  runInNewContext(productionFunction('../src/lib/listeningSessionPlayback.ts', 'resolveSessionOccurrences'), { exports: module });
  const a = { id: 'a', title: 'A', url: 'https://current-account/current' }, b = { id: 'b', title: 'B' };
  const saved = { songs: [{ id: 'gone' }, { id: 'a' }, { id: 'b' }, { id: 'a' }], index: 3 };
  const value = module.run(saved, new Map([['a', a], ['b', b]]));
  assert.equal(value.index, 2); assert.equal(value.songs.length, 3); assert.equal(value.songs[0], a); assert.equal(value.songs[2], a);
  assert.equal(module.run({ ...saved, index: 0 }, new Map([['a', a]])), undefined);
});
test('the actual onStatus rejects duplicate finish and late playing samples from a chapter-stopped load', () => {
  for (const repeat of ['off', 'one']) {
    const state: any = { queue: [{ id: 'a' }, { id: 'next' }], index: 0, repeat, isPlaying: true,
      chapterStop: { songId: 'a', chapterStart: 0, end: 30, title: 'Chapter' } };
    let paused = 0; const module: Record<string, any> = {};
    const context: any = { exports: module, beat: () => {}, expectedAudioBeatIntervalMs: 500, remoteKind: () => null, chapterStoppedLoad: -1, loadToken: 42,
      usePlayerStore: { getState: () => state, setState: (value: object) => Object.assign(state, value) },
      currentSong: (s: any) => s.queue[s.index], chapterStopReached, cutCrossfade: () => {}, cancelPlaybackRecovery: () => {},
      activePlayer: () => ({ pause: () => { paused++; } }), scheduleNextSource: () => {} };
    runInNewContext(productionFunction('../src/store/player.ts', 'maybeFinishChapterStop').replace('exports.run', 'exports.finish')
      + productionFunction('../src/store/player.ts', 'onStatus').replace('exports.run', 'exports.status'), context);
    assert.equal(module.finish(30, true), true);
    module.status({ didJustFinish: true, playing: false }); module.status({ didJustFinish: true, playing: false });
    module.status({ playing: true });
    assert.equal(state.index, 0); assert.equal(state.isPlaying, false); assert.equal(state.chapterStop, null); assert.equal(paused, 2);
  }
});
test('actual session restore cannot outrun a later pause intent and restores original shuffle order on success', async () => {
  for (const superseded of [false, true]) {
    let resolve!: (value: any) => void;
    const pending = new Promise((done) => { resolve = done; }), plays: any[] = [], seeks: number[] = [];
    const selected = { id: 'b', title: 'B' }, original = [{ id: 'a', title: 'A' }, selected];
    const state: any = { queue: [{ id: 'old', title: 'Old' }], index: 0 };
    const session = { space: 'music', position: 42, shuffle: true, repeat: 'all', speed: 1.25, queueDealt: true };
    const module: Record<string, any> = {};
    const context: any = { exports: module, listeningIntent: 0, resumeSeekGeneration: 0,
      profileScopeId: () => 'A', captureLyricOwner: () => () => true, queueRequestOwner: () => ({}), ownsQueueRequest: () => true,
      useListeningTools: { getState: () => ({ load: async () => {} }) }, currentListeningSource: () => ({ sessions: { music: session } }), remoteKind: () => null,
      prepareListeningSession: () => pending, rememberListeningState: () => {},
      usePlayerStore: { getState: () => state, setState: (value: object) => Object.assign(state, value) } };
    state.playQueue = async (songs: any[], index: number) => { plays.push(songs); context.listeningIntent++; state.queue = songs; state.index = index; return true; };
    state.seekTo = (seconds: number) => { seeks.push(seconds); };
    runInNewContext(productionFunction('../src/store/player.ts', 'resumeListeningSpace'), context);
    const restoring = module.run('music'); await new Promise<void>((done) => setImmediate(done));
    if (superseded) context.listeningIntent++;
    resolve({ songs: [selected, original[0]], index: 0, originalSongs: original });
    assert.equal(await restoring, !superseded);
    if (superseded) { assert.equal(plays.length, 0); assert.equal(seeks.length, 0); }
    else { assert.equal(plays.length, 1); assert.equal(state.originalQueue, original); assert.equal(state.queueDealt, true); assert.deepEqual(seeks, [42]); }
  }
});
