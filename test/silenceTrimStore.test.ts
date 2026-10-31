import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

const deferred = () => { let done!: (value: unknown) => void; const promise = new Promise<unknown>((resolve) => { done = resolve; }); return { promise, done }; };
const h = { profile: 'A', auth: {}, failRead: false, gate: undefined as Promise<unknown> | undefined,
  data: new Map<string, string>(), requests: [] as { id: string; uri: string; owner: string; done: (value: unknown) => void }[],
  listeners: new Set<(event: unknown) => void>(), authListeners: [] as (() => void)[], deletedOwners: [] as string[], activated: '', cancelled: 0 };
Object.assign(globalThis, { __silenceStoreHarness: h });
const nativeStub = `const h = globalThis.__silenceStoreHarness;
export const requireOptionalNativeModule = () => ({
 activate(id) { h.activated = id; }, cancel() { h.cancelled++; h.activated = ''; },
 clearCache: async owner => { h.deletedOwners.push(owner); },
 addListener(name, listener) { h.listeners.add(listener); return { remove: () => h.listeners.delete(listener) }; },
 inspect(id, owner, uri) { return new Promise(done => { h.requests.push({ id, owner, uri, done }); }); }
});`;
const authStub = `const h = globalThis.__silenceStoreHarness;
export const profileScopeId = () => h.profile;
export const useAuthStore = { getState: () => ({ auth: h.auth }), subscribe: listener => { h.authListeners.push(listener); } };`;
const stubs = new Map([
  ['expo-modules-core', nativeStub], ['@/lib/localLibrary', 'export const hashKey = value => value'],
  ['@/lib/storage', `const h = globalThis.__silenceStoreHarness;
  export const getItem = async key => { const raw = h.data.get(key) ?? null; await h.gate; if (h.failRead) throw Error('locked'); return raw; };
  export const setItem = async (key, value) => { h.data.set(key, value); };
  export const deleteItem = async key => { h.data.delete(key); };`],
]);
const hook = registerHooks({ resolve(specifier, context, next) {
  const stub = specifier === './auth' && context.parentURL?.endsWith('/store/silenceTrim.ts') ? authStub : stubs.get(specifier);
  return stub ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true } : next(specifier, context);
} });
const { clearSilenceTrimProfile, prefetchSilenceBounds, useSilenceTrim } = await import('@/store/silenceTrim');
hook.deregister();
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const result = { fingerprint: 'f', durationSec: 200, startSec: 2, endSec: 198, complete: true };
const key = (scope: string) => `resonus.silenceTrim.${scope}`;
beforeEach(async () => {
  h.profile = 'A'; h.auth = {}; h.gate = undefined; h.failRead = false; h.data.clear(); h.requests.length = 0; h.deletedOwners.length = 0;
  useSilenceTrim.setState({ hydrated: false }); await useSilenceTrim.getState().hydrate();
  useSilenceTrim.getState().setPreferences({ enabled: true });
});

test('online and cloud files issue no decode or hidden download; only explicit local files are inspected', async () => {
  for (const uri of ['https://server/stream', 'content://cloud/track', undefined]) {
    assert.equal(await useSilenceTrim.getState().inspect(uri, 's', () => assert.fail()), null);
    assert.equal(useSilenceTrim.getState().status, 'not-local');
  }
  assert.equal(h.requests.length, 0);
  const task = useSilenceTrim.getState().inspect('file:///local.flac', 's', () => {});
  assert.equal(h.requests.length, 1); h.requests[0].done(result); await task;
  assert.equal(useSilenceTrim.getState().status, 'ready'); assert.equal(h.listeners.size, 0);
});

test('obsolete head events and final results cannot mutate a newer song or disabled setting', async () => {
  const published: unknown[] = [];
  const first = useSilenceTrim.getState().inspect('file:///one', 'one', (value) => published.push(value));
  const oldListener = [...h.listeners][0]; const old = h.requests[0];
  const second = useSilenceTrim.getState().inspect('file:///two', 'two', (value) => published.push(value));
  oldListener({ ...result, requestId: old.id }); old.done(result); await first;
  assert.equal(published.length, 0); assert.equal(useSilenceTrim.getState().songId, 'two');
  useSilenceTrim.getState().setPreferences({ enabled: false });
  h.requests[1].done(result); await second;
  assert.equal(published.length, 0); assert.equal(useSilenceTrim.getState().bounds, null); assert.equal(h.listeners.size, 0);
});

test('valid partial results remain honest when tail decoding is unsupported', async () => {
  const values: unknown[] = [];
  const task = useSilenceTrim.getState().inspect('file:///alac', 'song', (value) => values.push(value));
  const request = h.requests[0];
  for (const listener of h.listeners) listener({ ...result, requestId: request.id, endSec: 200, complete: false });
  request.done(null); await task;
  assert.equal(useSilenceTrim.getState().status, 'head-only');
  assert.equal(useSilenceTrim.getState().bounds?.complete, false); assert.equal(values.length, 2);
});

test('profile handover discards late reads, analysis and preference writes from the old account', async () => {
  const task = useSilenceTrim.getState().inspect('file:///song', 'song', () => assert.fail());
  const old = h.requests[0]; const gate = deferred(); h.gate = gate.promise;
  useSilenceTrim.setState({ hydrated: false }); const readingA = useSilenceTrim.getState().hydrate();
  h.profile = 'B'; h.auth = {}; h.gate = undefined;
  h.data.set(key('B'), JSON.stringify({ enabled: false, thresholdDb: -40, minimumSilenceMs: 1000, scanSeconds: 6 }));
  for (const listener of h.authListeners) listener(); await tick();
  gate.done(null); old.done(result); await Promise.all([task, readingA]);
  assert.equal(useSilenceTrim.getState().thresholdDb, -40); assert.equal(useSilenceTrim.getState().enabled, false);
  assert.equal(useSilenceTrim.getState().bounds, null);
  useSilenceTrim.getState().setPreferences({ scanSeconds: 3 });
  assert.equal(JSON.parse(h.data.get(key('A'))!).scanSeconds, 12);
  assert.equal(JSON.parse(h.data.get(key('B'))!).scanSeconds, 3);
});

test('a failed storage read cannot overwrite saved preferences with defaults', async () => {
  const saved = h.data.get(key('A')); h.failRead = true;
  useSilenceTrim.setState({ hydrated: false }); await useSilenceTrim.getState().hydrate();
  useSilenceTrim.getState().setPreferences({ thresholdDb: -40 });
  assert.equal(useSilenceTrim.getState().hydrated, false); assert.equal(h.data.get(key('A')), saved);
});

test('optional prefetch respects cancellation/disable and profile deletion removes only its own state', async () => {
  await prefetchSilenceBounds('https://server/song', () => true);
  await prefetchSilenceBounds('file:///next', () => false); assert.equal(h.requests.length, 0);
  const prefetch = prefetchSilenceBounds('file:///next', () => true);
  assert.equal(h.requests.length, 1); useSilenceTrim.getState().cancelInspection();
  assert.equal(h.activated, ''); h.requests[0].done(result); await prefetch;
  h.data.set(key('B'), 'untouched'); await clearSilenceTrimProfile('A');
  assert.equal(h.data.has(key('A')), false); assert.equal(h.data.get(key('B')), 'untouched');
  assert.deepEqual(h.deletedOwners, ['A']);
});
