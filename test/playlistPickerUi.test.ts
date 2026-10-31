import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { MenuRequestScope } from '../src/lib/menuRequest';
import * as rules from '../src/lib/playlistMembership';
import type { Playlist, Song } from '../src/api/subsonic';

type Node = { type: any; props: Record<string, any> };
const song = (id: string): Song => ({ id, title: id, duration: 10 });
const tick = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const equal = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/** Runs the actual picker handlers and request scopes; only native views, query and HTTP boundaries are stubbed. */
function pickerHarness() {
  let active!: HookRunner;
  class HookRunner {
    slots: any[] = []; cursor = 0; effects: (() => void)[] = []; cleanups = new Set<() => void>();
    slot<T>(create: () => T): T { const index = this.cursor++; return this.slots[index] ??= create(); }
    render(component: (props: any) => Node, props: any): Node {
      active = this; this.cursor = 0; const tree = component(props);
      while (this.effects.length) this.effects.shift()!();
      return tree;
    }
    unmount() { for (const close of this.cleanups) close(); this.cleanups.clear(); }
  }
  const react = {
    useRef: (value: unknown) => active.slot(() => ({ current: value })),
    useState: (value: unknown) => {
      const state = active.slot(() => ({ value: typeof value === 'function' ? (value as () => unknown)() : value }));
      return [state.value, (next: any) => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useMemo: (read: () => unknown, deps: unknown[]) => {
      const state = active.slot(() => ({ deps: undefined as unknown[] | undefined, value: undefined as unknown }));
      if (!equal(state.deps, deps)) { state.deps = deps; state.value = read(); }
      return state.value;
    },
    useEffect: (create: () => (() => void) | undefined, deps: unknown[]) => {
      const owner = active;
      const state = owner.slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as (() => void) | undefined }));
      if (equal(state.deps, deps)) return; state.deps = deps;
      owner.effects.push(() => {
        if (state.cleanup) { owner.cleanups.delete(state.cleanup); state.cleanup(); }
        state.cleanup = create(); if (state.cleanup) owner.cleanups.add(state.cleanup);
      });
    },
  };
  const auth = { auth: { url: 'https://server.test', username: 'me' }, offline: false };
  const lists: Playlist[] = [{ id: 'none', name: 'None' }, { id: 'some', name: 'Some' }, { id: 'all', name: 'All' },
    { id: 'locked', name: 'Read only', readonly: true }, { id: 'foreign', name: 'Foreign', owner: 'another-user' }];
  const membership = new Map<string, string[]>([['none', []], ['some', ['a']], ['all', ['a', 'b']]]);
  let automaticRead = true;
  const reads: { lists: Playlist[]; report: (id: string, ids: string[]) => void; stop: () => boolean }[] = [];
  const mutations: { id: string; operation: string; current: () => boolean }[] = [];
  let result = deferred<string[]>();
  const created = deferred<string>(); let createCalls = 0;
  const notices: string[] = [], invalidations: unknown[] = [], reconciles: unknown[] = [];
  const picker = { session: 1, songs: [song('a'), song('b')], close: () => {} };
  const deps: Record<string, any> = {
    react, 'react/jsx-runtime': { jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) },
    'react-native': { ActivityIndicator: 'Spinner', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'Scroll', Text: 'Text', View: 'View', StyleSheet: { absoluteFill: {} } },
    '@tanstack/react-query': { useQuery: () => ({ data: lists, isLoading: false }), useQueryClient: () => ({ invalidateQueries: (value: unknown) => invalidations.push(value) }) },
    '@/api/data': {
      canEditPlaylist: (playlist: Playlist) => rules.canEditTracks(playlist, auth.auth.username), COVER: { thumb: 96 }, coverArtUrl: () => undefined,
      getPlaylists: async () => lists,
      playlistMembership: async (values: Playlist[], _wanted: string[], report: (id: string, ids: string[]) => void, stop: () => boolean) => {
        reads.push({ lists: values, report, stop });
        if (automaticRead) for (const playlist of values) if (!stop()) report(playlist.id, membership.get(playlist.id) ?? []);
      },
      addSongsToPlaylist: (id: string, _songs: Song[], options: { stillCurrent: () => boolean }) => {
        mutations.push({ id, operation: 'add', current: options.stillCurrent }); return result.promise;
      },
      removeSongsFromPlaylist: (id: string, _ids: string[], options: { stillCurrent: () => boolean }) => {
        mutations.push({ id, operation: 'remove', current: options.stillCurrent }); return result.promise;
      },
      createPlaylist: () => { createCalls++; return created.promise; },
    },
    '@/components/MenuGlassCard': { MenuGlassCardFrame: 'GlassFrame', MenuGlassCardHeader: 'GlassHeader' },
    '@/components/Icon': { __esModule: true, default: 'Icon' }, './Cover': { Cover: 'Cover' }, './Dialog': { Dialog: 'Dialog' },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ height: 900 }) },
    '@/hooks/useBottomSheetAnim': { useBottomSheetAnim: () => ({ dismiss: (after: () => void) => after(), dismissing: { value: false } }) },
    '@/i18n': { songsLabel: (count: number) => `${count} songs`, useT: () => (key: string, values?: Record<string, unknown>) => key.replace(/\{([^}]+)\}/g, (_, name: string) => String(values?.[name])) },
    '@/lib/menuRequest': { MenuRequestScope }, '@/lib/playlistMembership': rules,
    '@/store/auth': { useAuthStore: Object.assign((select: (value: object) => unknown) => select(auth), { getState: () => auth }), profileScopeId: () => auth.auth.url },
    '@/store/autoDownloads': { useAutoDownloads: { getState: () => ({ reconcile: (id: string) => reconciles.push(id) }) } },
    '@/store/playlistPicker': { usePlaylistPicker: Object.assign((select: (value: unknown) => unknown) => select(picker), { getState: () => picker }) },
    '@/store/settings': { useSettings: (select: (value: object) => unknown) => select({ language: 'en' }) },
    '@/store/toast': { useToast: (select: (value: object) => unknown) => select({ show: (value: string) => notices.push(value) }) },
    '@/theme': { colors: {}, fontSize: {}, radius: {}, spacing: {}, SHEET_MAX_WIDTH: 600, themed: (make: (colors: object) => object) => make({}) },
  };
  const exported: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/PlaylistPickerSheet.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: exported, require(name: string) { assert.ok(Object.hasOwn(deps, name), `Unexpected ${name}`); return deps[name]; } });
  const outer = new HookRunner(), inner = new HookRunner(); let closes = 0;
  const props = { songs: picker.songs, session: picker.session, onClose: () => { closes++; picker.session++; } };
  let component: (value: any) => Node, innerProps: any;
  const mount = () => { const tree = outer.render(exported.PlaylistPickerSheet, props); component = tree.type; innerProps = tree.props; return render(); };
  const render = () => inner.render(component, innerProps);
  const find = (tree: Node | null, predicate: (value: Node) => boolean): Node[] => {
    if (!tree || typeof tree !== 'object') return [];
    const children = [tree.props?.children].flat(Infinity).filter(Boolean) as Node[];
    return [...(predicate(tree) ? [tree] : []), ...children.flatMap((value) => find(value, predicate))];
  };
  const rows = (tree: Node) => find(tree, (value) => value.props?.accessibilityRole === 'checkbox');
  const dialog = (tree: Node) => find(tree, (value) => value.type === 'Dialog')[0];
  return { auth, lists, props, picker, outer, inner, mount, render, rows, dialog, find, reads, mutations, notices, invalidations, reconciles, created,
    closes: () => closes, createCalls: () => createCalls,
    replaceResult: () => { result = deferred<string[]>(); return result; },
    result: () => result, setAutomaticRead: (value: boolean) => { automaticRead = value; },
    renderOuter: () => outer.render(exported.PlaylistPickerSheet, props),
  };
}

