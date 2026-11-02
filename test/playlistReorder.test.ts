import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';

import { applyPlaylistDrag, completePlaylistOrder, createPlaylistOrderWriter, playlistOrderRows, type PlaylistOrderRow } from '../src/lib/playlistReorder';
import { sameTracklist } from '../src/lib/playlistMembership';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const a = { id: 'A', title: 'A first occurrence' }, a2 = { id: 'A', title: 'A second occurrence' }, b = { id: 'B', title: 'B' };
const initial = () => playlistOrderRows([a, b, a2], 'profile:playlist:session');
const ids = (rows: readonly PlaylistOrderRow[]) => rows.map((row) => row.song.id);

test('drag boundaries are bounded and duplicate song occurrences retain independent keys and actual records', () => {
  const rows = initial(), moved = applyPlaylistDrag(rows, 0, 99);
  assert.deepEqual(ids(moved), ['B', 'A', 'A']);
  assert.equal(moved[1].song, a2); assert.equal(moved[2].song, a);
  assert.equal(moved[2].key, rows[0].key); assert.notEqual(moved[1].key, moved[2].key);
  assert.deepEqual(ids(applyPlaylistDrag(rows, 2, -8)), ['A', 'A', 'B']);
  for (const [from, to] of [[-1, 1], [3, 1], [0.5, 2], [0, Infinity], [0, 0]]) {
    assert.equal(applyPlaylistDrag(rows, from, to), rows);
  }
  assert.equal(completePlaylistOrder(rows, moved), true);
  assert.equal(completePlaylistOrder(rows, moved.slice(0, 2)), false);
  assert.equal(completePlaylistOrder(rows, [rows[0], rows[0], rows[2]]), false);
  assert.equal(completePlaylistOrder(rows, [{ ...rows[0], song: b }, rows[1], rows[2]]), false);
  assert.deepEqual(rows.map((row) => row.song), [a, b, a2]);
});

test('fast consecutive drops serialize writes, coalesce pending work and compare with the last confirmed server order', async () => {
  const rows = initial(), first = applyPlaylistDrag(rows, 0, 2), second = applyPlaylistDrag(first, 2, 1), latest = applyPlaylistDrag(second, 0, 2);
  const gates = [deferred(), deferred()];
  const writes: { next: string[]; expected: string[] }[] = [], painted: (readonly PlaylistOrderRow[])[] = [];
  const writer = createPlaylistOrderWriter(rows, {
    current: () => true,
    optimistic: (next, current) => { if (current()) painted.push(next); },
    write: (next, expected) => { const index = writes.push({ next, expected }) - 1; return gates[index].promise; },
    failed: () => assert.fail('these writes must succeed'),
  });
  assert.equal(writer.enqueue(first), true); await turn();
  assert.equal(writes.length, 1);
  assert.equal(writer.enqueue(second), true); assert.equal(writer.enqueue(latest), true); await turn();
  assert.equal(writes.length, 1, 'a server write is never overlapped');
  assert.deepEqual(ids(writer.rows), ids(latest));
  gates[0].resolve(); await turn();
  assert.equal(writes.length, 2, 'only the latest waiting drop is sent');
  assert.deepEqual(writes[0], { next: ids(first), expected: ids(rows) });
  assert.deepEqual(writes[1], { next: ids(latest), expected: ids(first) });
  assert.equal(painted.at(-1), writer.rows);
  gates[1].resolve(); await turn(); assert.equal(writer.busy, false);
});

test('a newer drop can replace work before dispatch and superseded optimistic failures are observed safely', async () => {
  const rows = initial(), first = applyPlaylistDrag(rows, 0, 2), latest = applyPlaylistDrag(first, 0, 1);
  const preparation = deferred();
  const writes: string[][] = [];
  let preparations = 0, failures = 0;
  const writer = createPlaylistOrderWriter(rows, {
    current: () => true,
    optimistic: () => ++preparations === 1 ? preparation.promise : undefined,
    write: async (next) => { writes.push(next); }, failed: () => { failures++; },
  });
  writer.enqueue(first); await turn(); writer.enqueue(latest);
  preparation.reject(new Error('cancelled old cache preparation')); await turn();
  assert.deepEqual(writes, [ids(latest)]); assert.equal(failures, 0); assert.equal(writer.busy, false);
});

