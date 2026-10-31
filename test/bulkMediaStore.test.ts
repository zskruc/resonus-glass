import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { MediaCacheStopped, runBulkMediaWorker } from '../src/lib/bulkMediaWorker';
import * as types from '../src/lib/mediaCacheTypes';

const source = ts.transpileModule(readFileSync(new URL('../src/store/bulkMediaCache.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let index = 0; index < 60; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
type Auth = { username: string };
function observable<T extends object>(initial: T) {
  let value = initial;
  const listeners = new Set<(current: T, previous: T) => void>();
  return { getState: () => value,
    subscribe: (listener: (current: T, previous: T) => void) => {
      listeners.add(listener); return () => listeners.delete(listener);
    },
    setState: (next: Partial<T>) => {
      const previous = value; value = { ...value, ...next };
      for (const listener of listeners) listener(value, previous);
    },
  };
}

/** Execute the actual store and worker; only transport, DB and platform events
 * are controlled, so assertions cover ownership across real awaited stages. */
function harness() {
  const auth = observable({ auth: { username: 'A' } as Auth | null, offline: false });
  const settings = observable({ lyricsSource: 'local', downloadWifiOnly: true });
  const network = observable({ connected: true, cellular: false });
  const appListeners = new Set<(state: string) => void>();
  const app = { currentState: 'active', addEventListener: (_event: string, callback: (state: string) => void) => {
    appListeners.add(callback); return { remove: () => appListeners.delete(callback) };
  } };
  const jobs = new Map<string, types.MediaCacheJob>();
  const rows = new Map<string, { task: types.MediaCacheTask; result: types.MediaCacheOutcome | 'pending' }[]>();
  const calls = { page: [] as string[], process: [] as string[], retry: [] as string[], begin: [] as string[] };
  let networkRequest = async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  let readGate: ((profile: string) => Promise<void>) | undefined;
  let beginGate: ((profile: string) => Promise<void>) | undefined;
  let saveGate: ((profile: string) => Promise<void>) | undefined;
  let retryGate: ((profile: string) => Promise<void>) | undefined;
  let pageGate: ((profile: string) => Promise<void>) | undefined;
  const profileRows = (profile: string) => {
    if (!rows.has(profile)) rows.set(profile, []);
    return rows.get(profile)!;
  };
  const db = {
    mediaCacheProfile: (owner: Auth) => owner.username,
    readMediaCacheJob: async (profile: string) => {
      await readGate?.(profile); return plain(jobs.get(profile) ?? types.newMediaCacheJob(['lyrics']));
    },
    saveMediaCacheJob: async (profile: string, job: types.MediaCacheJob) => {
      await saveGate?.(profile); jobs.set(profile, plain(job));
    },
    beginMediaCacheJob: async (profile: string, job: types.MediaCacheJob) => {
      calls.begin.push(profile); await beginGate?.(profile);
      rows.set(profile, []); jobs.set(profile, plain(job));
    },
    addMediaCacheTasks: async (profile: string, tasks: types.MediaCacheTask[]) => {
      const target = profileRows(profile); let added = 0;
      for (const task of tasks) if (!target.some((row) => row.task.id === task.id && row.task.kind === task.kind)) {
        target.push({ task, result: 'pending' }); added++;
      }
      return added;
    },
    nextMediaCacheTask: async (profile: string, selected: types.MediaCacheKind[]) =>
      profileRows(profile).find((row) => row.result === 'pending' && selected.includes(row.task.kind))?.task,
    finishMediaCacheTask: async (profile: string, task: types.MediaCacheTask, outcome: types.MediaCacheOutcome) => {
      profileRows(profile).find((row) => row.task.id === task.id && row.task.kind === task.kind)!.result = outcome;
    },
    retryMediaCacheFailures: async (profile: string) => {
      calls.retry.push(profile); await retryGate?.(profile);
      for (const row of profileRows(profile)) if (row.result === 'failed') row.result = 'pending';
    },
    mediaCacheStats: async (profile: string) => {
      const stats = types.emptyMediaCacheStats();
      for (const row of profileRows(profile)) { stats[row.task.kind].total++; stats[row.task.kind][row.result]++; }
      return stats;
    },
  };
  const dependencies: Record<string, unknown> = {
    zustand: { create: (create: () => object) => observable(create()) },
    'expo-network': { getNetworkStateAsync: () => networkRequest(), NetworkStateType: { CELLULAR: 'CELLULAR' } },
    'react-native': { AppState: app },
    '@/lib/bulkMediaWorker': { ...types, runBulkMediaWorker: (options: Parameters<typeof runBulkMediaWorker>[0]) =>
      runBulkMediaWorker({ ...options, yield: async () => {} }),
      MediaCacheStopped },
    '@/lib/mediaCacheDb': db, '@/lib/mediaCacheTypes': types,
    '@/lib/mediaCacheRuntime': { makeMediaCacheRuntime: (owner: Auth) => ({
      page: async (kind: types.MediaCacheKind, offset: number) => {
        calls.page.push(owner.username); await pageGate?.(owner.username);
        return offset === 0 ? [{ kind, id: owner.username, data: {} }] : [];
      },
      process: async () => { calls.process.push(owner.username); return 'success'; },
    }) },
    './auth': { useAuthStore: auth }, './networkType': { useNetworkType: network }, './settings': { useSettings: settings },
  };
  const exported: Record<string, any> = {};
  runInNewContext(source, { exports: exported, AbortController,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected bulk-store import ${name}`); return dependencies[name]; } });
  return { store: exported.useBulkMediaCache, auth, settings, network, calls, jobs, rows,
    networkRequest: (request: typeof networkRequest) => { networkRequest = request; },
    gateRead: (gate: typeof readGate) => { readGate = gate; }, gateBegin: (gate: typeof beginGate) => { beginGate = gate; },
    gateSave: (gate: typeof saveGate) => { saveGate = gate; },
    gateRetry: (gate: typeof retryGate) => { retryGate = gate; }, gatePage: (gate: typeof pageGate) => { pageGate = gate; },
    appState: (state: string) => { app.currentState = state; for (const listener of appListeners) listener(state); },
  };
}

test('a Start waiting for saved state cannot become permission to scan the newly selected account', async () => {
  const h = harness(), gate = deferred<void>(); h.gateRead((profile) => profile === 'A' ? gate.promise : Promise.resolve());
  const work = h.store.getState().start(['lyrics']); await tick();
  h.auth.setState({ auth: { username: 'B' } }); await h.store.getState().load();
  gate.resolve(); await work;
  assert.deepEqual(h.calls.page, []); assert.equal(h.calls.process.length, 0);
  assert.equal(h.store.getState().status, 'idle');
  await h.store.getState().start(['lyrics']);
  assert.ok(h.calls.process.includes('B'), 'a subsequent explicit B click is still usable');
});

test('Start cannot launch another account after disk preparation, and duplicate taps start one scan', async () => {
  const h = harness(), gate = deferred<void>(); await h.store.getState().load();
  h.gateBegin((profile) => profile === 'A' ? gate.promise : Promise.resolve());
  const first = h.store.getState().start(['lyrics']); await tick();
  await h.store.getState().start(['lyrics']); assert.deepEqual(h.calls.begin, ['A']);
  h.auth.setState({ auth: { username: 'B' } }); await h.store.getState().load();
  gate.resolve(); await first;
  assert.deepEqual(h.calls.page, []); assert.deepEqual(h.calls.process, []);
  assert.equal(h.store.getState().status, 'idle');
});

test('a failed-only Retry awaiting A storage never starts B or overwrites B state', async () => {
  const h = harness(), gate = deferred<void>(); await h.store.getState().load();
  h.gateRetry((profile) => profile === 'A' ? gate.promise : Promise.resolve());
  const work = h.store.getState().retryFailed(); await tick();
  h.auth.setState({ auth: { username: 'B' } }); await h.store.getState().load();
  gate.resolve(); await work;
  assert.deepEqual(h.calls.retry, ['A']); assert.deepEqual(h.calls.page, []);
  assert.equal(h.store.getState().status, 'idle'); assert.equal(h.store.getState().error, null);
});

test('Resume waiting for an interrupted A request cannot auto-start B after it settles', async () => {
  const h = harness(), gate = deferred<void>();
  h.gatePage((profile) => profile === 'A' ? gate.promise : Promise.resolve());
  const first = h.store.getState().start(['lyrics']); await tick();
  assert.deepEqual(h.calls.page, ['A']); h.store.getState().pause();
  const resume = h.store.getState().resume(); await tick();
  h.auth.setState({ auth: { username: 'B' } }); await h.store.getState().load();
  gate.resolve(); await Promise.all([first, resume]);
  assert.deepEqual(h.calls.page, ['A']); assert.deepEqual(h.calls.process, []);
  assert.equal(h.store.getState().status, 'idle');
});

test('Pause and Cancel during network preflight preserve the requested terminal state without fetching pages', async () => {
  for (const action of ['pause', 'cancel'] as const) {
    const h = harness(), gate = deferred<{ type: string; isConnected: boolean; isInternetReachable: boolean }>();
    h.networkRequest(() => gate.promise);
    const work = h.store.getState().start(['lyrics']); await tick(); h.store.getState()[action]();
    gate.resolve({ type: 'WIFI', isConnected: true, isInternetReachable: true }); await work;
    assert.equal(h.store.getState().status, action === 'pause' ? 'paused' : 'cancelled');
    assert.deepEqual(h.calls.page, []); assert.deepEqual(h.calls.process, []);
  }
});

test('preflight checks offline, Wi-Fi-only and background before any library or download request', async () => {
  for (const reason of ['offline', 'wifi', 'background'] as const) {
    const h = harness();
    if (reason === 'offline') h.auth.setState({ offline: true });
    if (reason === 'wifi') h.networkRequest(async () => ({ type: 'CELLULAR', isConnected: true, isInternetReachable: true }));
    if (reason === 'background') h.appState('background');
    await h.store.getState().start(['lyrics']);
    assert.equal(h.store.getState().status, 'paused'); assert.equal(h.store.getState().reason, reason);
    assert.deepEqual(h.calls.page, []); assert.deepEqual(h.calls.process, []);
  }
});

test('an old failed preflight checkpoint cannot overwrite another account while its disk save finishes', async () => {
  const h = harness(), gate = deferred<void>();
  h.networkRequest(async () => { throw new Error('network inspection failed'); });
  h.gateSave((profile) => profile === 'A' ? gate.promise : Promise.resolve());
  const work = h.store.getState().start(['lyrics']); await tick();
  h.auth.setState({ auth: { username: 'B' } }); await h.store.getState().load();
  assert.equal(h.store.getState().status, 'idle');
  gate.resolve(); await work;
  assert.equal(h.store.getState().status, 'idle', 'A must recheck ownership after the failed-preflight DB save');
  assert.equal(h.store.getState().reason, null); assert.deepEqual(h.calls.page, []);
});
