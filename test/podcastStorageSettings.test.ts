import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { create as createStore } from 'zustand';

import { formatBytes } from '../src/lib/format';
import { SETTINGS_SEARCH_ENTRIES } from '../src/lib/settingsSearchEntries';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const element = React.createElement;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const usage = (audioBytes = 1000) => ({ audioBytes, coverBytes: 500, catalogBytes: 250,
  totalBytes: audioBytes + 750, audioCount: 2, coverCount: 3,
  databaseAllocatedBytes: 240, databaseFreeBytes: 80, databaseLiveBytes: 160 });
const cleared = { removedFiles: 2, removedBytes: 1000, removedRecords: 0, skippedInUse: 1, failedFiles: 0 };
const translate = (key: string, params?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_match, name) => String(params?.[name] ?? ''));

/** Mount the actual settings page and actual profile-epoch owner. Native
 * settings/dialog hosts and asynchronous storage IO are controlled boundaries. */
function harness() {
  const firstA = { id: 'A' };
  const auth = createStore(() => ({ auth: firstA as { id: string } | null,
    offline: false, autoOffline: false, offlineSource: null as object | null }));
  const profileScopeId = () => auth.getState().auth?.id ?? (auth.getState().offline ? 'local' : 'default');
  let focused = true, renderer!: ReactTestRenderer, lastCompletedAt = 0;
  const reads: { options: any; task: ReturnType<typeof deferred<ReturnType<typeof usage>>> }[] = [];
  const clears: { category: string; options: any; task: ReturnType<typeof deferred<typeof cleared>> }[] = [];
  const imports: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { View: 'View', Text: 'Text', ActivityIndicator: 'Spinner' },
    'expo-router': { useIsFocused: () => focused },
    '@/components/Dialog': { Dialog: 'Dialog' },
    '@/components/DockScrollView': { DockScrollView: 'ScrollView' },
    '@/components/SettingsUI': { SettingRow: 'SettingRow', SettingsPage: 'SettingsPage', SettingsGroup: 'SettingsGroup',
      settingsStyles: { content: {}, sectionTitle: {}, sectionDescription: {} } },
    '@/i18n': { useT: () => translate }, '@/lib/format': { formatBytes },
    '@/store/auth': { useAuthStore: auth, profileScopeId },
    '@/store/settings': { useSettings: (selector: (state: any) => unknown) => selector({ language: 'en' }) },
    '@/lib/podcastStorage': {
      getPodcastStorageUsage: (options: any) => { const task = deferred<ReturnType<typeof usage>>(); reads.push({ options, task }); return task.promise; },
      getPodcastStorageLastMaintenance: async () => ({ lastCompletedAt }),
      clearPodcastStorage: (category: string, options: any) => { const task = deferred<typeof cleared>(); clears.push({ category, options, task }); return task.promise; },
    },
    '@/theme': { useTheme() {}, spacing: { sm: 8 }, colors: { accent: '#1db954', text: '#ffffff' } },
  };
  function load(path: string) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, AbortController, require(name: string) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected podcast-storage settings dependency: ${name}`); return imports[name];
    } });
    return exports;
  }
  imports['@/lib/lyricOwner'] = load('src/lib/lyricOwner.ts');
  const Screen = load('src/app/settings/podcast-storage.tsx').default;
  const root = () => renderer.root;
  return { auth, firstA, reads, clears,
    async mount() { await act(async () => { renderer = create(element(Screen)); }); },
    async unmount() { await act(async () => { renderer?.unmount(); }); },
    row(label: string) { return root().findAll((node) => String(node.type) === 'SettingRow').find((node) => node.props.label === label)!; },
    dialog: () => root().findByType('Dialog' as any),
    alerts: () => root().findAllByProps({ accessibilityRole: 'alert' }).map((node) => node.props.children),
    texts: () => root().findAll((node) => String(node.type) === 'Text').map((node) => node.props.children),
    async resolveRead(index = reads.length - 1, value = usage()) { await act(async () => { reads[index].task.resolve(value); }); },
    async rejectRead(index = reads.length - 1) { await act(async () => { reads[index].task.reject(new Error('IO failed')); }); },
    async resolveClear(index = clears.length - 1, value = cleared) { await act(async () => { clears[index].task.resolve(value); }); },
    async rejectClear(index = clears.length - 1) { await act(async () => { clears[index].task.reject(new Error('Partial clear failed')); }); },
    async press(label: string) { await act(async () => { this.row(label).props.onPress?.(); }); },
    async confirm() { await act(async () => { this.dialog().props.onConfirm(''); }); },
    async focus(value: boolean) { focused = value; await act(async () => { renderer.update(element(Screen)); }); },
    last(value: number) { lastCompletedAt = value; },
  };
}

test('podcast storage measures all three categories and the current profile total offline, without starting cleanup', async () => {
  const h = harness();
  try {
    h.auth.setState({ auth: null, offline: true }); h.last(1_800_000_000_000);
    await h.mount();
    assert.equal(h.reads.length, 1); assert.equal(h.reads[0].options.expectedProfile, 'local');
    assert.equal(h.row('Total podcast storage').props.right, '…');
    assert.equal(h.row('Clear podcast audio downloads').props.onPress, undefined);
    await h.resolveRead();
    for (const [label, bytes] of [['Total podcast storage', 1750], ['Downloaded podcast audio', 1000],
      ['Offline podcast covers', 500], ['Cached podcast catalog', 250]] as const)
      assert.equal(h.row(label).props.right, formatBytes(bytes));
    assert.equal(h.row('Reusable catalog space').props.right, formatBytes(80));
    assert.match(h.row('Reusable catalog space').props.description, /Included in catalog size/);
    assert.equal(h.row('Total podcast storage').props.right, formatBytes(1750), 'reusable pages are not counted twice or advertised as already freed');
    assert.notEqual(h.row('Last automatic cleanup').props.right, 'Not yet');
    assert.equal(typeof h.row('Clear podcast audio downloads').props.onPress, 'function');
    assert.equal(h.clears.length, 0, 'opening or measuring this screen does not perform maintenance');
    assert.match(h.row('Finished automatic downloads').props.description, /24 hours after they are marked played/);
    assert.match(h.row('Finished automatic downloads').props.description, /Manual and existing downloads are kept/);
    assert.match(h.row('Cleanup schedule').props.description, /at most once every 24 hours/);
  } finally { await h.unmount(); }
});

test('all destructive categories require their own confirmation and preserve-data explanation; duplicate confirmation starts one clear', async () => {
  const h = harness();
  try {
    await h.mount(); await h.resolveRead();
    for (const label of ['Clear podcast audio downloads', 'Clear offline podcast covers', 'Clear rebuildable podcast catalog']) {
      await h.press(label); const dialog = h.dialog();
      assert.equal(dialog.props.visible, true); assert.equal(dialog.props.title, label); assert.equal(dialog.props.destructive, true);
      assert.match(dialog.props.message, /profile/); assert.match(dialog.props.message, /progress/);
      assert.match(dialog.props.message, /in use|playing/);
      await act(async () => { dialog.props.onCancel(); });
      assert.equal(h.clears.length, 0);
    }
    await h.press('Clear offline podcast covers');
    assert.match(h.dialog().props.message, /does not clear the app-wide image cache/);
    const confirm = h.dialog().props.onConfirm;
    await act(async () => { confirm(''); confirm(''); });
    assert.equal(h.clears.length, 1); assert.equal(h.clears[0].category, 'covers');
    assert.equal(h.clears[0].options.expectedProfile, 'A'); assert.equal(h.clears[0].options.current(), true);
    assert.equal(h.clears[0].options.signal, undefined, 'confirmed work is not aborted merely by leaving the route');
    assert.equal(h.row('Clear podcast audio downloads').props.onPress, undefined);
    await h.resolveClear(0, { ...cleared, removedRecords: 3, failedFiles: 1 });
    assert.ok(h.alerts().some((text) => /Deleted files: 2\. Database records: 3\./.test(text) && /In-use items kept: 1\. Failed files: 1\./.test(text)));
    assert.equal(h.reads.length, 2, 'usage is refreshed after clear completion');
    await h.resolveRead(1, usage(0));
    assert.equal(h.row('Downloaded podcast audio').props.right, formatBytes(0));
  } finally { await h.unmount(); }
});

test('measurement failures can be retried and a failed clear is not reported as a successful deletion', async () => {
  const h = harness();
  try {
    await h.mount(); await h.rejectRead();
    assert.ok(h.alerts().includes("Couldn't measure podcast storage. Try again."));
    await h.press('Refresh storage usage'); assert.equal(h.reads.length, 2);
    await h.resolveRead(); await h.press('Clear rebuildable podcast catalog'); await h.confirm();
    await h.rejectClear();
    assert.ok(h.alerts().some((text) => /some items may already have been removed/.test(text)));
    assert.equal(h.texts().some((text) => String(text).startsWith('Deleted files:')), false);
    await h.resolveRead();
    assert.ok(h.alerts().some((text) => /some items may already have been removed/.test(text)), 'remeasurement must not hide an incomplete-clear warning');
  } finally { await h.unmount(); }
});

test('a batched account A-B-A invalidates its dialog and pending measurements even when A auth identity returns', async () => {
  const h = harness();
  try {
    await h.mount(); await h.resolveRead(); await h.press('Clear podcast audio downloads');
    const oldConfirm = h.dialog().props.onConfirm;
    await h.press('Refresh storage usage');
    const oldRead = h.reads[1];
    await act(async () => { h.auth.setState({ auth: { id: 'B' } }); h.auth.setState({ auth: h.firstA }); });
    assert.equal(h.dialog().props.visible, false); assert.equal(oldRead.options.signal.aborted, true);
    assert.equal(oldRead.options.current(), false);
    await act(async () => { oldConfirm(''); oldRead.task.resolve(usage(999_999)); });
    assert.equal(h.clears.length, 0); assert.equal(h.row('Downloaded podcast audio').props.right, '…');
    await h.resolveRead();
    assert.equal(h.row('Downloaded podcast audio').props.right, formatBytes(1000));
  } finally { await h.unmount(); }
});

test('confirmed cleanup outlives the screen but its late completion never publishes or remeasures an unmounted UI', async () => {
  const h = harness();
  await h.mount(); await h.resolveRead(); await h.press('Clear podcast audio downloads'); await h.confirm();
  const operation = h.clears[0];
  await h.unmount();
  assert.equal(h.reads[0].options.signal.aborted, true);
  assert.equal(operation.options.current(), true, 'only account ownership guards the accepted clear');
  assert.equal(operation.options.signal, undefined);
  operation.task.resolve(cleared); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.reads.length, 1);
});

test('old-account cleanup completion cannot replace another profile usage, clear its busy state or show its result', async () => {
  const h = harness();
  try {
    await h.mount(); await h.resolveRead(); await h.press('Clear podcast audio downloads'); await h.confirm();
    const old = h.clears[0];
    await act(async () => { h.auth.setState({ auth: { id: 'B' } }); });
    assert.equal(old.options.current(), false);
    await h.resolveRead(1, usage(8000));
    const beforeReads = h.reads.length;
    await h.resolveClear(0);
    assert.equal(h.row('Downloaded podcast audio').props.right, formatBytes(8000));
    assert.equal(h.texts().some((text) => String(text).startsWith('Deleted files:')), false);
    assert.equal(h.reads.length, beforeReads);
    assert.equal(typeof h.row('Clear podcast audio downloads').props.onPress, 'function');
  } finally { await h.unmount(); }
});

test('leaving focus aborts only measurement and returning reads fresh local usage', async () => {
  const h = harness();
  try {
    await h.mount(); const read = h.reads[0];
    await h.focus(false); assert.equal(read.options.signal.aborted, true);
    await h.focus(true); assert.equal(h.reads.length, 2);
    await act(async () => { read.task.resolve(usage(9999)); });
    assert.equal(h.row('Total podcast storage').props.right, '…');
    await h.resolveRead(); assert.equal(h.row('Total podcast storage').props.right, formatBytes(1750));
    assert.equal(h.clears.length, 0);
  } finally { await h.unmount(); }
});

test('settings search exposes the real bilingual podcast-storage page and category clear actions', () => {
  const entries = SETTINGS_SEARCH_ENTRIES.filter((entry) => entry.route === '/settings/podcast-storage');
  assert.ok(entries.some((entry) => entry.title === 'Podcast storage' && entry.chinese === '播客存储'));
  for (const title of ['Clear podcast audio downloads', 'Clear offline podcast covers', 'Clear rebuildable podcast catalog'])
    assert.ok(entries.some((entry) => entry.title === title && entry.anchor === title));
});

test('the actual main settings and downloads screens both keep the podcast-storage entry usable offline', async () => {
  const paths: string[] = [], native = { View: 'View', Text: 'Text', Pressable: 'Pressable' };
  const colors = { text: '#ffffff', textSecondary: '#aaaaaa', accent: '#1db954' };
  const settingState: Record<string, any> = { language: 'en', downloadBitRate: 0, downloadConcurrency: 2,
    songCache: false, songCacheLimitGb: 1, appFont: 'system' };
  const auth = { auth: null, offline: true, logout() {}, goOnline() {}, goOffline() {} };
  const downloadState = { hydrated: true, files: {}, usageBytes: async () => 0, clearAll: async () => {} };
  const Icon = Object.assign(() => null, { glyphMap: {} });
  const imports: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSXRuntime, 'react-native': native,
    'expo-router': { useRouter: () => ({ push: (path: string) => paths.push(path), replace() {} }) },
    'expo-file-system': { Paths: { totalDiskSpace: 0, availableDiskSpace: 0 } },
    '@/components/DockScrollView': { DockScrollView: 'ScrollView' },
    '@/components/Dialog': { Dialog: 'Dialog' },
    '@/components/glass': { GlassSurface: 'GlassSurface', GlassSwitch: 'GlassSwitch', GlassPressable: 'GlassPressable' },
    '@/components/Icon': { __esModule: true, default: Icon },
    '@/components/SettingsUI': { SETTINGS_ROW_LAYOUT: {}, ScreenHeader: 'ScreenHeader', SettingsSafeArea: 'SettingsSafeArea',
      SettingRow: 'SettingRow', SettingsPage: 'SettingsPage', SettingsGroup: 'SettingsGroup', SelectList: 'SelectList', SwitchList: 'SwitchList', settingsStyles: {} },
    '@/i18n': { useT: () => translate, albumsLabel: String, playlistsLabel: String, songsLabel: String },
    '@/lib/appStorage': { appStorageParts: () => ({}), appStorageTotal: () => 0 },
    '@/lib/format': { formatBytes },
    '@/store/auth': { useAuthStore: (select: (state: any) => unknown) => select(auth) },
    '@/store/downloads': { useDownloads: (select: (state: any) => unknown) => select(downloadState), anyDownloads: () => false },
    '@/store/libraryMirror': { useLibraryMirror: { getState: () => ({ stats: async () => null }) } },
    '@/store/settings': { useSettings: (select: (state: any) => unknown) => select(settingState),
      BITRATE_OPTIONS: [], DOWNLOAD_CONCURRENCY_OPTIONS: [], SONG_CACHE_LIMITS_GB: [], TRANSCODE_FORMATS: [] },
    '@/store/songCache': { useSongCache: (select: (state: any) => unknown) => select({ entries: {} }), cacheBytes: () => 0 },
    '@/store/toast': { useToast: (select: (state: any) => unknown) => select({ show() {} }) },
    '@/theme': { colors, useTheme: () => ({ accent: colors.accent }), fontSize: {}, radius: {}, spacing: {}, tracking: {},
      themed: (factory: (value: any) => unknown) => factory(colors) },
  };
  for (const path of ['index', 'downloads']) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/app/settings/${path}.tsx`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(element(exports.default)); });
      const entry = path === 'index'
        ? renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => node.findAll((child) => String(child.type) === 'Text' && child.props.children === 'Podcast storage').length > 0)!
        : renderer.root.findAll((node) => String(node.type) === 'SettingRow').find((node) => node.props.label === 'Podcast storage')!;
      assert.ok(entry, `${path} keeps the row in a local offline profile`);
      assert.notEqual(entry.props.disabled, true);
      await act(async () => { entry.props.onPress(); });
    } finally { await act(async () => { renderer?.unmount(); }); }
  }
  assert.deepEqual(paths, ['/settings/podcast-storage', '/settings/podcast-storage']);
});
