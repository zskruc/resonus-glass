import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as Query from '@tanstack/react-query';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import * as documents from '../src/lib/lyricDocuments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, setTimeout, clearTimeout, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  } }); return exports;
}
const song = { id: 'song', title: 'Song', artist: 'Singer' };
const lyrics = { synced: true, lines: [{ start: 1000, value: 'Original line', translation: '现有译文' }] };
const candidate = { id: 'server', kind: 'server', lyrics };
function harness() {
  const auth = createStore(() => ({ auth: { username: 'A' }, offline: false, autoOffline: false, offlineSource: null as any }));
  const profile = () => auth.getState().auth.username;
  const display = createStore(() => ({ profile: 'A', mode: 'both', ready: true, error: false,
    save: async (_profile: string, mode: string) => { display.setState({ mode }); return true; }, hydrate: async () => {} }));
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(['lyricCandidates', 'A', 'song'], [candidate]);
  const selects: any[] = [], lookups: any[] = [], toasts: string[] = [];
  let fail = false;
  const FlatList = ({ data, renderItem, ListHeaderComponent, ListFooterComponent }: any) => React.createElement('List', {},
    ListHeaderComponent, ...data.map((item: any, index: number) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))), ListFooterComponent);
  const common: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSXRuntime, '@tanstack/react-query': Query,
    'react-native': { Text: 'Text', View: 'View', FlatList, ActivityIndicator: 'Spinner' },
    '@/hooks/useLyricToolSong': { useLyricToolSong: () => { auth((state) => state.auth); return { profile: 'A', song: profile() === 'A' ? song : null }; } },
    '@/hooks/useLyricDisplay': { useLyricDisplayMode: () => display((state) => state.mode) },
    '@/hooks/useLyrics': { useLyrics: () => ({ data: lyrics }) },
    '@/i18n': { useT: () => (value: string) => value },
    '@/lib/localLibrary': { hashKey: (value: string) => value, folderSetKey: (values: string[]) => values.join('|') },
    '@/lib/lyricOwner': { captureLyricOwner: (scope: string) => { const owner = auth.getState().auth; return () => auth.getState().auth === owner && profile() === scope; } },
    '@/lib/lyricDocuments': documents,
    '@/lib/query': { queryClient: client }, '@/store/auth': { useAuthStore: auth, profileScopeId: profile },
    '@/store/lyricDisplay': { useLyricDisplay: display }, '@/store/toast': { useToast: { getState: () => ({ show: (text: string) => toasts.push(text) }) } },
    '@/api/lyricSources': { getLyricCandidates: async (...args: any[]) => { lookups.push(args); return [candidate]; } },
    '@/lib/lyricLibraryDb': { chosenLyricSource: async () => null, selectLyricCandidate: async (...args: any[]) => {
      if (fail) throw new Error('full'); selects.push(args); } },
    '@/components/glass': { GlassPressable: 'GlassPressable' },
    '@/components/SettingsUI': { SettingsPage: 'SettingsPage', SettingsGroup: 'SettingsGroup', SettingRow: 'SettingRow' },
    'expo-router': { useRouter: () => ({ back() {} }), useIsFocused: () => true },
    '@/theme': { useTheme() {}, themed: (read: any) => read({ text: '#fff', textSecondary: '#ccc' }), colors: { text: '#fff', accent: '#f00', onAccent: '#fff' },
      fontSize: { sm: 13, md: 16, lg: 20 }, spacing: { sm: 8, md: 12, lg: 20 }, radius: { pill: 100 } },
  };
  const Screen = load('../src/app/settings/lyric-sources.tsx', common).default;
  let root!: ReactTestRenderer;
  const mount = async () => { await act(async () => { root = create(React.createElement(Query.QueryClientProvider, { client }, React.createElement(Screen))); await turn(); });
    await act(async () => { await turn(); }); };
  const row = (label: string) => root.root.findAllByType('SettingRow' as any).find((node) => node.props.label === label)!;
  const button = (text: string) => root.root.findAllByType('GlassPressable' as any).find((node) => node.findAllByType('Text' as any).some((child) => child.props.children === text))!;
  return { auth, display, client, selects, lookups, toasts, common, mount, row, button, tree: () => root,
    fail: (value: boolean) => { fail = value; }, close: async () => { await act(async () => root.unmount()); client.clear(); } };
}

