import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { dealt, shuffleOn, indexInOriginal } from '../src/lib/queue';
import { weightedShuffle, type ShuffleMode } from '../src/lib/weightedShuffle';
import type { Song } from '../src/api/subsonic';

const source = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
const deal = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'dealPlayerSongs')!.getText(ast);
const actions: Record<string, string> = {};
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && ['playQueue', 'toggleShuffle'].includes(node.name.getText(ast))) actions[node.name.getText(ast)] = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const code = ts.transpileModule(`${deal}\nexports.deal=dealPlayerSongs;exports.play=${actions.playQueue};exports.toggle=${actions.toggleShuffle};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function harness(mode: ShuffleMode) {
  const state: any = { queue: [], index: 0, shuffle: false, originalQueue: null, source: null, sourceHref: null, queuedCount: 0 };
  const policies: ShuffleMode[] = [], local = { one: 100 };
  const noop = () => {};
  const api: Record<string, any> = {};
  const auth = {};
  runInNewContext(code, { exports: api, get: () => state, set: (value: object) => Object.assign(state, value),
    usePlayerStore: { getState: () => state }, useAuthStore: { getState: () => ({ auth, offline: false }) },
    getShuffleMode: () => mode, ownedPlayCounts: () => local, isAudiobookTrack: (song: Song) => song.genre === 'audiobook',
    dealt, shuffleOn, indexInOriginal,
    weightedShuffle: (songs: Song[], policy: ShuffleMode, counts: object) => { assert.equal(counts, local); policies.push(policy); return weightedShuffle(songs, policy, counts, () => .5); },
    remoteKind: () => null, contextKey: () => null, forgetHistoryOf: noop, pushHistory: noop, attachAppState: noop,
    cancelPlaybackRecovery: noop, autoplayFetchedFor: null, autoplayRound: null, artistFill: null,
    streamWarming: { beginQueue: () => ({}), release: () => true, owns: () => true },
    parkLongFormSource: noop, queueOrigin: null, loadIndex: async () => true, warmUpcoming: noop, scheduleSync: noop,
  });
  return { api, state, policies };
}
const songs: Song[] = [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }, { id: 'two', title: 'Second occurrence' }];
test('the actual queue shuffle button deals with the selected preference and retains duplicate occurrences', async () => {
  const h = harness('rareSongs'); assert.equal(await h.api.play(songs, 0, undefined, undefined, { shuffled: true }), true);
  assert.deepEqual(h.policies, ['rareSongs']);
  assert.equal(h.state.queue.length, songs.length); assert.equal(h.state.queue.filter((song: Song) => song.id === 'two').length, 2);
  assert.equal(h.state.shuffle, false, 'list shuffle must not change the persistent shuffle mode');
});
test('shuffle mode keeps the tapped song first and unshuffle restores the original album order', async () => {
  const h = harness('frequentArtists'); h.state.shuffle = true;
  await h.api.play(songs, 1);
  assert.equal(h.state.queue[0], songs[1]); assert.equal(h.state.originalQueue, songs); assert.deepEqual(h.policies, ['frequentArtists']);
  h.api.toggle(); assert.equal(h.state.shuffle, false); assert.equal(h.state.queue, songs);
});
test('ordered books/podcasts bypass music preferences, while a normal toggle invokes the policy', async () => {
  const h = harness('rareArtists'); h.state.shuffle = true;
  await h.api.play(songs, 1, undefined, undefined, { ordered: true });
  assert.equal(h.state.queue, songs); assert.equal(h.state.index, 1); assert.deepEqual(h.policies, []);
  h.api.toggle(); assert.deepEqual(h.policies, ['rareArtists']); assert.equal(h.state.queue[0], songs[1]);
});
test('ordinary random mode and live/book queues retain their existing uniform path', () => {
  const uniform = harness('uniform'); uniform.api.deal(songs); assert.deepEqual(uniform.policies, []);
  for (const fields of [{ podcastChannelId: 'pod' }, { url: 'https://station' }, { genre: 'audiobook' }]) {
    const h = harness('rareSongs'); h.api.deal([{ ...songs[0], ...fields }, songs[1]]); assert.deepEqual(h.policies, []);
  }
});