test('a failed write clears the pending order and blocks edits until its owner creates a fresh verified session', async () => {
  const rows = initial(), first = applyPlaylistDrag(rows, 0, 2), later = applyPlaylistDrag(first, 0, 1);
  const gate = deferred(); let failures = 0, writes = 0;
  let confirmed: readonly PlaylistOrderRow[] | undefined;
  const writer = createPlaylistOrderWriter(rows, {
    current: () => true, optimistic() {}, write: async () => { writes++; await gate.promise; },
    failed: (_error, saved) => { failures++; confirmed = saved; },
  });
  writer.enqueue(first); await turn(); writer.enqueue(later); gate.reject(new Error('network failed')); await turn();
  assert.equal(failures, 1); assert.equal(writes, 1); assert.deepEqual(ids(confirmed!), ids(rows));
  assert.equal(writer.failed, true); assert.equal(writer.active, false); assert.equal(writer.busy, false);
  assert.equal(writer.enqueue(later), false, 'an uncertain server result cannot be followed by another overwrite');
});

test('an account/playlist departure rejects queued work and late completion, including an A to B to A return', async () => {
  const rows = initial(), first = applyPlaylistDrag(rows, 0, 2), later = applyPlaylistDrag(first, 0, 1);
  const gate = deferred(); let current = true, writes = 0, reports = 0;
  const writer = createPlaylistOrderWriter(rows, {
    current: () => current, optimistic() {}, write: async () => { writes++; await gate.promise; },
    failed: () => { reports++; }, idle: () => { reports++; },
  });
  writer.enqueue(first); await turn(); writer.enqueue(later);
  current = false; writer.dispose(); current = true; gate.resolve(); await turn();
  assert.equal(writes, 1); assert.equal(reports, 0); assert.equal(writer.enqueue(later), false);
  assert.equal(writer.busy, false);
});

test('invalid, duplicate and incomplete proposals never reach the optimistic cache or network', async () => {
  const rows = initial(); let work = 0;
  const writer = createPlaylistOrderWriter(rows, { current: () => true, optimistic: () => { work++; },
    write: async () => { work++; }, failed: () => { work++; } });
  assert.equal(writer.enqueue(rows), false);
  assert.equal(writer.enqueue([rows[0], rows[0], rows[2]]), false);
  assert.equal(writer.enqueue(rows.slice(1)), false);
  await turn(); assert.equal(work, 0);
});

test('leaving before the first microtask cannot cancel or update a replacement account query with the same playlist ID', async () => {
  const rows = initial(); let work = 0;
  const writer = createPlaylistOrderWriter(rows, { current: () => true,
    optimistic: () => { work++; }, write: async () => { work++; }, failed: () => { work++; } });
  writer.enqueue(applyPlaylistDrag(rows, 0, 2));
  writer.dispose();
  await turn();
  assert.equal(work, 0, 'ownership is checked before even the cache-cancellation callback begins');
});

/** Real React/effect/callback behavior; only native views, the drag recognizer,
 * player-settings hooks and images are controlled boundaries. */
