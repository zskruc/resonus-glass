import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** Executes the real refresh hook; controlled query promises model errors and
 * account replacement without involving the native UI or real music server. */
function harness() {
  let profile = 'a', owner: object | null = {};
  const notices: string[] = [], slots: any[] = [];
  let cursor = 0;
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value: unknown) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value: unknown) { const index = cursor++; const slot = slots[index] ??= { value }; return [slot.value, (next: unknown) => { slot.value = next; }]; },
    useEffect(create: () => (() => void), deps: unknown[]) {
      const index = cursor++, slot = slots[index] ??= {};
      if (!slot.deps || !same(slot.deps, deps)) { slot.close?.(); slot.close = create(); slot.deps = deps; }
    },
  };
  const auth = Object.assign((selector: (state: unknown) => unknown) => selector({ auth: owner }), { getState: () => ({ auth: owner }) });
  const code = ts.transpileModule(readFileSync(new URL('../src/hooks/useLibraryPullRefresh.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported: Record<string, any> = {}, dependencies: Record<string, unknown> = {
    react, '@/i18n': { useT: () => (key: string) => key },
    '@/store/auth': { profileScopeId: () => profile, useAuthStore: auth },
    '@/store/toast': { useToast: (selector: (state: unknown) => unknown) => selector({ show: (message: string) => notices.push(message) }) },
  };
  runInNewContext(code, { exports: exported, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return {
    render: (...queries: { refetch: () => Promise<{ isError: boolean }> }[]) => { cursor = 0; return exported.useLibraryPullRefresh(...queries); },
    switchProfile: () => { profile = 'b'; owner = {}; },
    replaceAuth: () => { owner = {}; },
    unmount: () => slots.forEach((slot) => slot.close?.()), notices,
  };
}
function pending() {
  let resolve!: (value: { isError: boolean }) => void;
  const promise = new Promise<{ isError: boolean }>((yes) => { resolve = yes; });
  return { promise, resolve };
}

test('refresh coalesces repeated pulls and reports failures without modifying the cached list', async () => {
  const h = harness(), gate = pending(); let calls = 0;
  const query = { refetch: () => { calls++; return gate.promise; } };
  const first = h.render(query).onRefresh(); await Promise.resolve();
  assert.equal(h.render(query).refreshing, true); await h.render(query).onRefresh(); assert.equal(calls, 1);
  gate.resolve({ isError: true }); await first;
  assert.equal(h.render(query).refreshing, false); assert.equal(h.notices.length, 1);
});
test('account changes and same-account auth replacement silence a stale refresh result', async () => {
  for (const change of ['profile', 'auth']) {
    const h = harness(), gate = pending(), query = { refetch: () => gate.promise };
    const work = h.render(query).onRefresh();
    if (change === 'profile') h.switchProfile(); else h.replaceAuth();
    assert.equal(h.render(query).refreshing, false);
    gate.resolve({ isError: true }); await work; assert.deepEqual(h.notices, []);
  }
});
test('unmount ignores an outstanding error and synchronous query failures still release the spinner', async () => {
  const h = harness(), gate = pending(), query = { refetch: () => gate.promise };
  const work = h.render(query).onRefresh(); h.unmount(); gate.resolve({ isError: true }); await work;
  assert.deepEqual(h.notices, []);
  const current = harness(), fails = { refetch: () => { throw new Error('offline'); } };
  await current.render(fails).onRefresh(); assert.equal(current.render(fails).refreshing, false);
  assert.equal(current.notices.length, 1);
});
