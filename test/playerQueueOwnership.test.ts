import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';

// Execute production queue actions and sync guards. IO/audio are controlled
// boundaries, so a delayed account A response can be delivered after B opens.
const source = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['queueRequestOwner', 'ownsQueueRequest', 'safeKey', 'queueStorageKey', 'savedSpeed',
  'serverQueueIsSomeoneElses', 'markWeOwnServerQueue', 'markPlayedHere', 'clearPlayedHere', 'syncQueueNow', 'adoptNewerServerQueue']);
const variables = new Set(['loadToken', 'resumeSeekGeneration', 'speedIntentGeneration', 'lastOwnerCheck', 'OWNER_CHECK_TTL', 'playedHere', 'localSavedAt', 'lastAdoptCheck']);
const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? '')
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => variables.has(decl.name.getText(ast))))
  .map((node) => node.getText(ast)).join('\n');
const actions = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && ts.isArrowFunction(node.initializer)
    && ['restoreFromStorage', 'restoreFromServer', 'restoreQueue'].includes(node.name.getText(ast))) actions.set(node.name.getText(ast), node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast); assert.equal(actions.size, 3);
const code = ts.transpileModule(`${declarations}\n${[...actions].map(([key, value]) => `exports.${key}=${value};`).join('\n')}
exports.sync=syncQueueNow; exports.adopt=adoptNewerServerQueue;
exports.cancel=()=>{loadToken++;}; exports.seekIntent=()=>{resumeSeekGeneration++;};
exports.loading=()=>{loadToken++;}; exports.listen=()=>{markPlayedHere();};
exports.speedIntent=()=>{speedIntentGeneration++;};
exports.owner=()=>lastOwnerCheck;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
  const authA = { serverUrl: 'https://A', username: 'user' }, authB = { serverUrl: 'https://B', username: 'user' };
  const authState = { auth: authA, offline: false, offlineSource: null };
  const store = createStore<any>(() => ({ queue: [], index: 0, positionSec: 0, isPlaying: false }));
  const disk = deferred<string | null>(), serverReads: ReturnType<typeof deferred<any>>[] = [], loads: string[] = [], seeks: number[] = [], saves: any[][] = [], timers: (() => void)[] = [];
  let loadWait: Promise<boolean> | undefined;
  const api: Record<string, any> = {}, noop = () => {};
  const state = () => store.getState();
  const host: Record<string, any> = { exports: api, useAuthStore: { getState: () => authState }, usePlayerStore: store,
    get: state, set: store.setState, getItem: () => disk.promise, primaryUrl: (auth: typeof authA) => auth.serverUrl,
    profileScopeId: () => authState.auth.serverUrl, attachAppState: noop, clearPlayedHere: noop, queueOrigin: null,
    isRepeatMode: () => true, seekActive: (position: number) => seeks.push(position),
    loadIndex: async (index: number) => { api.loading(); loads.push(state().queue[index].id); return loadWait ? await loadWait : true; },
    startBootQuiet: noop, timed: (_name: string, work: () => unknown) => work(), setTimeout: (work: () => void) => timers.push(work),
    getPlayQueue: () => { const read = deferred<any>(); serverReads.push(read); return read.promise; },
    savePlayQueue: async (...args: any[]) => { saves.push(args); }, saveQueueLocal: noop,
    remoteKind: () => null, CLIENT_NAME: 'Glass', useSettings: { getState: () => ({ syncQueueFromServer: true }) } };
  runInNewContext(code, host);
  store.setState(Object.fromEntries(actions.keys().map((key) => [key, api[key]])));
  return { api, store, disk, serverReads, loads, seeks, saves, timers, authState, authA, authB,
    waitLoad: (promise: Promise<boolean>) => { loadWait = promise; },
    profileB: () => { authState.auth = authB; api.cancel(); store.setState({ queue: [], index: 0, positionSec: 0 }); } };
}
const saved = { queue: [{ id: 'old-A', duration: 100 }], index: 0, positionSec: 45, savedAt: 10 };

test('late disk reads cannot install another account queue or a superseded same-account intent', async () => {
  for (const changed of ['profile', 'queue', 'reset']) {
    const h = harness(); const work = h.api.restoreFromStorage();
    if (changed === 'profile') h.profileB();
    else if (changed === 'queue') h.store.setState({ queue: [{ id: 'new-A' }], positionSec: 12 });
    else h.api.cancel();
    h.disk.resolve(JSON.stringify(saved)); await work;
    assert.equal(h.loads.length, 0, changed); assert.equal(h.seeks.length, 0, changed);
    assert.equal(h.store.getState().queue[0]?.id, changed === 'queue' ? 'new-A' : undefined);
  }
});
test('late server replacements cannot beat an account change or a newer queue', async () => {
  for (const changed of ['profile', 'queue']) {
    const h = harness(); h.store.setState({ queue: [{ id: 'before' }] });
    const work = h.api.restoreFromServer(true);
    if (changed === 'profile') h.profileB(); else h.store.setState({ queue: [{ id: 'newer' }] });
    h.serverReads[0].resolve({ entries: saved.queue, position: 45_000 }); await work;
    assert.deepEqual(h.loads, []); assert.deepEqual(h.seeks, []);
    assert.equal(h.store.getState().queue[0]?.id, changed === 'queue' ? 'newer' : undefined);
  }
});
test('a normal disk/server restore still installs and restores its own position', async () => {
  for (const origin of ['disk', 'server']) {
    const h = harness(); const work = origin === 'disk' ? h.api.restoreFromStorage() : h.api.restoreFromServer();
    if (origin === 'disk') h.disk.resolve(JSON.stringify(saved)); else h.serverReads[0].resolve({ entries: saved.queue, position: 45_000 });
    assert.equal(await work, true); assert.deepEqual(h.loads, ['old-A']); assert.deepEqual(h.seeks, [45]);
    assert.equal(h.store.getState().positionSec, 45);
  }
});
test('restore completion cannot seek over a newer manual seek or native source intent', async () => {
  for (const changed of ['seek', 'load', 'profile']) {
    const h = harness(), native = deferred<boolean>(); h.waitLoad(native.promise);
    const work = h.api.restoreFromStorage(); h.disk.resolve(JSON.stringify(saved)); await tick();
    if (changed === 'seek') { h.api.seekIntent(); h.store.setState({ positionSec: 15 }); }
    else if (changed === 'load') { h.api.loading(); h.store.setState({ positionSec: 20 }); }
    else h.profileB();
    native.resolve(true); await work; assert.deepEqual(h.seeks, [], changed);
    assert.equal(h.store.getState().positionSec, changed === 'seek' ? 15 : changed === 'load' ? 20 : 0);
  }
});
test('paused server saves reject superseded profile/queue/seek ownership', async () => {
  for (const changed of ['profile', 'queue', 'seek', 'none']) {
    const h = harness(); h.store.setState({ queue: [{ id: 'old-A' }], positionSec: 45 }); h.api.listen(); h.api.sync();
    if (changed === 'profile') h.profileB();
    else if (changed === 'queue') h.store.setState({ queue: [{ id: 'new-A' }], positionSec: 0 });
    else if (changed === 'seek') { h.api.seekIntent(); h.store.setState({ positionSec: 15 }); }
    h.serverReads[0].resolve(null); await tick();
    assert.equal(h.saves.length, changed === 'none' ? 1 : 0, changed);
    if (changed === 'none') assert.equal(h.saves[0][3], 45_000);
  }
});
test('an old owner-check reply cannot poison the next account cached queue owner', async () => {
  const h = harness(); h.store.setState({ queue: [{ id: 'old-A' }] }); h.api.listen(); h.api.sync();
  h.profileB(); h.store.setState({ queue: [{ id: 'B' }] }); h.api.listen(); h.api.sync();
  h.serverReads[1].resolve({ entries: [{ id: 'remote-B' }], changedBy: 'Other player' }); await tick();
  h.serverReads[0].resolve(null); await tick();
  assert.equal(h.api.owner().owner, h.authB); assert.equal(h.api.owner().theirs, true); assert.deepEqual(h.saves, []);
});
test('an overtaken disk miss cannot cause the old restore chain to fetch the new account', async () => {
  const h = harness(); const work = h.api.restoreQueue(); h.profileB(); h.disk.resolve(null); await work;
  assert.equal(h.serverReads.length, 0); assert.deepEqual(h.loads, []); assert.equal(h.timers.length, 0);
});
test('only its completed disk restore schedules adoption and the timer cannot follow another queue', async () => {
  const h = harness(); const work = h.api.restoreQueue(); h.disk.resolve(JSON.stringify(saved)); await work;
  assert.equal(h.timers.length, 1);
  h.store.setState({ queue: [{ id: 'newer' }] }); h.timers[0](); await tick();
  assert.equal(h.serverReads.length, 0);
});

test('disk restores include speed for both a populated queue and an empty tombstone', async () => {
  for (const queue of [saved.queue, []]) {
    const h = harness(), work = h.api.restoreFromStorage();
    h.disk.resolve(JSON.stringify({ ...saved, queue, speed: 1.5, speedScope: h.authA.serverUrl }));
    await work;
    assert.equal(h.store.getState().speed, 1.5);
  }
});

test('a pending disk restore keeps newer manual speed including ABA without losing the saved position', async () => {
  for (const values of [[1.75], [1.75, 1]]) {
    const h = harness(); h.store.setState({ speed: 1 });
    const work = h.api.restoreFromStorage();
    for (const speed of values) { h.api.speedIntent(); h.store.setState({ speed }); }
    h.disk.resolve(JSON.stringify({ ...saved, speed: 0.75, speedScope: h.authA.serverUrl }));
    await work;
    assert.equal(h.store.getState().speed, values.at(-1));
    assert.deepEqual(h.loads, ['old-A']);
    assert.deepEqual(h.seeks, [45]);
  }
});

test('server restoration preserves the chosen local speed', async () => {
  const h = harness(); h.store.setState({ speed: 1.75 });
  const work = h.api.restoreFromServer();
  h.serverReads[0].resolve({ entries: saved.queue, position: 45_000 }); await work;
  assert.equal(h.store.getState().speed, 1.75);
  assert.deepEqual(h.loads, ['old-A']);
});

test('a delayed server adoption preserves a new manual speed choice', async () => {
  const h = harness();
  const restore = h.api.restoreFromStorage(); h.disk.resolve(JSON.stringify(saved)); await restore;
  const work = h.api.adopt();
  h.api.speedIntent(); h.store.setState({ speed: 1.5 });
  h.serverReads[0].resolve({ entries: [{ id: 'remote' }], changed: 20, changedBy: 'Other player' });
  await tick();
  assert.equal(h.serverReads.length, 2);
  h.serverReads[1].resolve({ entries: [{ id: 'remote' }], position: 0 });
  await work;
  assert.equal(h.store.getState().queue[0].id, 'remote');
  assert.equal(h.store.getState().speed, 1.5);
});

test('a speed change during native queue loading keeps the restored position too', async () => {
  const h = harness(), native = deferred<boolean>(); h.waitLoad(native.promise);
  const work = h.api.restoreFromStorage();
  h.disk.resolve(JSON.stringify({ ...saved, speed: 0.75, speedScope: h.authA.serverUrl })); await tick();
  h.api.speedIntent(); h.store.setState({ speed: 1.75 });
  native.resolve(true); await work;
  assert.equal(h.store.getState().speed, 1.75);
  assert.deepEqual(h.seeks, [45]);
});
