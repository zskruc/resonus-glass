import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { awaitMediaCacheWork, MediaCacheStopped, runBulkMediaWorker } from '../src/lib/bulkMediaWorker';
import * as types from '../src/lib/mediaCacheTypes';
import { sanitizeMediaCacheFailure } from '../src/lib/mediaCacheFailure';

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
  type Interruption = 'pause' | 'cancel' | 'timeout' | 'service-destroyed' | 'start-failed';
  const platform = { OS: 'android' };
  const leases: { id: number; healthy: boolean; released: number; updates: unknown[]; waits: number[];
    current: () => boolean; interrupt: (reason: Interruption) => void; signal?: AbortSignal }[] = [];
  let acquireGate: (() => Promise<void>) | undefined;
  let networkRequest = async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  let readGate: ((profile: string) => Promise<void>) | undefined;
  let beginGate: ((profile: string) => Promise<void>) | undefined;
  let saveGate: ((profile: string) => Promise<void>) | undefined;
  let retryGate: ((profile: string) => Promise<void>) | undefined;
  let pageGate: ((profile: string) => Promise<void>) | undefined;
  let processError: unknown;
  const warnings: unknown[][] = [];
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
    nextMediaCacheLyrics: async (profile: string, limit: number) =>
      profileRows(profile).filter((row) => row.result === 'pending' && row.task.kind === 'lyrics').slice(0, limit).map((row) => row.task),
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
    'react-native': { AppState: app, Platform: platform },
    '@/lib/backgroundWork': { acquireBackgroundWork: async (_owner: string, progress: unknown,
      interrupt: (reason: Interruption) => void, current: () => boolean, signal?: AbortSignal) => {
      const record = { id: leases.length + 1, healthy: platform.OS === 'android', released: 0,
        updates: [plain(progress)], waits: [] as number[], current, interrupt, signal };
      leases.push(record);
      const lease = { active: () => record.healthy && record.released === 0,
        update: (value: unknown) => { record.updates.push(plain(value)); },
        release: async () => { record.released++; },
        wait: async (delay: number) => { record.waits.push(delay); },
      };
      try {
        const pending = acquireGate?.() ?? Promise.resolve();
        await (signal ? awaitMediaCacheWork(pending, signal) : pending);
      }
      catch (error) { await lease.release(); throw error; }
      if (!current()) { await lease.release(); throw new Error('stale background lease'); }
      return lease;
    } },
    '@/lib/bulkMediaWorker': { ...types, runBulkMediaWorker: (options: Parameters<typeof runBulkMediaWorker>[0]) =>
      runBulkMediaWorker({ ...options, yield: options.yield ?? (async () => {}) }),
      MediaCacheStopped, awaitMediaCacheWork },
    '@/lib/mediaCacheDb': db, '@/lib/mediaCacheTypes': types,
    '@/lib/mediaCacheFailure': { sanitizeMediaCacheFailure },
    '@/lib/mediaCacheRuntime': { makeMediaCacheRuntime: (owner: Auth) => ({
      page: async (kind: types.MediaCacheKind, offset: number) => {
        calls.page.push(owner.username); await pageGate?.(owner.username);
        return offset === 0 ? [{ kind, id: owner.username, data: {} }] : [];
      },
      process: async () => { calls.process.push(owner.username); if (processError) throw processError; return 'success'; },
    }) },
    './auth': { useAuthStore: auth }, './networkType': { useNetworkType: network }, './settings': { useSettings: settings },
  };
  const exported: Record<string, any> = {};
  runInNewContext(source, { exports: exported, AbortController, console: { warn: (...args: unknown[]) => { warnings.push(args); } },
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected bulk-store import ${name}`); return dependencies[name]; } });
  return { store: exported.useBulkMediaCache, auth, settings, network, calls, jobs, rows, leases, platform, warnings,
    processFailure: (error: unknown) => { processError = error; },
    gateAcquire: (gate: typeof acquireGate) => { acquireGate = gate; },
    interrupt: (index: number, reason: Interruption) => { const record = leases[index]; record.healthy = false;
      if (record.current()) record.interrupt(reason); },
    networkRequest: (request: typeof networkRequest) => { networkRequest = request; },
    gateRead: (gate: typeof readGate) => { readGate = gate; }, gateBegin: (gate: typeof beginGate) => { beginGate = gate; },
    gateSave: (gate: typeof saveGate) => { saveGate = gate; },
    gateRetry: (gate: typeof retryGate) => { retryGate = gate; }, gatePage: (gate: typeof pageGate) => { pageGate = gate; },
    appState: (state: string) => { app.currentState = state; for (const listener of appListeners) listener(state); },
  };
}

test('the actual store logs only the sanitized task failure and preserves its failed result', async () => {
  const h = harness();
  h.processFailure({ name: 'SubsonicRequestError', network: true, message: 'https://user:password@private.test/token',
    stack: 'SubsonicRequestError: private lyrics\n at work (address at index.android.bundle:1:12345)' });
  await h.store.getState().start(['lyrics']);
  assert.equal(h.warnings.length, 1); assert.equal(h.warnings[0][0], '[media-cache-failure]');
  const body = JSON.parse(h.warnings[0][1] as string);
  assert.deepEqual(body, { kind: 'lyrics', id: 'A', errorChain: [{ name: 'SubsonicRequestError', network: true }],
    locations: [{ line: 1, column: 12345 }] });
  assert.equal(h.store.getState().stats.lyrics.failed, 1);
  assert.equal(h.store.getState().stats.lyrics.missing, 0);
  assert.equal(h.store.getState().status, 'completed');
});

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
  assert.ok(h.calls.page.every((profile) => profile === 'A'), 'responsive cancellation may already allow the explicit A resume, never B');
  assert.deepEqual(h.calls.process, []);
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

test('preflight keeps offline and Wi-Fi policy, while native protection enforces Android background-start restrictions', async () => {
  for (const reason of ['offline', 'wifi', 'background'] as const) {
    const h = harness();
    if (reason === 'offline') h.auth.setState({ offline: true });
    if (reason === 'wifi') h.networkRequest(async () => ({ type: 'CELLULAR', isConnected: true, isInternetReachable: true }));
    if (reason === 'background') {
      h.appState('background');
      h.gateAcquire(async () => { throw new Error('Android refused the background service start'); });
    }
    await h.store.getState().start(['lyrics']);
    assert.equal(h.store.getState().status, 'paused'); assert.equal(h.store.getState().reason, reason);
    assert.deepEqual(h.calls.page, []); assert.deepEqual(h.calls.process, []);
  }
});

test('explicit Start and Continue inspect fresh Wi-Fi before stale disconnected or cellular cache can veto them', async () => {
  for (const action of ['start', 'resume'] as const) for (const stale of ['disconnected', 'cellular'] as const) {
    const h = harness(); let probes = 0;
    const saved = types.newMediaCacheJob(['artistCovers']);
    saved.status = 'paused'; saved.reason = 'offline';
    saved.cursors.artistCovers = { offset: 200, complete: true };
    h.jobs.set('A', saved);
    h.rows.set('A', [
      { task: { kind: 'artistCovers', id: 'existing', data: {} }, result: 'success' },
      { task: { kind: 'artistCovers', id: 'pending', data: {} }, result: 'pending' },
    ]);
    await h.store.getState().load();
    h.network.setState(stale === 'disconnected' ? { connected: false, cellular: false } : { connected: true, cellular: true });
    h.networkRequest(async () => { probes++; return { type: 'WIFI', isConnected: true, isInternetReachable: true }; });
    if (action === 'start') await h.store.getState().start(['lyrics']);
    else await h.store.getState().resume();
    assert.equal(probes, 1, `${action}/${stale} must inspect the actual connection`);
    assert.equal(h.store.getState().status, 'completed');
    assert.equal(h.calls.process.length, 1);
    if (action === 'resume') {
      assert.deepEqual(h.calls.begin, [], 'Continue never resets the persisted task');
      assert.equal(h.rows.get('A')?.length, 2);
      assert.equal(h.rows.get('A')?.[0].result, 'success');
      assert.equal(h.jobs.get('A')?.cursors.artistCovers.offset, 200);
      assert.deepEqual(h.calls.page, [], 'completed discovery cursors remain complete');
    }
  }
});

test('manual offline mode blocks explicit work before network inspection or native protection', async () => {
  for (const action of ['start', 'resume'] as const) {
    const h = harness(); let probes = 0;
    h.auth.setState({ offline: true });
    h.networkRequest(async () => { probes++; return { type: 'WIFI', isConnected: true, isInternetReachable: true }; });
    if (action === 'start') await h.store.getState().start(['lyrics']);
    else await h.store.getState().resume();
    assert.equal(probes, 0); assert.equal(h.leases.length, 0);
    assert.equal(h.store.getState().status, 'paused'); assert.equal(h.store.getState().reason, 'offline');
    assert.deepEqual(h.calls.page, []); assert.deepEqual(h.calls.process, []);
  }
});

test('fresh offline and cellular connections still enforce connection and Wi-Fi-only policy', async () => {
  for (const reason of ['offline', 'wifi'] as const) {
    const h = harness(); let probes = 0;
    h.networkRequest(async () => { probes++; return reason === 'offline'
      ? { type: 'WIFI', isConnected: false, isInternetReachable: false }
      : { type: 'CELLULAR', isConnected: true, isInternetReachable: true }; });
    await h.store.getState().resume();
    assert.equal(probes, 1); assert.equal(h.store.getState().status, 'paused');
    assert.equal(h.store.getState().reason, reason);
    assert.deepEqual(h.calls.page, []); assert.deepEqual(h.calls.process, []);
    assert.equal(h.leases[0].released, 1);
  }
});

test('a network event during inspection is not overwritten by an older Wi-Fi probe result', async () => {
  for (const reason of ['offline', 'wifi'] as const) {
    const h = harness(), probe = deferred<{ type: string; isConnected: boolean; isInternetReachable: boolean }>();
    h.networkRequest(() => probe.promise);
    const work = h.store.getState().resume(); await tick();
    h.network.setState(reason === 'offline' ? { connected: false } : { cellular: true });
    probe.resolve({ type: 'WIFI', isConnected: true, isInternetReachable: true });
    await work;
    assert.equal(h.store.getState().status, 'paused'); assert.equal(h.store.getState().reason, reason);
    assert.deepEqual(h.calls.page, []); assert.deepEqual(h.calls.process, []);
  }
});

test('fresh Wi-Fi remains authoritative over stale store values until a new connection event arrives', async () => {
  const h = harness(), page = deferred<void>();
  h.network.setState({ connected: false, cellular: true });
  h.gatePage(() => page.promise);
  const work = h.store.getState().resume(); await tick();
  assert.equal(h.store.getState().status, 'discovering');
  assert.equal(h.network.getState().connected, true, 'refresh the change-only watcher baseline');
  assert.equal(h.network.getState().cellular, false);
  h.auth.setState({ offline: false });
  h.settings.setState({ downloadWifiOnly: false }); h.settings.setState({ downloadWifiOnly: true });
  assert.equal(h.store.getState().status, 'discovering', 'unrelated subscriptions cannot re-read the stale network snapshot');
  h.network.setState({ connected: false, cellular: false }); await work;
  assert.equal(h.store.getState().status, 'paused'); assert.equal(h.store.getState().reason, 'offline');
  assert.deepEqual(h.calls.process, []);
  page.resolve(); await tick();
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

test('a confirmed native lease permits background discovery, processing and native yielding until completion', async () => {
  const h = harness(), page = deferred<void>();
  h.gatePage(() => page.promise);
  const work = h.store.getState().start(['lyrics']); await tick();
  assert.equal(h.leases.length, 1); assert.deepEqual(h.calls.page, ['A']);
  h.appState('background');
  assert.equal(h.store.getState().status, 'discovering'); assert.equal(h.store.getState().reason, null);
  page.resolve(); await work;
  assert.equal(h.store.getState().status, 'completed'); assert.deepEqual(h.calls.process, ['A']);
  assert.ok(h.leases[0].waits.length > 0, 'worker yields use the protected native clock');
  assert.equal(h.leases[0].released, 1);
  assert.equal((h.leases[0].updates.at(-1) as { completed: number }).completed, 1);
});

test('locking during database preparation or native acquisition does not revoke an explicit Android cache intent', async () => {
  for (const stage of ['database', 'native'] as const) {
    const h = harness(), gate = deferred<void>();
    if (stage === 'database') h.gateBegin(() => gate.promise);
    else h.gateAcquire(() => gate.promise);
    const work = h.store.getState().start(['lyrics']); await tick();
    h.appState('background'); await tick();
    assert.equal(h.store.getState().status, 'discovering');
    assert.deepEqual(h.calls.page, [], 'locking cannot bypass the pending protection confirmation');
    gate.resolve(); await work;
    assert.equal(h.store.getState().status, 'completed');
    assert.deepEqual(h.calls.process, ['A']);
    assert.equal(h.leases.length, 1); assert.equal(h.leases[0].released, 1);
  }
});

test('library requests cannot begin before native acquisition, and pause/cancel release a late lease only once', async () => {
  for (const action of ['pause', 'cancel'] as const) {
    const h = harness(), acquire = deferred<void>(); h.gateAcquire(() => acquire.promise);
    const work = h.store.getState().start(['artistCovers']); await tick();
    assert.equal(h.leases.length, 1); assert.deepEqual(h.calls.page, []);
    h.store.getState()[action](); acquire.resolve(); await work;
    assert.equal(h.store.getState().status, action === 'pause' ? 'paused' : 'cancelled');
    assert.equal(h.store.getState().reason, 'user'); assert.equal(h.store.getState().error, null);
    assert.equal(h.leases[0].released, 1); assert.deepEqual(h.calls.process, []);
    assert.equal(h.leases[0].signal?.aborted, true, 'pending native acquisition receives the run cancellation signal');
  }
});

test('pausing a pending native job returns without waiting for network-constrained promotion', async () => {
  const h = harness(), acquire = deferred<void>(); h.gateAcquire(() => acquire.promise);
  const work = h.store.getState().start(['lyrics']); await tick();
  h.store.getState().pause(); await work;
  assert.equal(h.store.getState().status, 'paused'); assert.equal(h.store.getState().reason, 'user');
  assert.equal(h.leases[0].signal?.aborted, true); assert.equal(h.leases[0].released, 1);
  assert.deepEqual(h.calls.page, []);
  acquire.resolve(); await tick(); assert.deepEqual(h.calls.process, []);
});

test('failed or inactive Android protection pauses visibly instead of running an unprotected worker', async () => {
  for (const inactive of [false, true]) {
    const h = harness();
    h.gateAcquire(async () => {
      if (inactive) h.leases[0].healthy = false;
      else throw new Error('Foreground start was refused');
    });
    await h.store.getState().start(['lyrics']);
    assert.equal(h.store.getState().status, 'paused'); assert.equal(h.store.getState().reason, 'background');
    assert.ok(h.store.getState().error); assert.deepEqual(h.calls.page, []);
    assert.equal(h.leases[0].released, 1);
  }
});

test('native interruption checkpoints and releases promptly even when an old library request never settles', async () => {
  for (const reason of ['pause', 'cancel', 'timeout', 'service-destroyed', 'start-failed'] as const) {
    const h = harness(), page = deferred<void>(); h.gatePage(() => page.promise);
    const work = h.store.getState().start(['lyrics']); await tick();
    h.appState('background'); h.interrupt(0, reason);
    await work;
    assert.equal(h.store.getState().status, reason === 'cancel' ? 'cancelled' : 'paused');
    const user = reason === 'pause' || reason === 'cancel';
    assert.equal(h.store.getState().reason, user ? 'user' : 'background');
    assert.equal(!!h.store.getState().error, !user);
    assert.equal(h.leases[0].released, 1);
    const status = h.store.getState().status;
    page.resolve(); await tick();
    assert.equal(h.store.getState().status, status); assert.deepEqual(h.calls.process, []);
    assert.equal(h.rows.get('A')?.length, 0, 'late discovery cannot add tasks after the owner stopped');
  }
});

test('offline, Wi-Fi-only and profile changes still stop a protected background task', async () => {
  for (const reason of ['offline', 'wifi', 'profile'] as const) {
    const h = harness(), page = deferred<void>(); h.gatePage(() => page.promise);
    const work = h.store.getState().start(['lyrics']); await tick(); h.appState('background');
    if (reason === 'offline') h.auth.setState({ offline: true });
    if (reason === 'wifi') h.network.setState({ cellular: true });
    if (reason === 'profile') h.auth.setState({ auth: { username: 'B' } });
    await work;
    assert.equal(h.jobs.get('A')?.status, 'paused'); assert.equal(h.jobs.get('A')?.reason, reason);
    assert.equal(h.leases[0].released, 1); assert.deepEqual(h.calls.process, []);
    page.resolve(); await tick(); assert.deepEqual(h.calls.process, []);
  }
});

test('resuming or retrying acquires a fresh lease; foreground return alone never resumes a paused task', async () => {
  const h = harness(), page = deferred<void>(); h.gatePage(() => page.promise);
  const first = h.store.getState().start(['lyrics']); await tick(); h.interrupt(0, 'pause'); await first;
  h.appState('background'); h.appState('active'); await tick();
  assert.equal(h.leases.length, 1); assert.equal(h.store.getState().status, 'paused');
  h.gatePage(undefined); await h.store.getState().resume();
  assert.equal(h.leases.length, 2); assert.equal(h.store.getState().status, 'completed');
  const row = h.rows.get('A')![0]; row.result = 'failed';
  await h.store.getState().retryFailed();
  assert.equal(h.leases.length, 3); assert.equal(row.result, 'success');
  assert.ok(h.leases.every((lease) => lease.released === 1));
  page.resolve(); await tick(); assert.equal(h.store.getState().status, 'completed');
});

test('a lease acquired after account replacement cannot update or stop the replacement account task', async () => {
  const h = harness(), acquire = deferred<void>(); h.gateAcquire(() => acquire.promise);
  const first = h.store.getState().start(['lyrics']); await tick();
  h.auth.setState({ auth: { username: 'B' } }); await h.store.getState().load();
  acquire.resolve(); await first;
  assert.equal(h.leases[0].released, 1); assert.equal(h.store.getState().status, 'idle');
  h.gateAcquire(undefined); await h.store.getState().start(['lyrics']);
  assert.equal(h.store.getState().status, 'completed'); assert.deepEqual(h.calls.process, ['B']);
  h.interrupt(0, 'service-destroyed');
  assert.equal(h.store.getState().status, 'completed'); assert.equal(h.leases[1].released, 1);
});

test('non-Android fallback remains foreground-only rather than claiming native background protection', async () => {
  const h = harness(), page = deferred<void>(); h.platform.OS = 'ios'; h.gatePage(() => page.promise);
  const work = h.store.getState().start(['lyrics']); await tick();
  assert.deepEqual(h.calls.page, ['A']); h.appState('background'); await work;
  assert.equal(h.store.getState().status, 'paused'); assert.equal(h.store.getState().reason, 'background');
  assert.equal(h.store.getState().error, null); assert.equal(h.leases[0].released, 1);
  page.resolve(); await tick(); assert.deepEqual(h.calls.process, []);
});
