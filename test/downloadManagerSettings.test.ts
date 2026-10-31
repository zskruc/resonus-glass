import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatBytes } from '../src/lib/format';

type QueueItem = { key: string; song: { id: string; title: string; artist?: string };
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  bytesWritten: number; bytesTotal: number; groups: string[]; error?: string };
type Element = { type: unknown; props: Record<string, any> };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const compiled = ts.transpileModule(readFileSync(new URL('../src/app/settings/download-manager.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const tick = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
function deferred() { let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
function item(key: string, status: QueueItem['status'], bytesWritten = 0, bytesTotal = 0): QueueItem {
  return { key, song: { id: key, title: `Song ${key}`, artist: 'Artist' }, status, bytesWritten, bytesTotal, groups: ['playlist'] };
}
function findAll(tree: unknown, predicate: (node: Element) => boolean): Element[] {
  if (Array.isArray(tree)) return tree.flatMap((node) => findAll(node, predicate));
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const node = tree as Element;
  return [...(predicate(node) ? [node] : []), ...findAll(node.props.children, predicate),
    ...findAll(node.props.ListHeaderComponent, predicate), ...findAll(node.props.ListEmptyComponent, predicate)];
}
function text(tree: unknown): string {
  return findAll(tree, (node) => node.type === 'Text')
    .flatMap((node) => Array.isArray(node.props.children) ? node.props.children : [node.props.children]).join(' ');
}

/** Execute the real screen. Queue/network boundaries are controlled; the
 * component's summary, enabled actions and FlashList bindings are unchanged. */
function harness(queue: QueueItem[] = []) {
  let cursor = 0, tree: Element;
  const slots: any[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const slot = (create: () => any) => slots[cursor++] ??= create();
  const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const calls = { pause: 0, resume: 0, cancel: 0 };
  let pauseWork = async () => {};
  const auth = { auth: {} as object | null, offline: false };
  const state = { queue, queuePaused: false,
    pauseAll: async () => {
      calls.pause++; await pauseWork(); state.queuePaused = true;
      state.queue = state.queue.map((value) => ['queued', 'downloading'].includes(value.status) ? { ...value, status: 'paused' } : value);
    },
    resumeAll: async () => {
      calls.resume++; state.queuePaused = false;
      state.queue = state.queue.map((value) => value.status === 'failed' ? { ...value, status: 'queued' } : value);
    },
    cancelAll: async () => {
      calls.cancel++; state.queue = state.queue.map((value) => ['queued', 'downloading', 'paused'].includes(value.status)
        ? { ...value, status: 'cancelled', bytesWritten: 0 } : value);
    },
  };
  const colors = { text: '#fff', textSecondary: '#bbb', accent: '#0f0', danger: '#f77', border: '#333', surfaceHighlight: '#222' };
  const react = {
    memo: (component: unknown) => component,
    useRef: (value: unknown) => slot(() => ({ current: value })),
    useState: (value: unknown) => { const saved = slot(() => ({ value })); return [saved.value, (value: unknown) => { saved.value = value; }]; },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const saved = slot(() => ({ callback, deps: undefined as unknown[] | undefined }));
      if (!sameDeps(saved.deps, deps)) { saved.callback = callback; saved.deps = deps; }
      return saved.callback;
    },
    useMemo: (factory: () => unknown, deps: unknown[]) => {
      const saved = slot(() => ({ value: undefined as unknown, deps: undefined as unknown[] | undefined }));
      if (!sameDeps(saved.deps, deps)) { saved.value = factory(); saved.deps = deps; }
      return saved.value;
    },
    useEffect: (create: () => (() => void) | void, deps: unknown[]) => {
      const saved = slot(() => ({ deps: undefined as unknown[] | undefined }));
      if (sameDeps(saved.deps, deps)) return;
      saved.deps = deps; effects.push(() => { const close = create(); if (close) cleanups.push(close); });
    },
  };
  const scrollHandler = {};
  const dependencies: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@shopify/flash-list': { FlashList: 'QueueList' },
    'react-native': { ActivityIndicator: 'Spinner', Text: 'Text', View: 'View' },
    'react-native-reanimated': { __esModule: true, default: { createAnimatedComponent: (value: unknown) => value } },
    'zustand/react/shallow': { useShallow: (selector: unknown) => selector },
    '@/components/SettingsUI': { SettingRow: 'SettingRow', SettingsGroup: 'SettingsGroup', SettingsPage: 'SettingsPage',
      settingsStyles: { content: {}, sectionDescription: {}, sectionTitle: {} } },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => scrollHandler },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 200 },
    '@/i18n': { useT: () => (key: string, params?: Record<string, string | number>) =>
      key.replace(/\{(\w+)\}/g, (_match, name) => String(params?.[name] ?? '')) },
    '@/lib/format': { formatBytes },
    '@/store/auth': { useAuthStore: (select: (value: typeof auth) => unknown) => select(auth) },
    '@/store/downloads': { useDownloads: (select: (value: typeof state) => unknown) => select(state) },
    '@/store/settings': { useSettings: (select: (value: { language: string }) => unknown) => select({ language: 'en' }) },
    '@/theme': { colors, fontSize: {}, spacing: {}, radius: {}, useTheme() {},
      themed: (factory: (value: typeof colors) => Record<string, unknown>) => new Proxy({}, { get: (_target, key: string) => factory(colors)[key] }) },
  };
  const exported: Record<string, any> = {};
  runInNewContext(compiled, { exports: exported, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected download-manager import ${name}`); return dependencies[name];
  } });
  function render() { cursor = 0; tree = exported.default(); while (effects.length) effects.shift()!(); return tree; }
  render();
  const list = () => findAll(tree, (node) => node.type === 'QueueList')[0];
  return { state, auth, calls, colors, scrollHandler, render, tree: () => tree,
    list, action: (label: string) => findAll(tree, (node) => node.type === 'SettingRow' && node.props.label === label)[0],
    row: (value: QueueItem) => { const row = list().props.renderItem({ item: value }); return row.type(row.props); },
    pauseWork: (work: typeof pauseWork) => { pauseWork = work; }, unmount: () => cleanups.forEach((close) => close()),
  };
}

test('opening the queue is read-only and keeps a large queue on one stable virtual list', () => {
  const queue = Array.from({ length: 1200 }, (_, index) => item(String(index), 'queued'));
  const h = harness(queue), list = h.list();
  assert.equal(list.props.data, queue); assert.equal(list.props.maxItemsInRecyclePool, 32);
  assert.equal(list.props.onScroll, h.scrollHandler); assert.equal(list.props.scrollEventThrottle, 16);
  assert.equal(list.props.maintainVisibleContentPosition.disabled, true);
  assert.equal(findAll(h.tree(), (node) => node.type === 'Text' && node.props.children === 'Song 1199').length, 0,
    'row contents are delegated to the recycler rather than mapped into the page');
  const key = list.props.keyExtractor(queue[500]), renderRow = list.props.renderItem;
  h.state.queue = queue.map((value, index) => index === 500 ? { ...value, status: 'downloading' as const, bytesWritten: 50, bytesTotal: 100 } : value);
  h.render();
  assert.equal(h.list().props.keyExtractor(h.state.queue[500]), key);
  assert.equal(h.list().props.renderItem, renderRow);
  h.auth.auth = {}; h.render(); assert.deepEqual(h.calls, { pause: 0, resume: 0, cancel: 0 });
});

test('overall and per-song progress use real bytes and never invent a percentage for an unknown size', () => {
  const queue = [item('done', 'completed', 102400, 102400), item('live', 'downloading', 51200, 102400),
    item('unknown', 'downloading', 512000, 0), item('error', 'failed'), item('stop', 'cancelled')];
  queue[3].error = 'https://private.test/secret-token';
  const h = harness(queue), heading = h.list().props.ListHeaderComponent;
  const overall = findAll(heading, (node) => node.props.accessibilityLabel === 'Overall progress')[0];
  assert.equal(overall.props.accessibilityValue.now, 30, '1 completed + 0.5 known file, divided by all 5 tasks');
  assert.ok(text(heading).includes('1 of 5 songs downloaded')); assert.ok(text(heading).includes('650 KB received'));
  assert.ok(text(h.row(queue[1])).includes('50%'));
  const unknown = h.row(queue[2]);
  assert.ok(text(unknown).includes('500 KB received')); assert.ok(!text(unknown).includes('%'));
  const unknownProgress = findAll(unknown, (node) => node.props.accessibilityRole === 'progressbar')[0];
  assert.equal(unknownProgress.props.accessibilityValue.now, undefined);
  assert.ok(!text(h.row(queue[3])).includes('secret-token'), 'raw transport errors never leak through the failure row');
});

test('Pause, Start and Cancel call the real queue actions only after a user tap and reject repeated pending taps', async () => {
  const done = item('done', 'completed', 100, 100), h = harness([done, item('live', 'downloading', 20, 100)]);
  const gate = deferred(); h.pauseWork(() => gate.promise);
  const pause = h.action('Pause all').props.onPress; assert.equal(typeof pause, 'function');
  pause(); pause(); assert.equal(h.calls.pause, 1);
  h.render(); assert.equal(h.action('Cancel all').props.onPress, undefined);
  gate.resolve(); await tick(); h.render();
  assert.equal(h.state.queuePaused, true); h.action('Start all').props.onPress(); await tick(); h.render();
  assert.equal(h.calls.resume, 1);
  h.action('Cancel all').props.onPress(); await tick(); h.render();
  assert.equal(h.calls.cancel, 1); assert.equal(h.state.queue[0], done, 'cancelling unfinished work keeps completed files');
  assert.equal(h.action('Cancel all').props.onPress, undefined);
});

test('offline or missing-account queues cannot start, while stopping an existing transfer remains available', async () => {
  const h = harness([item('live', 'downloading', 30, 100)]);
  h.auth.offline = true; h.render(); assert.equal(h.action('Start all').props.onPress, undefined);
  assert.equal(typeof h.action('Pause all').props.onPress, 'function');
  assert.equal(typeof h.action('Cancel all').props.onPress, 'function');
  h.action('Pause all').props.onPress(); await tick(); h.auth.offline = false; h.auth.auth = null; h.render();
  assert.equal(h.action('Start all').props.onPress, undefined);
  const empty = harness(); assert.ok(text(empty.tree()).includes('No download tasks yet'));
  for (const action of ['Start all', 'Pause all', 'Cancel all']) assert.equal(empty.action(action).props.onPress, undefined);
});

test('Start all can explicitly retry an all-failed queue without reviving cancelled or completed downloads', async () => {
  const done = item('done', 'completed', 100, 100), stopped = item('stopped', 'cancelled');
  const h = harness([item('failed', 'failed'), stopped, done]);
  const start = h.action('Start all');
  assert.equal(typeof start.props.onPress, 'function');
  assert.ok(start.props.description.includes('retries failed songs'));
  start.props.onPress(); await tick(); h.render();
  assert.equal(h.calls.resume, 1); assert.equal(h.state.queue[0].status, 'queued');
  assert.equal(h.state.queue[1], stopped); assert.equal(h.state.queue[2], done);
});

test('queue text follows light and dark theme tokens, including a failed item without a raw error', () => {
  const h = harness([item('one', 'failed')]);
  let title = findAll(h.row(h.state.queue[0]), (node) => node.props.children === 'Song one')[0];
  assert.equal(title.props.style.color, '#fff');
  h.colors.text = '#111'; h.colors.textSecondary = '#444'; h.render();
  title = findAll(h.row(h.state.queue[0]), (node) => node.props.children === 'Song one')[0];
  assert.equal(title.props.style.color, '#111');
  const secondary = findAll(h.row(h.state.queue[0]), (node) => node.props.children === 'Artist')[0];
  assert.equal(secondary.props.style.color, '#444');
});
