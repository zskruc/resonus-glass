import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';

// Run the real catalog functions and account subscription. Only SQLite IO,
// timing and the global cover sink are explicit controlled boundaries.
const source = readFileSync(new URL('../src/store/downloads.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('downloads.ts', source, ts.ScriptTarget.Latest, true);
const functions = new Set(['serverDir', 'activeServerDir', 'assertCatalogOwner', 'deriveArtists',
  'getDownloadShelf', 'getDownloadsCatalog', 'resetCatalogCache']);
const variables = new Set(['cachedShelf', 'cachedForDir', 'shelfReading', 'songsReading', 'cachedSongs', 'cachedSongsDir', 'cachedFull', 'catalogEpoch']);
const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && functions.has(node.name?.text ?? '')
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => variables.has(decl.name.getText(ast)))
  || ts.isExpressionStatement(node) && node.getText(ast).startsWith('useAuthStore.subscribe('))
  .map((node) => node.getText(ast)).join('\n');
const code = ts.transpileModule(`${declarations}\nexports.shelf=getDownloadShelf; exports.catalog=getDownloadsCatalog;
exports.invalidate=resetCatalogCache; exports.dir=activeServerDir;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
  const auth = createStore(() => ({ auth: { serverUrl: 'A', username: 'u' } }));
  const api: Record<string, any> = {}, covers: { id: string; uri: string }[] = [];
  const reads: { method: string; dir: string; result: ReturnType<typeof deferred<any[]>> }[] = [];
  const Db = Object.fromEntries(['allAlbums', 'allArtists', 'allSongs'].map((method) => [method, (dir: string) => {
    const result = deferred<any[]>(); reads.push({ method, dir, result }); return result.promise;
  }]));
  runInNewContext(code, { exports: api, useAuthStore: auth, ROOT_DIR: 'file:///downloads/',
    hashKey: (value: string) => value, primaryUrl: (owner: { serverUrl: string }) => owner.serverUrl,
    timed: (_label: string, work: () => unknown) => work(), Db,
    normKey: (value: string) => value.toLowerCase(), UNKNOWN_ARTIST: 'Unknown', tg: (value: string) => value,
    registerCover: (id: string, uri: string) => { covers.push({ id, uri }); } });
  const current = () => api.dir() as string;
  function shelfData(dir: string, label: string, round = 0) {
    reads.filter((read) => read.dir === dir && read.method === 'allAlbums')[round].result.resolve([
      { id: 'same-album', artist: 'Singer', coverUri: `file:///${label}-album`, trackCovers: { 'same-song': `file:///${label}-track` } },
    ]);
    reads.filter((read) => read.dir === dir && read.method === 'allArtists')[round].result.resolve([
      { id: 'singer', coverUri: `file:///${label}-artist` },
    ]);
  }
  const songsData = (dir: string, label: string, round = 0) => reads.filter((read) => read.dir === dir && read.method === 'allSongs')[round].result.resolve([{ id: label }]);
  return { api, covers, reads, current, shelfData, songsData,
    switchTo: (serverUrl: string) => { auth.setState({ auth: { serverUrl, username: 'u' } }); return current(); } };
}

test('a late account A shelf cannot replace B cache or register A covers into B', async () => {
  const h = harness(), a = h.current(), old = h.api.shelf();
  const rejected = assert.rejects(old, /catalog changed/);
  const b = h.switchTo('B'), next = h.api.shelf(); h.shelfData(b, 'B'); const accepted = await next;
  h.covers.length = 0; h.shelfData(a, 'A'); await rejected;
  assert.equal(h.covers.length, 0); assert.equal(await h.api.shelf(), accepted);
  assert.ok(h.covers.every((cover) => cover.uri.startsWith('file:///B-')));
  assert.equal(h.reads.length, 4, 'two small-table queries per account; no extra B reread');
});
test('same-directory invalidation rejects old rows without clearing the newer shared read', async () => {
  const h = harness(), dir = h.current(), old = h.api.shelf(), rejected = assert.rejects(old, /catalog changed/);
  h.api.invalidate(); const next = h.api.shelf(); h.shelfData(dir, 'old', 0); await rejected;
  const shared = h.api.shelf(); assert.equal(h.reads.length, 4, 'old finally must not clear the new same-directory request');
  h.shelfData(dir, 'new', 1); const [a, b] = await Promise.all([next, shared]); assert.equal(a, b);
  assert.ok(h.covers.every((cover) => cover.uri.startsWith('file:///new-')));
});
test('account A to B to A cannot revive the first A request', async () => {
  const h = harness(), dir = h.current(), old = h.api.shelf(), rejected = assert.rejects(old, /catalog changed/);
  h.switchTo('B'); h.switchTo('A'); h.shelfData(dir, 'old'); await rejected;
  assert.deepEqual(h.covers, []); const next = h.api.shelf(); h.shelfData(dir, 'new', 1); await next;
});
test('shelf readers share small-table IO and never deserialize the full song catalog', async () => {
  const h = harness(), dir = h.current(), pending = Array.from({ length: 6 }, () => h.api.shelf());
  assert.equal(h.reads.length, 2); h.shelfData(dir, 'A'); const shelves = await Promise.all(pending);
  assert.ok(shelves.every((shelf) => shelf === shelves[0])); assert.equal(h.reads.some((read) => read.method === 'allSongs'), false);
  assert.equal(await h.api.shelf(), shelves[0]); assert.equal(h.reads.length, 2);
});
test('a late full song catalog cannot join account A songs onto account B metadata', async () => {
  const h = harness(), a = h.current(), old = h.api.catalog(), rejected = assert.rejects(old, /catalog changed/);
  h.shelfData(a, 'A'); await tick(); const b = h.switchTo('B'), next = h.api.catalog();
  h.shelfData(b, 'B'); await tick(); h.songsData(b, 'B-song'); const accepted = await next;
  h.covers.length = 0; h.songsData(a, 'A-song'); await rejected;
  assert.equal(await h.api.catalog(), accepted); assert.equal(accepted.songs[0].id, 'B-song');
  assert.ok(h.covers.every((cover) => cover.uri.startsWith('file:///B-')));
});
test('same-directory full catalog invalidation retains the new snapshot and stable identity', async () => {
  const h = harness(), dir = h.current(), old = h.api.catalog(), rejected = assert.rejects(old, /catalog changed/);
  h.shelfData(dir, 'old'); await tick(); h.api.invalidate();
  const a = h.api.catalog(), b = h.api.catalog(); h.shelfData(dir, 'new', 1); await tick();
  h.songsData(dir, 'old-song', 0); await rejected;
  h.songsData(dir, 'new-song', 1); const [first, second] = await Promise.all([a, b]);
  assert.equal(first, second); assert.equal(await h.api.catalog(), first); assert.equal(first.songs[0].id, 'new-song');
  assert.equal(h.reads.length, 6, 'two shelves plus two full song reads, with no per-caller duplication');
});
test('a failed small-table read propagates and is retried without a cached false empty shelf', async () => {
  const h = harness(), dir = h.current(), old = h.api.shelf(), rejected = assert.rejects(old, /SQLite failed/);
  h.reads.find((read) => read.method === 'allAlbums')!.result.reject(new Error('SQLite failed')); await rejected;
  assert.deepEqual(h.covers, []); const next = h.api.shelf(); h.shelfData(dir, 'recovered', 1); const shelf = await next;
  assert.equal(shelf.albums.length, 1); assert.equal(await h.api.shelf(), shelf);
});