function dragHarness() {
  let owned = true, closes = 0, back: (() => boolean) | undefined;
  const accepted: (readonly PlaylistOrderRow[])[] = [];
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    '@/components/Icon': { __esModule: true, default: 'icon' }, '@/components/glass': { GlassPressable: 'glass-button' },
    'react-native': { Pressable: 'pressable', Text: 'text', View: 'view', ActivityIndicator: 'spinner',
      StyleSheet: { absoluteFill: { position: 'absolute' }, create: (styles: unknown) => styles },
      BackHandler: { addEventListener: (_type: string, callback: () => boolean) => {
        back = callback; return { remove: () => { back = undefined; } };
      } } },
    'react-native-reorderable-list': { __esModule: true, default: 'reorder-list', useReorderableDrag: () => () => {} },
    'react-native-worklets': { scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args) },
    'react-native-safe-area-context': { SafeAreaView: 'safe-area' },
    '@/api/data': { COVER: { thumb: 100 }, songCoverUrl: () => undefined },
    '@/i18n': { useT: () => (key: string) => key }, '@/lib/listPerf': { listPerf: {} },
    '@/lib/playlistReorder': { applyPlaylistDrag }, '@/lib/haptics': { haptic() {} },
    '@/store/settings': { useSettings: (select: (state: unknown) => unknown) => select({ showListArtwork: true }) },
    '@/theme': { colors: { accent: '#f00' }, spacing: { sm: 8, md: 12, lg: 16 }, fontSize: { md: 16, xs: 12 },
      SCREEN_BOTTOM_PADDING: 160, themed: (factory: (colors: unknown) => unknown) => factory({ text: '#fff' }), useTheme() {} },
    './Cover': { Cover: 'cover' }, '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 180 },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => 'native-dock-scroll' },
  };
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/PlaylistReorder.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected reorder import ${name}`); return imports[name];
  } });
  const rows = initial();
  const render = (busy = false) => React.createElement(exports.PlaylistReorder, { rows, title: 'Playlist', busy,
    valid: () => owned, onClose: () => { closes++; }, onOrder: (next: readonly PlaylistOrderRow[]) => { accepted.push(next); return true; } });
  return { render, accepted, back: () => back?.(), closes: () => closes, depart() { owned = false; } };
}

test('the actual drag surface preserves duplicate keys, accepts fast drops during saving and ignores duplicate events', async () => {
  const h = dragHarness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render()); });
    const list = () => renderer.root.findAll((node) => String(node.type) === 'reorder-list')[0].props;
    const before = list(), drop = before.onReorder, originalKey = before.keyExtractor(before.data[0]);
    assert.equal(before.onScroll, 'native-dock-scroll');
    await act(async () => { before.onDragStart({ index: 0 }); drop({ from: 0, to: 2 }); });
    assert.equal(h.accepted.length, 1); assert.equal(h.accepted[0][2].song, a); assert.equal(h.accepted[0][1].song, a2);
    assert.equal(list().keyExtractor(list().data[2]), originalKey);
    await act(async () => { drop({ from: 0, to: 2 }); });
    assert.equal(h.accepted.length, 1, 'one released drag is applied once');
    await act(async () => { renderer.update(h.render(true)); });
    await act(async () => { list().onDragStart({ index: 2 }); drop({ from: 2, to: 0 }); });
    assert.equal(h.accepted.length, 2, 'an in-flight write does not block the next gesture');
    assert.equal(h.accepted[1][0].song, a);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('closing, unmounting or losing the owner rejects the library release callback that arrives 200ms later', async () => {
  for (const departure of ['close', 'unmount', 'owner'] as const) {
    const h = dragHarness(); let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(h.render()); });
      const list = renderer.root.findAll((node) => String(node.type) === 'reorder-list')[0].props;
      await act(async () => { list.onDragStart({ index: 0 }); });
      if (departure === 'close') { assert.equal(h.back(), true); assert.equal(h.closes(), 1); }
      if (departure === 'unmount') await act(async () => { renderer.unmount(); });
      if (departure === 'owner') h.depart();
      await act(async () => { list.onReorder({ from: 0, to: 2 }); });
      assert.equal(h.accepted.length, 0, `${departure} cannot save a late drop`);
    } finally { await act(async () => { renderer?.unmount(); }); }
    assert.equal(h.back(), undefined, 'unmount removes its system-back interception');
  }
});

/** Load the production route's actual order callbacks with the real query
 * cache. The network/offline reader and auth/profile are explicit boundaries;
 * this exercises neither a rewritten callback nor the entire navigation UI. */
function routeOrderHarness(offline: boolean) {
  const source = ts.createSourceFile('playlist.tsx', readFileSync(new URL('../src/app/playlist/[id].tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['currentOrderScope', 'closeReorder', 'openReorder', 'removeMany'];
  const snippets: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) snippets.push(node.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source); assert.equal(snippets.length, names.length);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const auth = { username: 'user' }, scope = { id: 'playlist', profile: 'A', auth, offline };
  let owner = auth, profile = 'A', stored = [a, b, a2];
  const visible = new Set(offline ? ['B'] : ['A', 'B']);
  const full = () => ({ playlist: { id: 'playlist', name: 'Playlist', owner: 'user', songCount: stored.length }, songs: stored });
  const ordinary = () => ({ ...full(), songs: stored.filter((song) => visible.has(song.id)) });
  const key = ['playlist', 'playlist']; client.setQueryData(key, ordinary());
  let readFull: () => Promise<ReturnType<typeof full>> = async () => full();
  let write: (next: string[], expected: string[]) => Promise<void> = async () => {};
  const writes: { next: string[]; expected: string[] }[] = [], sorts: unknown[] = [], toasts: string[] = [];
  const replacements: { next: string[]; expected: string[] }[] = [], listeners = new Set<() => void>();
  let undo: { commit(): void; undo(): void } | undefined;
  const exports: Record<string, any> = {};
  const context: Record<string, any> = {
    exports, id: 'playlist', auth, offline, profile: 'A', orderScope: scope,
    queryClient: client, orderRecoveryPending: false,
    liveOrderScope: { current: scope }, orderWriter: { current: null }, openOrderWriter: { current: null },
    openOrderRequest: { current: null }, nextOrderSession: { current: 0 }, mode: null,
    profileScopeId: () => profile, useAuthStore: { getState: () => ({ auth: owner, offline }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    canEditPlaylist: (playlist: { readonly?: boolean; owner?: string }) => !playlist.readonly && (!playlist.owner || playlist.owner === owner.username),
    playlistOrderRows, createPlaylistOrderWriter, sameTracklist,
    getPlaylistForEditing: () => readFull(), getPlaylist: async () => ordinary(),
    reorderPlaylist: async (_id: string, next: string[], expected: string[]) => { writes.push({ next, expected }); await write(next, expected); },
    replacePlaylistTracklist: async (_id: string, next: string[], expected: string[]) => { replacements.push({ next, expected }); },
    showUndoToast: (_message: string, _label: string, handlers: typeof undo) => { undo = handlers; },
    useToast: { getState: () => ({ show: (value: string) => toasts.push(value) }) },
    setSort: (value: unknown) => sorts.push(value), setReordering: (value: unknown) => { context.mode = value; },
    setOrderRecovery: (value: unknown) => { context.orderRecoveryPending = !!value; }, setOrderBusy() {},
    toast: (value: string) => toasts.push(value), t: (value: string) => value,
  };
  const code = ts.transpileModule(`${snippets.join('\n')}\nexports.actions = { openReorder, closeReorder, removeMany };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, context);
  return { client, key, writes, replacements, sorts, toasts, mode: () => context.mode, actions: exports.actions,
    commit: () => undo?.commit(), undo: () => undo?.undo(), listeners: () => listeners.size,
    reader(next: typeof readFull) { readFull = next; }, writer(next: typeof write) { write = next; }, full, ordinary,
    stored(next: typeof stored) { stored = next; },
    switchOwner() { owner = { username: 'other' }; profile = 'B'; context.liveOrderScope.current = { profile }; for (const listener of listeners) listener(); },
    restoreOwner() { owner = auth; profile = 'A'; context.liveOrderScope.current = { profile }; for (const listener of listeners) listener(); },
  };
}

