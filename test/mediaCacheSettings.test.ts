import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { create as createStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Element = { type: unknown; props: Record<string, any> };
const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
function find(tree: any, predicate: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) { for (const child of tree) { const match = find(child, predicate); if (match) return match; } }
  else if (tree?.props) return predicate(tree) ? tree : find(tree.props.children, predicate);
}
const kinds = ['lyrics', 'albumCovers', 'artistCovers'];
const compiled = ts.transpileModule(readFileSync(new URL('../src/app/settings/media-cache.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness() {
  let cursor = 0, tree: Element;
  const slots: any[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const slot = (create: () => any) => { const index = cursor++; return index in slots ? slots[index] : slots[index] = create(); };
  const calls = { load: 0, start: [] as string[][], pause: 0, resume: 0, cancel: 0, retry: 0 };
  const auth = { auth: {} as object | null, offline: false };
  const platform = { OS: 'android' };
  const stats = Object.fromEntries(kinds.map((kind) => [kind, { total: 20, success: 4, cached: 5, missing: 2, failed: 1, pending: 8 }]));
  const state = { status: 'idle', reason: null as string | null, phase: null as string | null, stats,
    selected: [...kinds], error: null as string | null, hydrated: true,
    load: async () => { calls.load++; },
    start: async (selected: string[]) => { calls.start.push([...selected]); state.selected = [...selected]; state.status = 'running'; },
    pause: () => { calls.pause++; state.status = 'paused'; state.reason = 'user'; },
    resume: async () => { calls.resume++; state.status = 'running'; },
    cancel: () => { calls.cancel++; state.status = 'cancelled'; },
    retryFailed: async () => { calls.retry++; state.status = 'running'; },
  };
  const react = {
    useRef: (value: unknown) => slot(() => ({ current: value })),
    useState: (initial: unknown) => { const saved = slot(() => ({ value: initial })); return [saved.value, (value: unknown) => { saved.value = value; }]; },
    useEffect: (create: () => (() => void) | void, deps: unknown[]) => {
      const saved = slot(() => ({ deps: undefined as unknown[] | undefined }));
      if (saved.deps?.every((value: unknown, index: number) => Object.is(value, deps[index]))) return;
      saved.deps = deps;
      effects.push(() => { const close = create(); if (close) cleanups.push(close); });
    },
  };
  const colors = { text: '#fff', textSecondary: '#aaa', accent: '#0f0', control: '#333', danger: '#f00' };
  const dependencies: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', ActivityIndicator: 'Spinner', Platform: platform },
    'zustand/react/shallow': { useShallow: (selector: unknown) => selector },
    '@/components/DockScrollView': { DockScrollView: 'ScrollView' },
    '@/components/SettingsUI': { SettingRow: 'SettingRow', SettingsGroup: 'SettingsGroup', SettingsPage: 'SettingsPage',
      SwitchList: 'SwitchList', settingsStyles: { sectionDescription: {}, sectionTitle: {}, content: {} } },
    '@/i18n': { useT: () => (key: string, params?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_m, name) => String(params?.[name] ?? '')) },
    '@/store/auth': { useAuthStore: Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), { getState: () => auth }) },
    '@/store/settings': { useSettings: (selector: (state: { language: string }) => unknown) => selector({ language: 'en' }) },
    '@/store/bulkMediaCache': { useBulkMediaCache: (selector: (value: typeof state) => unknown) => selector(state) },
    '@/theme': { colors, fontSize: {}, spacing: {}, themed: (factory: (value: typeof colors) => unknown) => factory(colors), useTheme() {} },
  };
  const exports: Record<string, any> = {};
  runInNewContext(compiled, { exports, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  function render() { cursor = 0; tree = exports.default(); while (effects.length) effects.shift()!(); return tree; }
  render();
  return { state, auth, calls, platform, render, tree: () => tree,
    row: (label: string) => find(tree, (node) => node.type === 'SettingRow' && node.props.label === label)!,
    options: () => find(tree, (node) => node.type === 'SwitchList')!.props.options,
    unmount: () => cleanups.forEach((close) => close()) };
}

test('opening or changing account only reads the saved task and never starts or resumes network work', () => {
  const h = harness();
  assert.equal(h.calls.load, 1);
  assert.deepEqual(h.calls.start, []);
  assert.equal(h.calls.resume, 0);
  h.auth.auth = {}; h.render();
  assert.equal(h.calls.load, 2);
  assert.deepEqual(h.calls.start, []);
  assert.equal(h.calls.resume, 0);
});

test('explicit selection and Start are required, and running tasks retain pause and cancel controls', () => {
  const h = harness();
  h.options()[2].onChange(false); h.render();
  h.row('Scan selected items').props.onPress(); h.render();
  assert.deepEqual(h.calls.start, [['lyrics', 'albumCovers']]);
  assert.equal(h.row('Scan selected items'), undefined);
  assert.ok(h.options().every((option: any) => option.disabled));
  h.row('Pause').props.onPress(); h.render();
  assert.equal(h.calls.pause, 1);
  h.options()[1].onChange(false); h.render();
  h.row('Continue').props.onPress(); h.render();
  assert.equal(h.calls.resume, 1);
  assert.deepEqual(h.state.selected, ['lyrics', 'albumCovers'], 'Continue must preserve the saved task selection');
  h.row('Cancel task').props.onPress(); h.render();
  assert.equal(h.calls.cancel, 1);
});

test('offline or empty selection cannot start a scan, and failed-item retry needs an explicit tap', () => {
  const h = harness();
  h.auth.offline = true; h.state.status = 'paused'; h.state.reason = 'wifi'; h.render();
  for (const action of ['Continue', 'Scan selected items', 'Retry failed items only']) h.row(action).props.onPress();
  h.render();
  assert.equal(h.calls.resume + h.calls.retry + h.calls.start.length, 0);
  assert.ok(find(h.tree(), (node) => node.props.accessibilityRole === 'alert'
    && node.props.children === 'Return online to start or continue this task.'));
  assert.match(h.row('Paused').props.description, /Wi-Fi/);
  h.auth.offline = false; h.state.status = 'idle'; h.render();
  for (let index = 0; index < 3; index++) { h.options()[index].onChange(false); h.render(); }
  h.row('Scan selected items').props.onPress(); h.render();
  assert.ok(find(h.tree(), (node) => node.props.accessibilityRole === 'alert'
    && node.props.children === 'Choose at least one item type.'));
  h.row('Retry failed items only').props.onPress();
  assert.equal(h.calls.retry, 1);
  assert.deepEqual(h.calls.start, []);
});

test('progress uses all outcomes and displays unavailable separately from failed requests', () => {
  const h = harness();
  const progress = find(h.tree(), (node) => node.props.accessibilityRole === 'progressbar' && node.props.accessibilityLabel === 'Lyrics')!;
  assert.deepEqual({ ...progress.props.accessibilityValue }, { min: 0, max: 20, now: 12, text: '12 of 20' });
  assert.ok(find(h.tree(), (node) => node.type === 'Text' && node.props.children === 'Unavailable at source'));
  assert.ok(find(h.tree(), (node) => node.type === 'Text' && node.props.children === 'Failed'));
  assert.ok(find(h.tree(), (node) => node.type === 'Text' && node.props.children === 'Already cached'));
});

test('Android protection loss keeps Continue available and explains background recovery separately from connection errors', () => {
  const h = harness(); h.state.status = 'paused'; h.state.reason = 'background';
  h.state.error = 'Background cache protection stopped'; h.render();
  assert.match(h.row('Paused').props.description, /Background caching was interrupted/);
  const alert = find(h.tree(), (node) => node.props.accessibilityRole === 'alert');
  assert.match(alert!.props.children, /Background caching could not continue/);
  assert.equal(typeof h.row('Continue').props.onPress, 'function');
  assert.equal(h.calls.resume, 0);
  h.state.error = null; h.platform.OS = 'ios'; h.render();
  assert.match(h.row('Paused').props.description, /Paused while the app was in the background/);
  assert.equal(find(h.tree(), (node) => node.type === 'Text'
    && String(node.props.children).startsWith('Caching continues with the screen locked')), undefined);
});

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mountedHarness() {
  const auth = createStore<{ auth: object | null; offline: boolean }>(() => ({ auth: {}, offline: false }));
  const calls = { load: 0, start: 0, pause: 0, resume: 0, cancel: 0, retry: 0 };
  const stats = Object.fromEntries(kinds.map((kind) => [kind,
    { total: 10, success: 2, cached: 2, missing: 1, failed: 1, pending: 4 }]));
  const task = createStore<any>(() => ({
    status: 'idle', reason: null, phase: null, stats, selected: [...kinds], error: null, hydrated: true,
    load: async () => { calls.load++; },
    start: async () => { calls.start++; },
    pause: () => { calls.pause++; task.setState({ status: 'paused', reason: 'user' }); },
    resume: async () => { calls.resume++; task.setState({ status: 'running' }); },
    cancel: () => { calls.cancel++; task.setState({ status: 'cancelled' }); },
    retryFailed: async () => { calls.retry++; },
  }));
  const colors = { text: '#fff', textSecondary: '#aaa', accent: '#0f0', control: '#333', danger: '#f00' };
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { Text: 'text', View: 'view', ActivityIndicator: 'spinner', Platform: { OS: 'android' } },
    'zustand/react/shallow': { useShallow },
    '@/components/DockScrollView': { DockScrollView: 'scroll' },
    '@/components/SettingsUI': { SettingRow: 'setting-row', SettingsGroup: 'group', SettingsPage: 'page',
      SwitchList: 'switch-list', settingsStyles: { sectionDescription: {}, sectionTitle: {}, content: {} } },
    '@/i18n': { useT: () => (key: string, params?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_m, name) => String(params?.[name] ?? '')) },
    '@/store/auth': { useAuthStore: auth },
    '@/store/settings': { useSettings: (select: (state: { language: string }) => unknown) => select({ language: 'en' }) },
    '@/store/bulkMediaCache': { useBulkMediaCache: task },
    '@/theme': { colors, fontSize: {}, spacing: {}, themed: (factory: (value: typeof colors) => unknown) => factory(colors), useTheme() {} },
  };
  const exports: Record<string, any> = {};
  runInNewContext(compiled, { exports, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  } });
  let renderer!: ReactTestRenderer;
  return { auth, task, calls,
    mount: async () => { await act(async () => { renderer = create(React.createElement(exports.default)); }); },
    unmount: async () => { await act(async () => { renderer?.unmount(); }); },
    row: (label: string) => renderer.root.findAll((node) => String(node.type) === 'setting-row').find((row) => row.props.label === label),
    alerts: () => renderer.root.findAllByProps({ accessibilityRole: 'alert' }).map((node) => node.props.children),
    spinners: () => renderer.root.findAll((node) => String(node.type) === 'spinner').length,
  };
}

