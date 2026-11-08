import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import * as OPML from '../src/lib/podcastOPML';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const turn = () => new Promise<void>((done) => setImmediate(done));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const xml = '<opml><body><outline title="Old" xmlUrl="https://feeds.test/old"/><outline title="New" xmlUrl="https://feeds.test/new"/></body></opml>';

function harness() {
  const auth = createStore(() => ({ auth: { username: 'one', password: 'never-export-account-password' }, offline: false, autoOffline: false }));
  const calls = { picked: [] as unknown[], stats: [] as string[], reads: [] as string[], deleted: [] as string[], writes: [] as { file: string; text: string }[], shares: [] as any[], subscribed: [] as string[], imported: 0, closed: 0 };
  let pick = async (): Promise<any> => ({ canceled: false, assets: [{ uri: 'file:///cache/DocumentPicker/shows.opml', name: 'shows.opml', size: xml.length }] });
  let size = xml.length;
  let added = async (): Promise<any[]> => [{ id: 'old', title: 'Old', feedUrl: 'https://feeds.test/old' }];
  let subscribe = async (feed: string, options: any) => { assert.equal(options.current(), true); return { id: feed.split('/').at(-1)! }; };
  const palette = { text: '#fff', textSecondary: '#aaa', danger: '#f66', accent: '#e56', onAccent: '#fff', surfaceHighlight: '#333' };
  const FlatList = ({ data, renderItem, ListHeaderComponent, ...props }: any) => React.createElement('List', props, ListHeaderComponent,
    ...data.map((item: any) => React.createElement(React.Fragment, { key: item.entry.feedUrl }, renderItem({ item }))));
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { ActivityIndicator: 'Spinner', FlatList, Modal: 'Modal', Text: 'Text', View: 'View' },
    'expo-document-picker': { getDocumentAsync: (options: unknown) => { calls.picked.push(options); return pick(); } },
    'expo-file-system/legacy': { cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' },
      getInfoAsync: async (uri: string) => { calls.stats.push(uri); return { exists: true, size, isDirectory: false }; },
      readAsStringAsync: async (uri: string) => { calls.reads.push(uri); return xml; },
      deleteAsync: async (uri: string) => { calls.deleted.push(uri); }, makeDirectoryAsync: async () => {},
      writeAsStringAsync: async (file: string, text: string) => { calls.writes.push({ file, text }); } },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (...args: unknown[]) => { calls.shares.push(args); } },
    '@/api/podcasts': { listAddedChannels: () => added(), subscribe: (feed: string, options: unknown) => { calls.subscribed.push(feed); return subscribe(feed, options); } },
    '@/api/netGate': { isManualOffline: () => auth.getState().offline && !auth.getState().autoOffline },
    '@/components/glass': { GlassPressable: 'Button' }, '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/MenuGlassCard': { MenuGlassCardFrame: 'Frame', MenuGlassCardHeader: 'Header' },
    '@/i18n': { useT: () => (key: string, values: Record<string, unknown> = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(values[name])) },
    '@/lib/listPerf': { listPerf: {} }, '@/lib/podcastOPML': OPML,
    '@/store/auth': { useAuthStore: auth, profileScopeId: () => auth.getState().auth.username },
    '@/theme': { colors: palette, useTheme: () => palette, themed: (make: (colors: unknown) => unknown) => make(palette),
      fontSize: { sm: 13 }, radius: { pill: 100 }, spacing: { sm: 8, md: 12 } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/podcast/PodcastOPMLManager.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, AbortController, require(id: string) { assert.ok(Object.hasOwn(imports, id), id); return imports[id]; } });
  let root!: ReactTestRenderer;
  function Host() {
    const [visible, show] = React.useState(true);
    return React.createElement(exports.PodcastOPMLManager, { visible, onClose: () => { calls.closed++; show(false); }, onImported: () => { calls.imported++; } });
  }
  const button = (label: string) => root.root.findAllByType('Button' as any).find((node) => node.props.accessibilityLabel === label);
  return { auth, calls, button, tree: () => root,
    setPick(value: typeof pick) { pick = value; }, setSize(value: number) { size = value; }, setAdded(value: typeof added) { added = value; }, setSubscriber(value: typeof subscribe) { subscribe = value; },
    async mount() { await act(async () => { root = create(React.createElement(Host)); }); },
    async press(label: string) { await act(async () => { button(label)!.props.onPress(); await turn(); }); },
    async close() { await act(async () => root.unmount()); },
  };
}