test('the actual route edits the complete offline sequence without leaking hidden songs into its filtered browsing cache', async () => {
  const h = routeOrderHarness(true);
  const browser = h.client.getQueryData(h.key);
  try {
    await h.actions.openReorder();
    const mode = h.mode(); assert.ok(mode.writer);
    assert.deepEqual(ids(mode.writer.rows), ['A', 'B', 'A']);
    assert.equal(h.client.getQueryData(h.key), browser, 'opening the full editor cannot replace the filtered browser');
    const next = applyPlaylistDrag(mode.writer.rows, 0, 2);
    mode.writer.enqueue(next); await turn();
    assert.deepEqual(h.writes, [{ next: ['B', 'A', 'A'], expected: ['A', 'B', 'A'] }]);
    assert.equal(h.client.getQueryData(h.key), browser, 'optimistic editing rows also stay out of offline browsing');
    h.actions.closeReorder(); assert.equal(h.mode(), null);
  } finally { h.client.clear(); }
});

test('closing or switching owner while the complete edit snapshot loads cannot open or update the late old editor', async () => {
  for (const leave of ['close', 'account'] as const) {
    const h = routeOrderHarness(false), gate = deferred();
    h.reader(async () => { await gate.promise; return h.full(); });
    try {
      const opening = h.actions.openReorder();
      assert.ok(h.mode()); assert.equal(h.mode().writer, undefined, 'preparation has its own non-draggable loading surface');
      if (leave === 'close') h.actions.closeReorder();
      else h.switchOwner();
      const replacement = { playlist: { id: 'playlist', name: 'Other profile' }, songs: [{ id: 'Z', title: 'Z' }] };
      h.client.setQueryData(h.key, replacement);
      const replacementCached = h.client.getQueryData(h.key);
      gate.resolve(); await opening;
      assert.equal(h.client.getQueryData(h.key), replacementCached);
      assert.equal(h.mode()?.writer, undefined); assert.equal(h.writes.length, 0);
    } finally { h.client.clear(); }
  }
});