test('the real source picker previews before saving, updates only the pinned song and keeps a failed choice visible for retry', async () => {
  const h = harness(); await h.mount();
  assert.ok(h.lookups.every((args) => !args[2].server && !args[2].provider), 'opening the page never opts into provider search');
  await act(async () => { h.row('Server lyrics').props.onPress(); });
  assert.match(JSON.stringify(h.tree().toJSON()), /Original line/); assert.match(JSON.stringify(h.tree().toJSON()), /现有译文/);
  assert.equal(h.selects.length, 0, 'preview does not silently change playback lyrics');
  h.fail(true); await act(async () => { await h.button('Use these lyrics').props.onPress(); await turn(); });
  assert.equal(h.selects.length, 0); assert.match(JSON.stringify(h.tree().toJSON()), /previous choice has been kept/);
  h.fail(false); await act(async () => { await h.button('Use these lyrics').props.onPress(); await turn(); });
  assert.equal(h.selects.length, 1); assert.equal(h.selects[0][0], 'A'); assert.equal(h.selects[0][1], song); assert.equal(h.selects[0][2], candidate);
  assert.equal(h.row('Server lyrics').props.right, '✓'); assert.equal(h.toasts.length, 1);
  await act(async () => { h.row('Original and translation').props.onPress(); await turn(); });
  assert.equal(h.display.getState().mode, 'translation'); await h.close();
});

test('the picker hides an old account preview and refuses its queued save callback after profile replacement', async () => {
  const h = harness(); await h.mount(); await act(async () => { h.row('Server lyrics').props.onPress(); });
  const stalePress = h.button('Use these lyrics').props.onPress;
  await act(async () => { h.auth.setState({ auth: { username: 'B' } }); });
  assert.doesNotMatch(JSON.stringify(h.tree().toJSON()), /Original line|现有译文/);
  await act(async () => { stalePress(); await turn(); }); assert.equal(h.selects.length, 0); await h.close();
});

test('cached lyric query filters old-folder IDs with current SQL and typing never restarts a file/index walk', async () => {
  const h = harness(); h.auth.setState({ offline: true, offlineSource: { mode: 'folder', uris: ['folder-A'] } });
  let query = 'hello', indexReads = 0, lookups = 0;
  const imports = { ...h.common, '@/store/downloads': { activeServerDir: () => null },
    '@/lib/lyricLibraryDb': { indexSavedLyricsPage: async () => { indexReads++; return false; },
      searchCachedLyrics: async () => [{ song: { id: 'old', title: 'Removed' }, excerpt: 'hello' }, { song, excerpt: 'hello' }] },
    '@/lib/recommendationPlaybackSource': { currentRecommendationSongs: async () => { lookups++; return new Map([[song.id, song]]); } } };
  const hook = load('../src/hooks/useCachedLyricSearch.ts', imports).useCachedLyricSearch;
  let latest: any;
  function Screen() { latest = hook(query); return React.createElement('Search', {}); }
  const view = () => React.createElement(Query.QueryClientProvider, { client: h.client }, React.createElement(Screen));
  let root!: ReactTestRenderer;
  await act(async () => { root = create(view()); await turn(); }); await act(async () => { await turn(); });
  assert.deepEqual(Array.from(latest.data, (item: any) => item.song.id), ['song']);
  const firstReads = indexReads;
  for (const value of ['hell', 'world', '译文']) { query = value; await act(async () => { root.update(view()); await turn(); }); }
  assert.equal(indexReads, firstReads, 'keystrokes only query FTS, never scan cache documents/files'); assert.ok(lookups >= 3);
  await act(async () => { h.auth.setState({ offlineSource: { mode: 'folder', uris: ['folder-B'] } }); await turn(); });
  const keys = h.client.getQueryCache().getAll().map((entry) => JSON.stringify(entry.queryKey));
  assert.ok(keys.some((key) => key.includes('folder-A')) && keys.some((key) => key.includes('folder-B')));
  await act(async () => root.unmount()); h.client.clear();
});
