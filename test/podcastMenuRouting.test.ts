import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile('SongMenuSheet.tsx', readFileSync(new URL('../src/components/SongMenuSheet.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = (name: string) => source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration;
function execute(text: string, values: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require(name: string) { assert.equal(name, 'react/jsx-runtime'); return { jsx: (type: unknown, props: unknown) => ({ type, props }) }; }, ...values });
  return exports;
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('the actual SongMenu dispatches an RSS item to one local glass menu and retains player extras', async () => {
  const song = { id: 'show/episode', title: 'Episode', artist: 'Show', podcastChannelId: 'show', url: 'https://audio.test/a.mp3' };
  const owner = { username: 'one' };
  const extras = { queue: true, speed() {} };
  let state: any = { song, session: 10, extras, sleep: true };
  const useSongMenu = Object.assign((select: any) => select(state), { getState: () => ({ ...state, close() { state = { ...state, song: null, session: state.session + 1 }; } }) });
  const opened: any[] = [], effects: (() => unknown)[] = [];
  const mod = execute(`${declaration('SongMenuSheet').getText(source)}\n${declaration('PodcastMenuRedirect').getText(source)}\nexports.route=SongMenuSheet;`, {
    useSongMenu, useEffect: (effect: () => unknown) => effects.push(effect), profileScopeId: () => 'one',
    useAuthStore: { getState: () => ({ auth: owner }) },
    getChannel: async () => ({ id: 'show', title: 'Show' }), getPodcastEpisode: async () => ({ id: song.id, channelId: 'show', title: 'Episode' }),
    openPodcastEpisodeMenu: (...args: unknown[]) => opened.push(args),
  });
  const rendered = mod.route(); assert.equal(typeof rendered.type, 'function');
  rendered.type(rendered.props); effects.forEach((run) => run());
  await turn();
  assert.equal(opened.length, 1);
  assert.equal(opened[0][1].id, song.id);
  assert.equal(opened[0][2].queue, true);
  assert.equal(opened[0][2].speed, extras.speed);
  assert.equal(opened[0][2].sleep, true);
  assert.equal(state.song, null);
});

test('a stale RSS menu lookup cannot close a newer menu or open a previous account item', async () => {
  const song = { id: 'a', title: 'Episode', podcastChannelId: 'show' };
  const owner = { username: 'one' };
  let state: any = { song, session: 1, extras: {} };
  let release!: (value: unknown) => void;
  const opened: unknown[] = [], effects: (() => unknown)[] = [];
  const useSongMenu = Object.assign((select: any) => select(state), { getState: () => ({ ...state, close() { throw Error('stale close'); } }) });
  const mod = execute(`${declaration('PodcastMenuRedirect').getText(source)}\nexports.redirect=PodcastMenuRedirect;`, {
    useSongMenu, useEffect: (effect: () => unknown) => effects.push(effect), profileScopeId: () => 'one', useAuthStore: { getState: () => ({ auth: owner }) },
    getChannel: () => new Promise((resolve) => { release = resolve; }), getPodcastEpisode: async () => ({ id: 'a' }),
    openPodcastEpisodeMenu: (...args: unknown[]) => opened.push(args),
  });
  mod.redirect({ song, session: 1 }); effects.forEach((run) => run());
  state = { ...state, session: 2, song: { id: 'other' } }; release({ id: 'show' }); await turn();
  assert.equal(opened.length, 0);
});

function removalHarness() {
  const content = declaration('SongMenuContent');
  const remove = content.body!.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'removeFromList')!;
  const owns = content.body!.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.name.getText(source) === 'ownsMenuProfile'))!;
  const owner = { username: 'one' }, nextOwner = { username: 'two' };
  let state = { auth: owner, offline: false }, scope = 'one';
  const original = { playlist: { id: 'p' }, songs: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] };
  const list = [{ id: 'p', songCount: 3 }];
  const cache = new Map<string, any>([['["playlist","p"]', original], ['["playlists"]', list]]);
  const invalidations: unknown[] = [], writes: any[] = [];
  let undo: any;
  const queryClient = { getQueryData: (key: unknown) => cache.get(JSON.stringify(key)),
    setQueryData: (key: unknown, value: any) => { const name = JSON.stringify(key); const result = typeof value === 'function' ? value(cache.get(name)) : value; cache.set(name, result); return result; },
    invalidateQueries: (value: unknown) => invalidations.push(value),
  };
  const mod = execute(`${owns.getText(source)}\n${remove.getText(source)}\nexports.remove=removeFromList;`, {
    menuOwner: { auth: owner, offline: false, profile: 'one' }, profileScopeId: () => scope, useAuthStore: { getState: () => state },
    auth: owner, offline: false, context: { playlistId: 'p', index: 1 }, song: { id: 'a' }, close() {},
    queryClient, t: (key: string) => key, toast() {}, useToast: { getState: () => ({ show() {} }) },
    showUndoToast: (_message: string, _label: string, callbacks: unknown) => { undo = callbacks; },
    replacePlaylistTracklist: async (...args: unknown[]) => { writes.push(args); },
  });
  return { mod, cache, original, list, invalidations, writes, undo: () => undo,
    switchAccount() { state = { auth: nextOwner, offline: false }; scope = 'two'; },
    goOffline() { state = { ...state, offline: true }; },
  };
}

test('the actual delayed removal submits a subsequence with duplicate occurrences and the original expected IDs', async () => {
  const h = removalHarness(); h.mod.remove(); h.undo().commit(); await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [['p', ['a', 'b'], ['a', 'a', 'b']]]);
});

test('deferred removal and Undo cannot mutate a new profile or a changed offline source', async () => {
  for (const change of ['switchAccount', 'goOffline'] as const) {
    const h = removalHarness(); h.mod.remove();
    h[change]();
    const fresh = { songs: [{ id: 'belongs-to-new-owner' }] }; h.cache.set('["playlist","p"]', fresh);
    h.undo().commit(); h.undo().undo(); await turn();
    assert.equal(h.writes.length, 0);
    assert.equal(h.cache.get('["playlist","p"]'), fresh);
  }
});

test('Undo does not overwrite a newer same-account edit made after the optimistic removal', () => {
  const h = removalHarness(); h.mod.remove();
  const newer = { songs: [{ id: 'newer-order' }] }; h.cache.set('["playlist","p"]', newer);
  h.undo().undo();
  assert.equal(h.cache.get('["playlist","p"]'), newer);
  assert.ok(h.invalidations.length > 0);
});
