import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

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
    'react-native': { Text: 'Text', View: 'View', ActivityIndicator: 'Spinner' },
    'zustand/react/shallow': { useShallow: (selector: unknown) => selector },
    '@/components/DockScrollView': { DockScrollView: 'ScrollView' },
    '@/components/SettingsUI': { SettingRow: 'SettingRow', SettingsGroup: 'SettingsGroup', SettingsPage: 'SettingsPage',
      SwitchList: 'SwitchList', settingsStyles: { sectionDescription: {}, sectionTitle: {}, content: {} } },
    '@/i18n': { useT: () => (key: string, params?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_m, name) => String(params?.[name] ?? '')) },
    '@/store/auth': { useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth) },
    '@/store/settings': { useSettings: (selector: (state: { language: string }) => unknown) => selector({ language: 'en' }) },
    '@/store/bulkMediaCache': { useBulkMediaCache: (selector: (value: typeof state) => unknown) => selector(state) },
    '@/theme': { colors, fontSize: {}, spacing: {}, themed: (factory: (value: typeof colors) => unknown) => factory(colors), useTheme() {} },
  };
  const exports: Record<string, any> = {};
  runInNewContext(compiled, { exports, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  function render() { cursor = 0; tree = exports.default(); while (effects.length) effects.shift()!(); return tree; }
  render();
  return { state, auth, calls, render, tree: () => tree,
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
  assert.equal(h.row('Continue').props.onPress, undefined);
  assert.equal(h.row('Scan selected items').props.onPress, undefined);
  assert.equal(h.row('Retry failed items only').props.onPress, undefined);
  assert.match(h.row('Paused').props.description, /Wi-Fi/);
  h.auth.offline = false; h.state.status = 'idle'; h.render();
  for (let index = 0; index < 3; index++) { h.options()[index].onChange(false); h.render(); }
  assert.equal(h.row('Scan selected items').props.onPress, undefined);
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
