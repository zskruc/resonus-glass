import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';

const source = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
const functions = new Set(['safeKey', 'queueStorageKey', 'queueRequestOwner', 'ownsQueueRequest', 'savedSpeed', 'isRepeatMode',
  'queueSnapshotMatches', 'commitQueuePayload', 'savePositionCheckpoint', 'saveQueueLocal', 'clearQueueLocal']);
const variables = new Set(['queueDirty', 'queueContentVersion', 'queueSaveContext', 'queueWriteTails', 'lastPositionCheckpointAt',
  'localSavedAt', 'loadToken', 'resumeSeekGeneration', 'speedIntentGeneration']);
const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && functions.has(node.name?.text ?? '')
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => variables.has(item.name.getText(ast))))
  .map((node) => node.getText(ast)).join('\n');
let restore = '', dirty = '';
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'restoreFromStorage') restore = node.initializer.getText(ast);
  if (ts.isIfStatement(node) && node.thenStatement.getText(ast).includes('queueDirty = true;')
    && node.thenStatement.getText(ast).includes('queueContentVersion++')) dirty = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(restore && dirty);
const executable = ts.transpileModule(`${declarations}\nexports.save=saveQueueLocal;exports.clear=clearQueueLocal;
exports.restore=${restore};exports.observe=(st,prev)=>{${dirty}};
exports.current=()=>queueSaveContext?.current();exports.savedAt=()=>localSavedAt;
exports.cancel=()=>{loadToken++;};exports.seekIntent=()=>{resumeSeekGeneration++;};
exports.flush=async()=>{await Promise.allSettled([...queueWriteTails.values()]);};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function tick() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function harness() {
  const a = { serverUrl: 'https://A', username: 'user' }, b = { serverUrl: 'https://B', username: 'user' };
  const auth = createStore<any>(() => ({ auth: a, offline: false, offlineSource: null }));
  const state = createStore<any>(() => ({ queue: [{ id: 'one', duration: 100 }, { id: 'two', duration: 100 }], index: 0,
    positionSec: 10, speed: 1, shuffle: false, repeat: 'off', source: 'Album', sourceHref: '/album/a', queueDealt: false }));
  let now = 1_000_000, hold: Promise<unknown> | undefined, fail = false, checkpointRead: Promise<any> | undefined;
  const app = { currentState: 'background' }, disk = new Map<string, string>();
  const writes: any[] = [], checkpoints: any[] = [], positions = new Map<string, any>(), loads: string[] = [], seeks: number[] = [];
  const api: any = {}, noop = () => {}, profileScopeId = () => auth.getState().auth.serverUrl;
  const authModule = { useAuthStore: auth, profileScopeId };
  function load(path: string, imports: Record<string, any>) {
    const exports: any = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, Date: { now: () => now }, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
    return exports;
  }
  const owner = load('src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const identity = load('src/lib/playbackCheckpoint.ts', { 'expo-crypto': {}, 'expo-file-system/legacy': { documentDirectory: 'file:///test/' }, './lyricOwner': owner });
  const host: any = { exports: api, Date: { now: () => now }, AppState: app, usePlayerStore: state, useAuthStore: auth,
    get: state.getState, set: state.setState, profileScopeId, primaryUrl: (value: any) => value.serverUrl,
    captureLyricOwner: owner.captureLyricOwner, rememberListeningState: noop,
    playbackCheckpointIdentity: identity.playbackCheckpointIdentity, newPlaybackQueueGeneration: identity.newPlaybackQueueGeneration,
    setItemStrict: async (key: string, value: string) => {
      writes.push({ key, data: JSON.parse(value) }); const pending = hold; hold = undefined;
      if (pending) await pending; if (fail) throw new Error('KeyStore unavailable'); disk.set(key, value);
    },
    getItem: async (key: string) => disk.get(key) ?? null,
    writePlaybackCheckpoint: async (profile: string, key: string, target: any, positionSec: number, options: any) => {
      if (!options.current()) return false;
      const row = { profile, key, identity: { ...target }, positionSec, savedAt: now }; checkpoints.push(row);
      positions.set(profile + key, row); return true;
    },
    readPlaybackCheckpoint: async (profile: string, key: string, target: any) => {
      if (checkpointRead) return checkpointRead;
      const row = positions.get(profile + key);
      return target && row && JSON.stringify(row.identity) === JSON.stringify(target) ? row : undefined;
    },
    clearPlaybackCheckpoint: async (profile: string, key: string) => { positions.delete(profile + key); },
    attachAppState: noop, queueOrigin: '',
    loadIndex: async (index: number) => { api.cancel(); loads.push(state.getState().queue[index].id); return true; },
    seekActive: (position: number) => seeks.push(position),
  };
  runInNewContext(executable, host); state.subscribe(api.observe);
  return { api, state, auth, a, b, app, disk, writes, checkpoints, positions, loads, seeks,
    advance(ms: number) { now += ms; }, hold(promise: Promise<unknown>) { hold = promise; },
    fail(value: boolean) { fail = value; }, checkpointRead(value: Promise<any>) { checkpointRead = value; },
    async flush() { await api.flush(); await tick(); },
  };
}

test('actual periodic queue saves use tiny checkpoints in background and foreground, never re-encrypt unchanged songs', async () => {
  const h = harness(); h.api.save(); await h.flush(); assert.equal(h.writes.length, 1);
  for (let i = 0; i < 3; i++) {
    h.advance(120_000); h.state.setState({ positionSec: 20 + i }); h.api.save(); await h.flush();
  }
  assert.equal(h.writes.length, 1); assert.equal(h.checkpoints.length, 3);
  h.app.currentState = 'active'; h.advance(20_000); h.state.setState({ positionSec: 40 }); h.api.save(); await h.flush();
  assert.equal(h.checkpoints.at(-1).positionSec, 40); assert.equal(h.writes.length, 1);
  h.state.setState({ positionSec: 45 }); h.api.save(true); await h.flush();
  assert.equal(h.checkpoints.at(-1).positionSec, 45); assert.equal(h.writes.length, 1);
  h.state.setState({ speed: 1.5 }); h.api.save(true); await h.flush();
  assert.equal(h.writes.length, 2); assert.equal(h.writes[1].data.speed, 1.5);
});

test('a long queue saves the actual selected occurrence inside500 entries and restores its checkpoint after a cold read', async () => {
  const h = harness(); h.state.setState({ queue: Array.from({ length: 1000 }, (_, i) => ({ id: 'song-' + i, duration: 500 })), index: 750, positionSec: 12 });
  h.api.save(true); await h.flush(); const saved = h.writes[0].data;
  assert.equal(saved.queue.length, 500); assert.equal(saved.index, 250); assert.equal(saved.queue[saved.index].id, 'song-750');
  h.advance(120_000); h.state.setState({ positionSec: 77 }); h.api.save(); await h.flush();
  assert.equal(h.checkpoints[0].identity.index, 250); assert.equal(h.checkpoints[0].identity.songId, 'song-750');
  h.state.setState({ queue: [], index: 0, positionSec: 0 }); assert.equal(await h.api.restore(), true);
  assert.deepEqual(h.loads, ['song-750']); assert.deepEqual(h.seeks, [77]); assert.equal(h.state.getState().positionSec, 77);
});

test('queued full writes serialize, account ABA revokes ownership, and old completions cannot create a checkpoint', async () => {
  const h = harness(), pending = deferred<void>(); h.hold(pending.promise); h.api.save(true); await tick();
  h.auth.setState({ auth: h.b }); h.auth.setState({ auth: h.a }); assert.equal(h.api.current(), false);
  h.state.setState({ queue: [{ id: 'new' }], index: 0, positionSec: 30 }); h.api.save(true);
  pending.resolve(); await h.flush();
  const actual = JSON.parse([...h.disk.values()][0]); assert.equal(actual.queue[0].id, 'new');
  assert.equal(h.checkpoints.length, 0); h.api.save(true); await h.flush(); assert.equal(h.checkpoints[0].identity.songId, 'new');
});

test('a failed full write retries the full metadata before accepting any position-only write', async () => {
  const h = harness(); h.fail(true); h.api.save(true); await h.flush(); assert.equal(h.disk.size, 0);
  h.state.setState({ positionSec: 25 }); h.fail(false); h.api.save(true); await h.flush();
  assert.equal(h.writes.length, 2); assert.equal(h.checkpoints.length, 0);
  h.api.save(true); await h.flush(); assert.equal(h.checkpoints.length, 1);
});

test('clearing writes a tombstone and removes the old checkpoint rather than reviving a completed queue', async () => {
  const h = harness(); h.api.save(true); await h.flush(); h.api.save(true); await h.flush(); assert.equal(h.positions.size, 1);
  h.state.setState({ queue: [], index: 0, positionSec: 0 }); h.api.clear(); await h.flush();
  assert.equal(h.positions.size, 0); assert.deepEqual(h.writes.at(-1).data.queue, []);
  assert.equal(await h.api.restore(), true); assert.equal(h.loads.length, 0);
});

test('a sidecar read cannot seek over a new manual queue or reset while disk IO was pending', async () => {
  const h = harness(); h.api.save(true); await h.flush(); h.state.setState({ queue: [], index: 0 });
  const pending = deferred<any>(); h.checkpointRead(pending.promise); const restore = h.api.restore(); await tick();
  h.state.setState({ queue: [{ id: 'user-choice' }], positionSec: 11 }); h.api.cancel();
  pending.resolve({ positionSec: 90, savedAt: 2_000_000 }); await restore;
  assert.equal(h.loads.length, 0); assert.equal(h.seeks.length, 0); assert.equal(h.state.getState().queue[0].id, 'user-choice');
});
