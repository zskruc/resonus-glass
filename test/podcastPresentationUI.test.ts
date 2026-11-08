import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';

import { createPodcastDownloadConfirmation, podcastDownloadSelection, podcastEpisodeOrder,
  podcastEpisodeSortKey, sortPodcastEpisodes } from '../src/lib/podcastPresentation';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const jsx = (type: any, props: any) => ({ type, props });
function execute(source: string, imports: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, ...values, require(id: string) {
    assert.ok(Object.hasOwn(imports, id), `Unexpected dependency: ${id}`); return imports[id];
  } });
  return exports;
}

test('the real episode-screen play callback submits the visible order and correct offline index', async () => {
  const source = ts.createSourceFile('podcast.tsx', readFileSync(new URL('../src/app/podcast/[id].tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'PodcastScreen') as ts.FunctionDeclaration;
  const play = screen.body!.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(source) === 'play'))!;
  const calls: any[] = [];
  let active = true;
  const mod = execute(`${play.getText(source)}; exports.play = play;`, {}, {
    useCallback: (callback: unknown) => callback,
    current: () => active,
    channel: { data: { id: 'show', title: 'Show' } }, files: { b: 'file:///b', a: 'file:///a' },
    isManualOffline: () => true, toast() { throw Error('Unexpected offline toast'); }, t: (key: string) => key,
    playQueue: async (...args: unknown[]) => calls.push(args), episodeToSong: (episode: any) => episode,
  });
  const list = ['b', 'unavailable', 'a'].map((id) => ({ id, channelId: 'show', title: id, url: `https://audio.test/${id}` }));
  mod.play(list, 2); await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[
    [list[0], list[2]], 1, 'Show', '/podcast/show', { ordered: true },
  ]]);
  active = false; mod.play(list, 0); await turn();
  assert.equal(calls.length, 1, 'a stale page playback callback cannot admit another profile\'s queue');
});

test('the real sort hook restores each show choice and rejects a previous profile modal callback', () => {
  let profile = 'one';
  const prefs: Record<string, { field: string; dir: string }> = {};
  const state = { prefs, setPref: (key: string, pref: typeof prefs[string]) => { prefs[key] = pref; } };
  const useSortPrefs = Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state });
  const mod = execute(readFileSync(new URL('../src/hooks/usePodcastEpisodeSort.tsx', import.meta.url), 'utf8'), {
    react: { useMemo: (make: () => unknown) => make(), useRef: (value: unknown) => ({ current: value }) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/SortSheet': { SortSheet: 'SortSheet' },
    '@/lib/podcastPresentation': { podcastEpisodeOrder, podcastEpisodeSortKey, sortPodcastEpisodes },
    '@/store/auth': { profileScopeId: () => profile, useAuthStore: (select: () => unknown) => select() },
    '@/store/sortPrefs': { useSortPrefs },
  });
  const episodes = [{ id: 'new', title: 'New', publishedAt: 200 }, { id: 'old', title: 'Old', publishedAt: 100 }];
  const first = mod.usePodcastEpisodeSort(episodes, 'a', 'en');
  first.sortSheet.props.onPick('added');
  assert.deepEqual(mod.usePodcastEpisodeSort(episodes, 'a', 'en').episodes.map((item: any) => item.id), ['old', 'new']);
  assert.deepEqual(mod.usePodcastEpisodeSort(episodes, 'b', 'en').episodes.map((item: any) => item.id), ['new', 'old']);
  assert.deepEqual(mod.usePodcastEpisodeSort(episodes, 'serial', 'en', true).episodes.map((item: any) => item.id), ['old', 'new'], 'serial shows start chronologically unless the user chooses otherwise');
  mod.usePodcastEpisodeSort(episodes, 'serial', 'en', true).sortSheet.props.onPick('recent');
  assert.deepEqual(mod.usePodcastEpisodeSort(episodes, 'serial', 'en', true).episodes.map((item: any) => item.id), ['new', 'old']);
  profile = 'two';
  first.sortSheet.props.onPick('alpha');
  assert.equal(prefs[podcastEpisodeSortKey('one', 'a')].field, 'added');
  assert.deepEqual(mod.usePodcastEpisodeSort(episodes, 'a', 'en').episodes.map((item: any) => item.id), ['new', 'old']);
  profile = 'one';
  assert.deepEqual(mod.usePodcastEpisodeSort(episodes, 'a', 'en').episodes.map((item: any) => item.id), ['old', 'new']);
});