test('mounted bulk-cache actions explain offline and missing-account taps without starting work', async () => {
  const h = mountedHarness();
  try {
    await h.mount();
    assert.equal(h.calls.start + h.calls.resume + h.calls.retry, 0);
    await act(async () => { h.auth.setState({ offline: true }); h.task.setState({ status: 'paused' }); });
    for (const label of ['Scan selected items', 'Continue', 'Retry failed items only']) {
      await act(async () => { h.row(label)!.props.onPress(); });
      assert.ok(h.alerts().includes('Return online to start or continue this task.'));
    }
    assert.equal(h.calls.start + h.calls.resume + h.calls.retry, 0);
    await act(async () => { h.auth.setState({ auth: null, offline: false }); });
    await act(async () => { h.row('Scan selected items')!.props.onPress(); });
    assert.ok(h.alerts().includes('Connect to a server to start.'));
    assert.equal(h.calls.start + h.calls.resume + h.calls.retry, 0);
  } finally { await h.unmount(); }
});

test('mounted Start immediately acknowledges preparation, deduplicates taps, then retains Pause and Continue while the worker promise is pending', async () => {
  const h = mountedHarness(), preparing = deferred(), working = deferred();
  h.task.setState({ start: async () => {
    h.calls.start++; await preparing.promise;
    h.task.setState({ status: 'discovering' }); await working.promise;
  }, resume: async () => { h.calls.resume++; h.task.setState({ status: 'running' }); await working.promise; } });
  try {
    await h.mount();
    const press = h.row('Scan selected items')!.props.onPress;
    await act(async () => { press(); press(); });
    assert.equal(h.calls.start, 1, 'the guard works even before React commits the first tap');
    assert.ok(h.row('Loading…')); assert.equal(h.spinners(), 1);
    assert.equal(h.row('Scan selected items')!.props.onPress, undefined);
    await act(async () => { preparing.resolve(); });
    assert.ok(h.row('Scanning the entire library…'));
    assert.equal(h.row('Loading…'), undefined);
    await act(async () => { h.row('Pause')!.props.onPress(); });
    assert.equal(h.calls.pause, 1);
    assert.equal(typeof h.row('Continue')!.props.onPress, 'function', 'old start promise does not lock out resuming a paused task');
    await act(async () => { h.row('Continue')!.props.onPress(); });
    assert.equal(h.calls.resume, 1);
    assert.equal(typeof h.row('Pause')!.props.onPress, 'function');
    await act(async () => { working.resolve(); });
  } finally { preparing.resolve(); working.resolve(); await h.unmount(); }
});

