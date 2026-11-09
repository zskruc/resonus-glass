import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import { profileScopeGuard } from '../src/lib/profileScope';

function harness(initial: Record<string, number> = {}) {
  let profile = 'A', epoch = 0, clock = 0, readFault = false, writeFault = false;
  let readGate: (() => Promise<void>) | undefined, writeGate: (() => Promise<void>) | undefined;
  const disk = new Map<string, string>([['resonus.pins.A', JSON.stringify(initial)]]), writes: { key: string; value: string }[] = [];
  const timers = new Map<number, () => void>();
  const storage = { getItem: async (key: string) => {
    if (readFault) throw new Error('Read unavailable');
    if (readGate) { const pause = readGate; readGate = undefined; await pause(); }
    return disk.get(key) ?? null;
  }, setItemStrict: async (key: string, value: string) => {
    if (writeFault) throw new Error('Write unavailable');
    if (writeGate) { const pause = writeGate; writeGate = undefined; await pause(); }
    writes.push({ key, value }); disk.set(key, value);
  }, deleteItem: async (key: string) => { disk.delete(key); } };
  const exports: Record<string, any> = {};
  const dependencies: Record<string, unknown> = { zustand: { create: createStore }, '@/lib/localLibrary': { hashKey: (value: string) => value },
    '@/lib/navidromeRemap': { remapPinKey: (value: string) => value }, '@/lib/profileScope': { profileScopeGuard }, '@/lib/storage': storage,
    '@/store/auth': { profileScopeId: () => profile } };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/pins.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, setTimeout: (callback: () => void) => { const id = ++clock; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => { timers.delete(id); }, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { api: exports, store: exports.usePins, disk, writes,
    switch(next: string) { profile = next; epoch++; },
    owner() { const at = epoch, name = profile; return () => at === epoch && name === profile; },
    fault(read: boolean, write: boolean) { readFault = read; writeFault = write; },
    gateRead(pause: () => Promise<void>) { readGate = pause; }, gateWrite(pause: () => Promise<void>) { writeGate = pause; },
    timer() { assert.ok(timers.size); return [...timers.values()].at(-1)!; },
    fireTimers() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); },
    saved(key = 'resonus.pins.A') { const raw = disk.get(key); return raw === undefined ? undefined : JSON.parse(raw); } };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('the actual pins store preserves all fifty existing pins and their order before importing any new ones', async () => {
  const existing = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`album:existing-${i}`, i + 1]));
  const incoming = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`playlist:incoming-${i}`, i + 101]));
  const h = harness(existing); await h.store.getState().hydrate();
  await h.api.importPins('A', { ...incoming, 'album:existing-0': 9999 }, h.owner());
  assert.deepEqual(h.saved(), existing); assert.deepEqual(plain(h.store.getState().pins), existing);
  assert.deepEqual(plain(await h.api.exportPins('A')), existing); assert.equal(h.writes.length, 1);
});

test('a pre-import debounce and an already-started old write cannot overwrite the actual merged result', async () => {
  const h = harness({ 'album:old': 1 }); await h.store.getState().hydrate();
  assert.equal(h.store.getState().toggle('playlist:manual'), true); const oldTimer = h.timer();
  let release!: () => void, entered = false; const waiting = new Promise<void>((resolve) => { release = resolve; });
  h.gateWrite(async () => { entered = true; await waiting; }); h.fireTimers(); while (!entered) await turn();
  let done = false; const importing = h.api.importPins('A', { 'radio:new': 3 }, h.owner()).then(() => { done = true; });
  await turn(); assert.equal(done, false, 'import waits for the old disk writer'); release(); await importing;
  oldTimer(); await turn(); h.fireTimers(); await h.api.exportPins('A');
  const saved = h.saved(); assert.equal(saved['album:old'], 1); assert.equal(saved['radio:new'], 3); assert.ok(saved['playlist:manual']);
  assert.deepEqual(plain(h.store.getState().pins), saved); assert.equal(h.writes.length, 2);
});

test('failed import reads and writes retain the real store and disk, and a later explicit retry can succeed', async () => {
  const existing = { 'album:old': 1 }, h = harness(existing); await h.store.getState().hydrate();
  h.fault(true, false); await assert.rejects(h.api.importPins('A', { 'radio:new': 2 }, h.owner()), /Read unavailable/);
  assert.deepEqual(h.saved(), existing); assert.deepEqual(plain(h.store.getState().pins), existing); assert.equal(h.writes.length, 0);
  h.fault(false, true); await assert.rejects(h.api.importPins('A', { 'radio:new': 2 }, h.owner()), /Write unavailable/);
  assert.deepEqual(h.saved(), existing); assert.deepEqual(plain(h.store.getState().pins), existing); assert.equal(h.writes.length, 0);
  h.fault(false, false); await h.api.importPins('A', { 'radio:new': 2 }, h.owner());
  assert.deepEqual(h.saved(), { ...existing, 'radio:new': 2 }); assert.deepEqual(plain(h.store.getState().pins), h.saved());
});

test('profile clear drains an accepted disk write, skips its queued successor and prevents either old debounce from resurrecting pins', async () => {
  const h = harness({ 'album:old': 1 }); await h.store.getState().hydrate();
  let release!: () => void, entered = false; const waiting = new Promise<void>((resolve) => { release = resolve; });
  h.gateWrite(async () => { entered = true; await waiting; });
  h.store.getState().toggle('playlist:first'); const firstTimer = h.timer(); h.fireTimers(); while (!entered) await turn();
  h.store.getState().toggle('playlist:queued'); const secondTimer = h.timer(); h.fireTimers(); await turn();
  const clearing = h.api.clearPinsProfile('A'); release(); await clearing;
  firstTimer(); secondTimer(); await turn();
  assert.equal(h.saved(), undefined); assert.deepEqual(plain(h.store.getState().pins), {}); assert.equal(h.writes.length, 1, 'only the already-started write ran before deletion');
});

test('an invalid owner and an account A to B to A while reading refuse the actual import before any write', async () => {
  const h = harness({ 'album:old': 1 }); await h.store.getState().hydrate();
  await assert.rejects(h.api.importPins('A', { 'radio:new': 2 }, () => false), /Profile changed/);
  let release!: () => void, entered = false; const waiting = new Promise<void>((resolve) => { release = resolve; });
  h.gateRead(async () => { entered = true; await waiting; });
  const current = h.owner(), work = h.api.importPins('A', { 'radio:new': 2 }, current), rejected = assert.rejects(work, /Profile changed/);
  while (!entered) await turn(); h.switch('B'); h.switch('A'); release(); await rejected;
  assert.deepEqual(h.saved(), { 'album:old': 1 }); assert.deepEqual(plain(h.store.getState().pins), { 'album:old': 1 }); assert.equal(h.writes.length, 0);
});