test('actual picker renders none, mixed and all states plus explicit remove semantics and disabled readonly/foreign rows', () => {
  const h = pickerHarness(); h.mount(); const tree = h.render(), rows = h.rows(tree);
  assert.deepEqual(rows.map((value) => value.props.accessibilityState.checked), [false, 'mixed', true, false, false]);
  assert.deepEqual(rows.map((value) => value.props.disabled), [false, false, false, true, true]);
  assert.equal(h.find(tree, (value) => value.type === 'Text' && value.props.children === 'Remove all matching entries').length, 1);
  assert.equal(h.find(tree, (value) => value.type === 'Text' && value.props.children === '1 of 2 songs').length, 1);
  assert.equal(h.reads[0].lists.some((value) => value.readonly || value.owner === 'another-user'), false);
  h.inner.unmount(); h.outer.unmount();
});

test('an in-place picker edit synchronously locks duplicate taps, keeps the sheet open and changes only its target state', async () => {
  const h = pickerHarness(); h.mount(); const before = h.rows(h.render());
  before[1].props.onPress(); before[1].props.onPress(); before[0].props.onPress();
  assert.deepEqual(h.mutations.map((value) => [value.id, value.operation]), [['some', 'add']]);
  assert.equal(h.rows(h.render()).every((value) => value.props.disabled), true);
  h.result().resolve(['a', 'b']); await tick();
  const after = h.rows(h.render());
  assert.deepEqual(after.slice(0, 3).map((value) => value.props.accessibilityState.checked), [false, true, true]);
  assert.equal(h.closes(), 0); assert.deepEqual(h.reconciles, ['some']);
  const next = h.replaceResult(); after[1].props.onPress();
  assert.equal(h.mutations.at(-1)!.operation, 'remove'); next.resolve([]); await tick();
  assert.equal(h.rows(h.render())[1].props.accessibilityState.checked, false);
  h.inner.unmount(); h.outer.unmount();
});