test('an old preparation failure cannot alter a replacement account or an unmounted settings page', async () => {
  const h = mountedHarness(), old = deferred();
  h.task.setState({ start: async () => { h.calls.start++; await old.promise; } });
  try {
    await h.mount();
    await act(async () => { h.row('Scan selected items')!.props.onPress(); });
    assert.ok(h.row('Loading…'));
    await act(async () => { h.auth.setState({ auth: {} }); });
    assert.equal(h.row('Loading…'), undefined);
    assert.equal(typeof h.row('Scan selected items')!.props.onPress, 'function');
    await act(async () => { old.reject(new Error('Previous account failed')); });
    assert.deepEqual(h.alerts(), []);
    const leaving = deferred();
    await act(async () => { h.task.setState({ start: async () => { await leaving.promise; } }); });
    await act(async () => { h.row('Scan selected items')!.props.onPress(); });
    await h.unmount();
    await act(async () => { leaving.reject(new Error('Page already left')); });
  } finally { await h.unmount(); }
});

test('a failed preparation clears its loading state and leaves the explicit retry action available', async () => {
  const h = mountedHarness(), pending = deferred();
  h.task.setState({ start: async () => { h.calls.start++; await pending.promise; } });
  try {
    await h.mount();
    await act(async () => { h.row('Scan selected items')!.props.onPress(); });
    assert.ok(h.row('Loading…')); assert.equal(h.spinners(), 1);
    await act(async () => { pending.reject(new Error('Preparation failed')); });
    assert.equal(h.row('Loading…'), undefined); assert.equal(h.spinners(), 0);
    assert.ok(h.alerts().includes("Couldn't complete the action. Check your connection and try again."));
    assert.equal(typeof h.row('Scan selected items')!.props.onPress, 'function');
    assert.equal(h.calls.start, 1, 'no retry is started without another explicit tap');
  } finally { await h.unmount(); }
});
