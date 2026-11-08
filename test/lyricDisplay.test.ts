import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import * as documents from '../src/lib/lyricDocuments';

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return exports;
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
function harness() {
  const auth = createStore(() => ({ auth: { username: 'A' }, offlineSource: 'server' }));
  const scope = () => auth.getState().auth.username;
  const owner = load('../src/lib/lyricOwner.ts', { '@/store/auth': { useAuthStore: auth, profileScopeId: scope } });
  const data = new Map<string, string>(); let readGate: Promise<void> | undefined, writeGate: Promise<void> | undefined, failRead = false, failWrite = false;
  const store = load('../src/store/lyricDisplay.ts', {
    zustand: { create }, '@/lib/localLibrary': { hashKey: (value: string) => value }, '@/lib/lyricDocuments': documents,
    '@/lib/storage': { getItem: async (key: string) => { const raw = data.get(key) ?? null; await readGate; if (failRead) throw new Error('read failed'); return raw; },
      setItemStrict: async (key: string, raw: string) => { await writeGate; if (failWrite) throw new Error('write failed'); data.set(key, raw); } },
  }).useLyricDisplay;
  return { auth, owner, store, data, current: () => owner.captureLyricOwner(scope()),
    switchTo: (username: string) => auth.setState({ auth: { username } }), gateRead: (value?: Promise<void>) => { readGate = value; },
    gateWrite: (value?: Promise<void>) => { writeGate = value; }, failRead: (value: boolean) => { failRead = value; }, failWrite: (value: boolean) => { failWrite = value; } };
}

test('companion preference persists per profile, while failed reads or writes do not replace saved settings', async () => {
  const h = harness(), s = h.store.getState(); await s.hydrate('A', h.current());
  assert.equal(h.store.getState().mode, 'both'); assert.equal(await s.save('A', 'translation', h.current()), true);
  h.switchTo('B'); await s.hydrate('B', h.current()); assert.equal(h.store.getState().mode, 'both');
  await s.save('B', 'romanization', h.current()); h.switchTo('A'); await s.hydrate('A', h.current());
  assert.equal(h.store.getState().mode, 'translation'); h.failWrite(true);
  assert.equal(await s.save('A', 'original', h.current()), false); assert.equal(h.store.getState().mode, 'translation');
  assert.equal(h.data.get('resonus.lyricDisplay.A'), '"translation"');
  h.switchTo('B'); h.failRead(true); await s.hydrate('B', h.current());
  assert.equal(h.store.getState().ready, false); assert.equal(await s.save('B', 'both', h.current()), false);
  assert.equal(h.data.get('resonus.lyricDisplay.B'), '"romanization"');
});

test('late hydration and A to B to A owners cannot publish old lyric preferences or source requests', async () => {
  const h = harness(), gate = deferred(), firstOwner = h.current(); h.gateRead(gate.promise);
  const a = h.store.getState().hydrate('A', firstOwner); await Promise.resolve();
  h.switchTo('B'); h.gateRead(); await h.store.getState().hydrate('B', h.current());
  h.switchTo('A'); assert.equal(firstOwner(), false, 'returning to A must not revive departed source work');
  h.data.set('resonus.lyricDisplay.A', '"romanization"'); await h.store.getState().hydrate('A', h.current());
  gate.resolve(); await a; assert.equal(h.store.getState().mode, 'romanization');
  h.auth.setState({ offlineSource: 'downloads' }); assert.equal(firstOwner(), false);
});