test('replacement menu or account invalidates old mutation callbacks and late membership reports', async () => {
  for (const change of ['menu', 'account']) {
    const h = pickerHarness(); h.mount(); h.rows(h.render())[0].props.onPress();
    const mutation = h.mutations[0]; assert.equal(mutation.current(), true);
    if (change === 'menu') h.picker.session++;
    else h.auth.auth = { url: 'https://two.test', username: 'two' };
    assert.equal(mutation.current(), false);
    const before = h.rows(h.render())[0].props.accessibilityState.checked;
    h.reads[0].report('none', ['a', 'b']); h.result().resolve(['a', 'b']); await tick();
    assert.equal(h.rows(h.render())[0].props.accessibilityState.checked, before);
    assert.equal(h.notices.length, 0); assert.equal(h.invalidations.length, 0);
    if (change === 'account') { assert.equal(h.renderOuter(), null); assert.equal(h.closes(), 1); }
    h.inner.unmount(); h.outer.unmount();
  }
});

test('failed mutation re-reads membership after a partial server commit and stays usable', async () => {
  const h = pickerHarness(); h.mount(); h.rows(h.render())[0].props.onPress();
  h.result().reject(new Error('network')); await tick();
  assert.equal(h.notices.length, 1); assert.equal(h.reads.length, 2);
  assert.equal(h.rows(h.render())[0].props.disabled, false);
  h.replaceResult().resolve(['a', 'b']); h.rows(h.render())[0].props.onPress(); await tick();
  assert.equal(h.rows(h.render())[0].props.accessibilityState.checked, true);
  h.inner.unmount(); h.outer.unmount();
});

test('stale create-confirm and cancel callbacks cannot authorize or dismiss a replacement confirmation', async () => {
  const h = pickerHarness(); h.mount();
  const newButton = () => h.find(h.render(), (value) => value.props?.accessibilityRole === 'button')[0];
  newButton().props.onPress(); const oldDialog = h.dialog(h.render()); oldDialog.props.onCancel();
  newButton().props.onPress(); const currentDialog = h.dialog(h.render());
  oldDialog.props.onCancel(); oldDialog.props.onConfirm('obsolete');
  assert.equal(h.dialog(h.render()).props.visible, true); assert.equal(h.createCalls(), 0);
  currentDialog.props.onConfirm('New'); assert.equal(h.createCalls(), 1);
  h.auth.auth = { url: 'https://two.test', username: 'two' }; h.created.resolve('created'); await tick();
  assert.equal(h.mutations.length, 0, 'creation cannot add the old selection under a replacement account');
  h.inner.unmount(); h.outer.unmount();
});

test('an old profile-change effect cannot close a replacement global picker session', () => {
  const h = pickerHarness(); h.mount(); h.picker.session++;
  h.auth.auth = { url: 'https://two.test', username: 'two' };
  assert.equal(h.renderOuter(), null); assert.equal(h.closes(), 0);
  h.inner.unmount(); h.outer.unmount();
});
