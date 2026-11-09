import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the actual persistence and user action, with storage/audio as boundaries.
const source = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['savedSpeed', 'saveQueueLocal', 'clearQueueLocal', 'queueSnapshotMatches', 'commitQueuePayload', 'savePositionCheckpoint']);
const variables = new Set(['queueDirty', 'queueContentVersion', 'queueSaveContext', 'queueWriteTails', 'lastPositionCheckpointAt', 'localSavedAt', 'speedIntentGeneration']);
const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? '')
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => variables.has(item.name.getText(ast))))
  .map((node) => node.getText(ast)).join('\n');
let setSpeed = '';
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'setSpeed') setSpeed = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(setSpeed);
const code = ts.transpileModule(`${functions}\n
exports.read=savedSpeed; exports.save=saveQueueLocal; exports.clear=clearQueueLocal; exports.setSpeed=${setSpeed};
exports.intent=()=>speedIntentGeneration;exports.flush=()=>Promise.allSettled([...queueWriteTails.values()]);`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  let scope = 'profile-A';
  const state = { queue: [{ id: 'song' }], index: 0, positionSec: 15, speed: 1,
    shuffle: true, repeat: 'all', source: 'Album', sourceHref: '/album/a', queueDealt: false };
  const writes: { key: string; data: any }[] = [], nativeSpeeds: number[] = [];
  const api: Record<string, any> = {};
  runInNewContext(code, {
    exports: api, Number, Math, Date, AppState: { currentState: 'active' }, rememberListeningState: () => {}, listeningIntent: 0,
    usePlayerStore: { getState: () => state }, get: () => state,
    set: (value: Partial<typeof state>) => Object.assign(state, value),
    profileScopeId: () => scope, queueStorageKey: () => 'legacy-shared-offline-key',
    setItemStrict: async (key: string, value: string) => { writes.push({ key, data: JSON.parse(value) }); },
    captureLyricOwner: () => { const before = scope; return () => scope === before; },
    newPlaybackQueueGeneration: () => 'test-generation',
    playbackCheckpointIdentity: () => undefined, clearPlaybackCheckpoint: async () => {},
    remoteKind: () => null, activePlayer: () => ({}), currentSong: () => state.queue[0],
    applySpeed: () => nativeSpeeds.push(state.speed),
  });
  return { api, state, writes, nativeSpeeds, scope: (next: string) => { scope = next; } };
}

test('a speed change persists immediately with the existing queue and profile ownership', async () => {
  const h = harness(); h.api.setSpeed(1.5); await h.api.flush();
  assert.equal(h.state.speed, 1.5);
  assert.deepEqual(h.nativeSpeeds, [1.5]);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.speed, 1.5);
  assert.equal(h.writes[0].data.speedScope, 'profile-A');
  assert.equal(h.writes[0].data.positionSec, 15);
  assert.equal(h.writes[0].data.shuffle, true);
  assert.equal(h.writes[0].data.repeat, 'all');
});

test('scope guards prevent an old shared offline queue from restoring another account or source speed', async () => {
  const h = harness(); h.api.setSpeed(1.75); await h.api.flush();
  const saved = h.writes[0].data;
  assert.equal(h.api.read(saved), 1.75);
  for (const scope of ['profile-B', 'local-folder-one', 'local-folder-two']) {
    h.scope(scope); assert.equal(h.api.read(saved), 1);
  }
  h.scope('profile-A'); assert.equal(h.api.read(saved), 1.75);
  assert.equal(h.api.read({ speed: 1.75 }), 1);
});

test('legacy/invalid persisted speeds fall back and finite out-of-range values clamp', () => {
  const h = harness();
  for (const speed of [undefined, null, '1.5', NaN, Infinity, -Infinity]) {
    assert.equal(h.api.read({ speed, speedScope: 'profile-A' }), 1);
  }
  assert.equal(h.api.read({ speed: 0.1, speedScope: 'profile-A' }), 0.5);
  assert.equal(h.api.read({ speed: 9, speedScope: 'profile-A' }), 2);
});

test('queue tombstones retain speed and invalid user values never reach audio/storage', async () => {
  const h = harness(); h.api.setSpeed(1.25); await h.api.flush(); h.api.clear(); await h.api.flush();
  assert.deepEqual(h.writes[1].data.queue, []);
  assert.equal(h.api.read(h.writes[1].data), 1.25);
  const before = h.writes.length, intent = h.api.intent();
  for (const value of [NaN, Infinity, -Infinity]) h.api.setSpeed(value);
  assert.equal(h.writes.length, before); assert.equal(h.api.intent(), intent);
  assert.equal(h.state.speed, 1.25);
});
