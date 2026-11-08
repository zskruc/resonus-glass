import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import * as sorting from '../src/lib/artistSongSort';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function execute(source: string, imports: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, ...values, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } }); return exports;
}
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('choosing By album overrides a legacy artist sort and remains selected after real store persistence and hydration', async () => {
  let saved = JSON.stringify({ 'artistSongs:artist': { field: 'alpha', dir: 'asc' } }), timer: (() => void) | undefined;
  const auth = createStore(() => ({ auth: { username: 'A' } }));
  const authModule = { useAuthStore: auth, profileScopeId: () => 'profile-A' };
  const epoch = execute(source('../src/lib/lyricOwner.ts'), { '@/store/auth': authModule });
  const store = () => execute(source('../src/store/sortPrefs.ts'), {
    zustand: { create: createStore }, '@/lib/storage': { getItem: async () => saved, setItem: async (_: string, value: string) => { saved = value; } },
  }, { setTimeout: (run: () => void) => { timer = run; return 1; }, clearTimeout: () => { timer = undefined; } }).useSortPrefs;
  const hook = (prefs: any) => execute(source('../src/hooks/useArtistSongSort.tsx'), {
    react: React, 'react/jsx-runtime': JSXRuntime, '@/components/SortSheet': { SortSheet: 'SortSheet' }, '@/lib/artistSongSort': sorting,
    '@/lib/lyricOwner': epoch, '@/lib/localLibrary': { hashKey: (value: string) => value }, '@/store/auth': authModule, '@/store/sortPrefs': { useSortPrefs: prefs },
    '@/store/downloads': { useDownloads: (read: (value: any) => unknown) => read({ files: {} }) },
    '@/store/playCounts': { usePlayCounts: (read: (value: any) => unknown) => read({ hydrated: false }) },
  }).useArtistSongSort;
  const tracks = [{ id: 'z', title: 'Zulu' }, { id: 'a', title: 'Alpha' }]; let latest: any, useSort: any;
  function Screen() { latest = useSort(tracks, 'artist', [], 'en'); return latest.sortSheet; }
  let root!: ReactTestRenderer;
  try {
    const first = store(); await first.getState().hydrate(); useSort = hook(first);
    await act(async () => { root = create(React.createElement(Screen)); });
    assert.equal(root.root.findByType('SortSheet' as any).props.field, 'alpha');
    await act(async () => { root.root.findByType('SortSheet' as any).props.onPick('recent', 'asc'); });
    assert.equal(root.root.findByType('SortSheet' as any).props.field, 'recent');
    assert.deepEqual(latest.songs.map((song: any) => song.id), ['z', 'a']);
    timer?.(); await Promise.resolve(); await act(async () => root.unmount());
    const second = store(); await second.getState().hydrate(); useSort = hook(second);
    await act(async () => { root = create(React.createElement(Screen)); });
    assert.equal(root.root.findByType('SortSheet' as any).props.field, 'recent');
    assert.equal(second.getState().prefs['artistSongs:artist'].field, 'alpha', 'legacy preferences remain untouched for other profiles');
  } finally { await act(async () => root?.unmount()); }
});

test('the real artist playback binding reads the latest sorted queue even when TrackRow memo keeps the original callback', async () => {
  const ast = ts.createSourceFile('screen.tsx', source('../src/app/artist/songs/[id].tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = (ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'ArtistSongsScreen') as ts.FunctionDeclaration).body!;
  const ref = body.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((value) => value.name.getText(ast) === 'latestPlayback'))!;
  const effect = body.statements.find((node) => ts.isExpressionStatement(node) && node.getText(ast).startsWith('useLayoutEffect') && node.getText(ast).includes('latestPlayback.current'))!;
  const dispatcher = body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'playLatestSong')!;
  const rowAst = ts.createSourceFile('row.tsx', source('../src/components/TrackRow.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const compareSource = rowAst.statements.filter((node) => ts.isFunctionDeclaration(node) && ['sameMenuContext', 'propsEqual'].includes(node.name?.text ?? '')).map((node) => node.getText(rowAst)).join('\n');
  const compare = execute(`${compareSource}; exports.compare = propsEqual;`, {}).compare;
  let renders = 0, owner = { username: 'A' }; const calls: any[] = [];
  const Row = React.memo(function MemoRow(props: any) { renders++; return React.createElement('Row', props); }, compare);
  const Binding = execute(`exports.Binding = function Binding({shown}) {
    const name='Artist', id='artist', profile='profile-A', owner=useAuthStore.getState().auth;
    ${ref.getText(ast)} ${effect.getText(ast)} ${dispatcher.getText(ast)}
    return element(Row,{song:shown[0],onPress:()=>playLatestSong(shown[0].id)});
  };`, {}, { useRef: React.useRef, useLayoutEffect: React.useLayoutEffect, captureLyricOwner: () => () => true,
    useAuthStore: { getState: () => ({ auth: owner }) }, profileScopeId: () => 'profile-A', playQueue: (...args: any[]) => calls.push(args), element: React.createElement, Row }).Binding;
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }; let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(Binding, { shown: [a, b, c] })); });
    const press = root.root.findByType('Row' as any).props.onPress;
    await act(async () => { root.update(React.createElement(Binding, { shown: [a, c, b] })); });
    assert.equal(renders, 1, 'the real TrackRow comparator intentionally ignores callback identity');
    press(); assert.deepEqual(calls[0][0].map((song: any) => song.id), ['a', 'c', 'b']); assert.equal(calls[0][1], 0);
    owner = { username: 'B' }; press(); assert.equal(calls.length, 1, 'old scope cannot start another queue');
  } finally { await act(async () => root?.unmount()); }
});