function dialogHarness() {
  const auth = createStore<any>(() => ({ auth: { username: 'one' }, offline: false }));
  const useAuthStore = Object.assign((select?: (value: any) => unknown) => select ? select(auth.getState()) : auth.getState(), auth);
  const slots: any[] = [];
  let cursor = 0;
  const effects: (() => void)[] = [];
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial: unknown) {
      const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? (initial as () => unknown)() : initial };
      return [slot.value, (value: unknown) => { slot.value = value; }];
    },
    useMemo(make: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, value: make() };
      return slots[index].value;
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const old = slots[index];
        slots[index] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const channel = { id: 'show', title: 'Show' };
  const episodes = [
    { id: 'a', channelId: 'show', title: 'A', url: 'https://audio/a', duration: 60 },
    { id: 'b', channelId: 'show', title: 'B', url: 'https://audio/b', duration: 120 },
    { id: 'c', channelId: 'show', title: 'C', url: 'https://audio/c' },
  ];
  let shown = true, reads = 0, failRead = false;
  const toasts: string[] = [], admitted: any[] = [];
  const downloadState = { scope: 'one', hydrated: true, files: { a: 'file:///a' } as Record<string, string>,
    async hydrate() {}, async download(...args: unknown[]) { admitted.push(args); } };
  const usePodcastDownloads = Object.assign((select: (value: typeof downloadState) => unknown) => select(downloadState), { getState: () => downloadState });
  const imports: Record<string, unknown> = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/api/podcasts': { async listAllEpisodes() { reads++; if (failRead) throw Error('Database unavailable'); return episodes; } },
    '@/api/netGate': { isManualOffline: () => auth.getState().offline },
    '@/i18n': { episodesLabel: (count: number) => `${count} episodes`, useT: () => (text: string, values: Record<string, string> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]) },
    '@/lib/format': { formatTotalDuration: (seconds: number) => `${seconds / 60} min` },
    '@/lib/localLibrary': { hashKey: (key: string) => key },
    '@/lib/podcastPresentation': { createPodcastDownloadConfirmation, podcastDownloadSelection },
    '@/store/auth': { profileScopeId: () => auth.getState().auth.username, useAuthStore },
    '@/store/podcastDownloads': { usePodcastDownloads },
    '@/store/settings': { useSettings: (select: (value: unknown) => unknown) => select({ language: 'en' }) },
    '@/store/toast': { useToast: (select: (value: unknown) => unknown) => select({ show: (text: string) => toasts.push(text) }) },
    './Dialog': { Dialog: 'Dialog' },
  };
  const mod = execute(readFileSync(new URL('../src/components/PodcastDownloadDialog.tsx', import.meta.url), 'utf8'), imports);
  let tree: any;
  const onClose = () => { shown = false; };
  function render() {
    cursor = 0;
    const wrapper = mod.PodcastDownloadDialog({ channel: shown ? channel : null, onClose });
    tree = wrapper ? wrapper.type(wrapper.props) : null;
    while (effects.length) effects.shift()!();
  }
  return { render, auth, admitted, toasts, downloadState, dialog: () => tree?.props, reads: () => reads,
    failRead() { failRead = true; }, shown: () => shown };
}

test('the real bulk dialog requires confirmation, reports missing episode time, and excludes a just-completed file', async () => {
  const h = dialogHarness(); h.render();
  assert.equal(h.dialog(), undefined); assert.equal(h.admitted.length, 0);
  await turn(); h.render();
  assert.equal(h.dialog().title, 'Download “Show”?');
  assert.match(h.dialog().message, /2 episodes.*2 min/);
  assert.match(h.dialog().message, /Duration excludes episodes with unknown length/);
  assert.equal(h.admitted.length, 0);
  h.downloadState.files = { ...h.downloadState.files, b: 'file:///b' };
  h.dialog().onConfirm(); await turn();
  assert.equal(h.shown(), false); assert.equal(h.admitted.length, 1);
  assert.deepEqual(h.admitted[0][1].map((item: any) => item.id), ['c']);
});

test('the real bulk dialog handles cancellation, account changes and failed episode reads without transfers', async () => {
  for (const operation of ['cancel', 'account', 'failure'] as const) {
    const h = dialogHarness(); if (operation === 'failure') h.failRead();
    h.render(); await turn(); h.render();
    if (operation === 'failure') {
      assert.equal(h.shown(), false); assert.ok(h.toasts.includes("Couldn't load this podcast."));
    } else {
      const oldConfirm = h.dialog().onConfirm;
      if (operation === 'cancel') h.dialog().onCancel();
      else h.auth.setState({ auth: { username: 'two' } });
      oldConfirm(); await turn();
      assert.equal(h.shown(), false);
    }
    assert.equal(h.admitted.length, 0);
  }
});
