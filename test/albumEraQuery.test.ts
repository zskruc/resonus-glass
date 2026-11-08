import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import * as era from '../src/lib/albumEras';

function harness() {
  const first = { id: 'A' }, auth = createStore(() => ({ auth: first as { id: string } | null, offline: false, offlineSource: null as unknown }));
  let libraries: string[] | undefined;
  let result: Promise<any[]> = Promise.resolve([]), downloaded = false;
  const reads: { source: string; offset: number; size: number }[] = [], invalidated: unknown[] = [];
  const files = { files: {} }, subscriptions = new Set<(state: unknown) => unknown>();
  let options: any, cursor = 0;
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  const queryState = { data: undefined, hasNextPage: false, isFetching: false, isError: false, fetchNextPage: async () => {} };
  const read = (from: string, type: string, size: number, offset: number) => {
    assert.equal(type, 'alphabeticalByName'); reads.push({ source: from, size, offset }); return result;
  };
  const imports: Record<string, unknown> = {
    '@tanstack/react-query': { useInfiniteQuery: (value: unknown) => { options = value; return queryState; },
      useQueryClient: () => ({ invalidateQueries: (value: unknown) => { invalidated.push(value); }, resetQueries: async () => {} }) },
    react: { useMemo: (build: () => unknown) => build(), useEffect: (create: () => (() => void) | undefined, deps: unknown[]) => {
      const index = cursor++, before = effects[index];
      if (!before || deps.some((value, i) => !Object.is(value, before.deps[i]))) { before?.cleanup?.(); effects[index] = { deps, cleanup: create() }; }
    } },
    '@/api/data': { getAlbumList: (type: string, size: number, offset: number) => read('server', type, size, offset) },
    '@/lib/localQueries': { getAlbumList: (type: string, size: number, offset: number) => read('local SQL', type, size, offset) },
    '@/lib/downloadedBrowse': { guardDownloadedRead: (build: () => Promise<unknown>) => build() },
    '@/lib/albumEras': era, '@/lib/localLibrary': { hashKey: (value: string) => value },
    '@/store/auth': { useAuthStore: Object.assign((select: (state: unknown) => unknown) => select(auth.getState()), auth),
      profileScopeId: () => auth.getState().auth?.id ?? 'local' },
    '@/store/libraries': { enabledFolderIds: () => libraries, useLibraries: (select: (state: unknown) => unknown) => { subscriptions.add(select); return select({ disabled: {}, folders: {} }); } },
    '@/store/downloads': { useDownloads: (select: (state: unknown) => unknown) => select(files) },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/hooks/useAlbumEras.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => { assert.ok(name in imports, name); return imports[name]; } });
  return { auth, first, reads, invalidated, render: () => { cursor = 0; return exports.useAlbumEras(downloaded); },
    options: () => options,
    result: (value: Promise<any[]>) => { result = value; }, downloaded: () => { downloaded = true; },
    library: (ids: string[]) => { libraries = ids; }, changeFiles: () => { files.files = { song: 'new' } as any; },
  };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
test('the real era query pages album metadata and offline/downloaded modes use local SQL instead of a server scan', async () => {
  for (const mode of ['server', 'offline', 'downloaded']) {
    const h = harness(); if (mode === 'offline') h.auth.setState({ offline: true }); else if (mode === 'downloaded') h.downloaded();
    h.render(); await h.options().queryFn({ pageParam: 400, signal: new AbortController().signal });
    assert.deepEqual(h.reads, [{ source: mode === 'server' ? 'server' : 'local SQL', offset: 400, size: 200 }]);
    assert.ok(h.options().queryKey[1].includes(mode === 'offline' ? 'offline' : 'online'));
  }
});
test('departed accounts, library filters, source selection and aborted navigation reject late era pages', async () => {
  for (const change of ['account', 'library', 'source', 'offline', 'abort']) {
    const h = harness(), gate = deferred<any[]>(), controller = new AbortController(); h.result(gate.promise); h.render();
    const work = h.options().queryFn({ pageParam: 0, signal: controller.signal }), rejected = assert.rejects(work, /library changed/);
    if (change === 'account') h.auth.setState({ auth: { id: 'B' } });
    if (change === 'library') h.library(['new-library']);
    if (change === 'source') h.auth.setState({ offlineSource: { mode: 'folder', uris: ['new'] } });
    if (change === 'offline') h.auth.setState({ offline: true });
    if (change === 'abort') controller.abort();
    gate.resolve([{ id: 'old', name: 'Old', year: 1988 }]); await rejected;
  }
});
test('an old query retry cannot read a new account, and a cached offline index does not refetch just for a new screen mount', async () => {
  const h = harness(); h.render(); const old = h.options(); h.auth.setState({ auth: { id: 'B' } });
  await assert.rejects(old.queryFn({ pageParam: 0, signal: new AbortController().signal }), /library changed/); assert.equal(h.reads.length, 0);
  const local = harness(); local.auth.setState({ offline: true }); local.render(); local.render(); assert.equal(local.invalidated.length, 0);
  local.changeFiles(); local.render(); assert.equal(local.invalidated.length, 1);
});
