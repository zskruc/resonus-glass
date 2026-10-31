import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

const h = { profile: 'A', data: new Map<string, string>(), failRead: false, failWrite: false,
  getGate: undefined as undefined | (() => Promise<void>), writeGate: undefined as undefined | (() => Promise<void>) };
Object.assign(globalThis, { __lyricOffsetHarness: h });
const stubs = new Map([
  ['@/lib/localLibrary', 'export const hashKey = value => value'],
  ['@/lib/storage', `export const getItem = async key => {
    const h = globalThis.__lyricOffsetHarness, raw = h.data.get(key) ?? null;
    await h.getGate?.(); if (h.failRead) throw new Error('read failed'); return raw;
  }; export const setItemStrict = async (key, value) => {
    const h = globalThis.__lyricOffsetHarness; await h.writeGate?.();
    if (h.failWrite) throw new Error('write failed'); h.data.set(key, value);
  }`],
]);
const auth = 'export const profileScopeId = () => globalThis.__lyricOffsetHarness.profile';
const hook = registerHooks({ resolve(specifier, context, next) {
  const stub = specifier === './auth' && context.parentURL?.endsWith('/store/lyricOffsets.ts') ? auth : stubs.get(specifier);
  return stub ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true } : next(specifier, context);
} });
const { useLyricOffsets } = await import('@/store/lyricOffsets');
hook.deregister();
const key = (profile: string) => `resonus.lyricOffsets.${profile}`;
function deferred() { let done!: () => void; const promise = new Promise<void>((resolve) => { done = resolve; }); return { promise, done }; }
beforeEach(async () => {
  h.profile = 'A'; h.data.clear(); h.getGate = undefined; h.writeGate = undefined; h.failRead = h.failWrite = false;
  useLyricOffsets.setState({ profile: null, hydrated: false, offsets: {}, error: false, loading: false });
  await useLyricOffsets.getState().hydrate();
});

test('per-account values persist, reset only one song and stale callers cannot retarget writes', async () => {
  const s = useLyricOffsets.getState();
  assert.equal(await s.setOffset('one', 220, 'A'), true);
  assert.equal(await s.setOffset('two', -300, 'A'), true);
  assert.deepEqual(JSON.parse(h.data.get(key('A'))!), { one: 220, two: -300 });
  h.profile = 'B'; await s.hydrate();
  assert.deepEqual(useLyricOffsets.getState().offsets, {});
  assert.equal(await s.setOffset('one', 700, 'A'), false);
  await s.setOffset('one', 900, 'B');
  h.profile = 'A'; await s.hydrate();
  assert.deepEqual(useLyricOffsets.getState().offsets, { one: 220, two: -300 });
  await s.setOffset('one', 0, 'A');
  assert.deepEqual(useLyricOffsets.getState().offsets, { two: -300 });
  assert.deepEqual(JSON.parse(h.data.get(key('B'))!), { one: 900 });
  assert.equal(await s.setOffset('two', NaN, 'A'), false);
});

test('late hydration and a delayed old-screen hydrate cannot replace the current profile', async () => {
  const gate = deferred(); h.getGate = () => gate.promise;
  h.data.set(key('A'), JSON.stringify({ song: 100 }));
  h.data.set(key('B'), JSON.stringify({ song: 500 }));
  useLyricOffsets.setState({ profile: null, hydrated: false });
  const old = useLyricOffsets.getState().hydrate('A');
  await Promise.resolve(); h.profile = 'B'; h.getGate = undefined;
  await useLyricOffsets.getState().hydrate('B'); gate.done(); await old;
  assert.equal(useLyricOffsets.getState().profile, 'B');
  assert.equal(useLyricOffsets.getState().offsets.song, 500);
  await useLyricOffsets.getState().hydrate('A');
  assert.equal(useLyricOffsets.getState().profile, 'B');
});

test('write queue preserves independent song edits and returning hydration waits for the accepted old write', async () => {
  const gate = deferred(); h.writeGate = () => gate.promise;
  const s = useLyricOffsets.getState();
  const first = s.setOffset('one', 100, 'A');
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.profile = 'B'; await s.hydrate();
  h.profile = 'A'; const returning = s.hydrate();
  gate.done(); await first; await returning; h.writeGate = undefined;
  assert.equal(useLyricOffsets.getState().offsets.one, 100);
  await Promise.all([s.setOffset('two', 200, 'A'), s.setOffset('three', 300, 'A')]);
  assert.deepEqual(useLyricOffsets.getState().offsets, { one: 100, two: 200, three: 300 });
});

test('storage failures never become empty records that overwrite saved timing', async () => {
  const s = useLyricOffsets.getState(); await s.setOffset('one', 100, 'A');
  h.failWrite = true;
  assert.equal(await s.setOffset('one', 500, 'A'), false);
  assert.equal(useLyricOffsets.getState().offsets.one, 100);
  assert.equal(JSON.parse(h.data.get(key('A'))!).one, 100);
  h.failWrite = false; h.failRead = true;
  useLyricOffsets.setState({ profile: null, hydrated: false });
  await s.hydrate();
  assert.equal(useLyricOffsets.getState().hydrated, false);
  assert.equal(useLyricOffsets.getState().error, true);
  assert.equal(await s.setOffset('one', 0, 'A'), false);
  assert.equal(JSON.parse(h.data.get(key('A'))!).one, 100);
});