test('the mounted manager chooses a cache copy, previews without subscribing and imports only new rows', async () => {
  const h = harness(); await h.mount(); await h.press('Choose OPML file');
  assert.equal(h.calls.reads.length, 1); assert.equal(h.calls.subscribed.length, 0);
  assert.deepEqual(h.calls.deleted, ['file:///cache/DocumentPicker/shows.opml']);
  assert.ok(h.button('Import new subscriptions'));
  await h.press('Import new subscriptions');
  assert.deepEqual(h.calls.subscribed, ['https://feeds.test/new']); assert.equal(h.calls.imported, 1);
  assert.equal(h.button('Import new subscriptions'), undefined); await h.close();
});

test('oversized files are rejected before reading, and provider originals are not deleted', async () => {
  const h = harness(); h.setSize(OPML.PODCAST_OPML_MAX_BYTES + 1); await h.mount(); await h.press('Choose OPML file');
  assert.equal(h.calls.reads.length, 0); assert.equal(h.calls.subscribed.length, 0); await h.close();
  const provider = harness(); provider.setPick(async () => ({ canceled: false, assets: [{ uri: 'content://provider/original.opml', size: xml.length }] }));
  await provider.mount(); await provider.press('Choose OPML file');
  assert.equal(provider.calls.reads.length, 1); assert.equal(provider.calls.deleted.length, 0); await provider.close();
});

test('late picker returns cannot cross an account ABA and only their generated cache copy is cleaned', async () => {
  const h = harness(), picked = deferred<any>(); h.setPick(() => picked.promise); await h.mount();
  await h.press('Choose OPML file'); const first = h.auth.getState().auth;
  await act(async () => { h.auth.setState({ auth: { ...first, username: 'two' } }); h.auth.setState({ auth: first }); });
  await act(async () => { picked.resolve({ canceled: false, assets: [{ uri: 'file:///cache/DocumentPicker/late.opml', size: xml.length }] }); await turn(); });
  assert.equal(h.calls.closed, 1); assert.equal(h.calls.reads.length, 0); assert.equal(h.calls.subscribed.length, 0);
  assert.deepEqual(h.calls.deleted, ['file:///cache/DocumentPicker/late.opml']); await h.close();
});

test('export works offline and shares only OPML metadata with credential-bearing feeds excluded', async () => {
  const h = harness(); h.auth.setState({ offline: true });
  h.setAdded(async () => [{ id: 'a', title: 'Public', feedUrl: 'https://feeds.test/a' },
    { id: 'b', title: 'Private', feedUrl: 'https://feeds.test/b?token=never-export-feed-secret' }]);
  await h.mount(); await h.press('Export subscriptions');
  assert.equal(h.calls.shares.length, 1); assert.match(h.calls.writes[0].file, /^file:\/\/\/cache\/podcast-opml\/.*\.opml$/);
  assert.match(h.calls.writes[0].text, /https:\/\/feeds.test\/a/); assert.doesNotMatch(h.calls.writes[0].text, /never-export|feeds.test\/b/);
  assert.equal(h.calls.deleted.length, 0, 'the receiving app can still read the accepted share');
  assert.equal(h.calls.subscribed.length, 0); await h.close();
});

test('a late export metadata read cannot write or share another account snapshot', async () => {
  const h = harness(), read = deferred<any[]>(); h.setAdded(() => read.promise); await h.mount(); await h.press('Export subscriptions');
  await act(async () => { h.auth.setState({ auth: { username: 'two', password: 'different' } }); });
  await act(async () => { read.resolve([{ id: 'a', title: 'Old account', feedUrl: 'https://feeds.test/a' }]); await turn(); });
  assert.equal(h.calls.writes.length + h.calls.shares.length, 0); await h.close();
});

test('rapid double import taps admit one batch and keep the running operation visible', async () => {
  const h = harness(), read = deferred<{ id: string }>(); h.setSubscriber(() => read.promise);
  await h.mount(); await h.press('Choose OPML file');
  await act(async () => { const press = h.button('Import new subscriptions')!.props.onPress; press(); press(); await turn(); });
  assert.equal(h.calls.subscribed.length, 1); assert.ok(h.button('Stop import'));
  await act(async () => { read.resolve({ id: 'new' }); await turn(); });
  assert.equal(h.calls.imported, 1); await h.close();
});