test('a route write timeout rereads the real result instead of treating its optimistic rollback as server truth', async () => {
  const h = routeOrderHarness(false), gate = deferred();
  h.writer(async (next) => {
    await gate.promise;
    // The server accepted the POST before the client lost its response.
    const pool = new Map<string, typeof a[]>();
    for (const song of h.full().songs) pool.set(song.id, [...(pool.get(song.id) ?? []), song]);
    h.stored(next.map((id) => pool.get(id)!.shift()!));
    throw new Error('response deadline');
  });
  try {
    await h.actions.openReorder();
    const writer = h.mode().writer;
    const first = applyPlaylistDrag(writer.rows, 0, 2);
    writer.enqueue(first); await turn();
    writer.enqueue(applyPlaylistDrag(first, 0, 1));
    gate.resolve(); await turn(); await turn();
    assert.equal(h.mode(), null); assert.equal(h.toasts.length, 1);
    assert.equal(h.writes.length, 1, 'a failed write abandons its pending successor');
    assert.deepEqual((h.client.getQueryData(h.key) as { songs: typeof a[] }).songs.map((song) => song.id), ['B', 'A', 'A']);
    assert.equal(writer.failed, true);
  } finally { h.client.clear(); }
});

test('deferred removal passes the complete original sequence to guarded deletion, including an empty result', async () => {
  for (const empty of [false, true]) {
    const h = routeOrderHarness(false);
    try {
      if (empty) { h.stored([b]); h.client.setQueryData(h.key, h.ordinary()); }
      h.actions.removeMany([empty ? 0 : 1]);
      assert.equal(h.listeners(), 1);
      h.commit(); await turn();
      assert.deepEqual(h.replacements, [{ next: empty ? [] : ['A', 'A'], expected: empty ? ['B'] : ['A', 'B', 'A'] }]);
      assert.equal(h.writes.length, 0, 'deleting entries must not use the permutation-only reorder API');
      assert.equal(h.listeners(), 0);
    } finally { h.client.clear(); }
  }
});

test('a filtered offline removal cannot overwrite hidden occurrences and an account round trip cannot commit or undo old work', async () => {
  const h = routeOrderHarness(true);
  try {
    h.actions.removeMany([0]); h.commit(); await turn();
    assert.equal(h.replacements.length, 0, 'the full offline sequence is larger than the visible browser subset');
    assert.equal(h.toasts.length, 1); assert.equal(h.client.getQueryState(h.key)?.isInvalidated, true);
    assert.equal(h.listeners(), 0);
  } finally { h.client.clear(); }
  for (const action of ['commit', 'undo'] as const) {
    const owner = routeOrderHarness(false);
    try {
      owner.actions.removeMany([1]); owner.switchOwner(); owner.restoreOwner();
      const replacement = { playlist: { id: 'playlist', name: 'New visit' }, songs: [{ id: 'Z', title: 'Z' }] };
      owner.client.setQueryData(owner.key, replacement);
      const cached = owner.client.getQueryData(owner.key);
      owner[action](); await turn();
      assert.equal(owner.replacements.length, 0); assert.equal(owner.client.getQueryData(owner.key), cached);
      assert.equal(owner.listeners(), 0);
    } finally { owner.client.clear(); }
  }
});
