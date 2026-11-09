import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import ts from 'typescript';
import { chapterAt, parseLocalChapters, CHAPTER_IMPORT_MAX_BYTES } from '../src/lib/localChapters';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const turn = () => new Promise<void>((done) => setImmediate(done));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
function harness() {
  const a = { username: 'A' }, auth = createStore(() => ({ auth: a })); let epoch = 0;
  auth.subscribe(() => { epoch++; });
  const player = createStore(() => ({ queue: [{ id: 'song', title: 'Track', duration: 100 }], index: 0, durationSec: 100, positionSec: 20, chapterStop: null }));
  const calls = { saves: [] as any[], reads: 0, deletes: [] as string[], stops: [] as any[] };
  const source = { sessions: {}, links: [], chapters: {} };
  let size = 30, pick = async (): Promise<any> => ({ canceled: false, assets: [{ uri: 'file:///cache/chapters.txt', name: 'chapters.txt' }] });
  const row = ({ children, ...props }: any) => React.createElement('Row', props, children);
  const FlatList = ({ data, renderItem, ListHeaderComponent, ...props }: any) => React.createElement('List', props, ListHeaderComponent, ...data.map((item: any, index: number) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))));
  const identity = (key: string) => key;
  const imports: Record<string, unknown> = { react: React, 'react/jsx-runtime': JSXRuntime, '@tanstack/react-query': { useQuery },
    'expo-router': { useLocalSearchParams: () => ({}) }, 'react-native': { ActivityIndicator: 'Spinner', Text: 'Text', View: 'View', Pressable: 'Button', FlatList },
    'expo-document-picker': { getDocumentAsync: () => pick() },
    'expo-file-system/legacy': { cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' }, getInfoAsync: async () => ({ exists: true, isDirectory: false, size }),
      readAsStringAsync: async () => { calls.reads++; return '00:00 Introduction\n00:30 Second'; }, deleteAsync: async (uri: string) => { calls.deletes.push(uri); } },
    '@/api/data': { getSong: async () => player.getState().queue[0] },
    '@/components/SettingsUI': { SettingsPage: 'Page', SettingsGroup: 'Group', SettingRow: row, settingsStyles: {} },
    '@/hooks/useListeningTools': { useListeningToolsSource: () => ({ source, pending: false, error: null }) },
    '@/lib/lyricOwner': { captureLyricOwner: (expected = auth.getState().auth.username) => { const ticket = epoch; return () => ticket === epoch && auth.getState().auth.username === expected; } },
    '@/lib/localChapters': { chapterAt, parseLocalChapters, CHAPTER_IMPORT_MAX_BYTES }, '@/lib/format': { formatDuration: String }, '@/lib/localLibrary': { hashKey: identity },
    '@/lib/podcastDb': { getEpisode: async () => ({ id: 'song', channelId: 'show', chapters: [{ title: 'Publisher', startSec: 0, endSec: 100 }] }) },
    '@/store/auth': { useAuthStore: auth, profileScopeId: () => auth.getState().auth.username },
    '@/store/listeningTools': { mutateListeningSource: async (change: (value: any) => any) => { calls.saves.push(change(source)); return true; } },
    '@/store/player': { usePlayerStore: player, currentSong: (state: any) => state.queue[state.index], cancelChapterStop: () => {}, stopAfterChapter: (...args: any[]) => { calls.stops.push(args); return true; } },
    '@/store/toast': { useToast: (select: any) => select({ show: () => {} }) }, '@/i18n': { useT: () => identity }, '@/theme': { colors: {}, spacing: { md: 12 }, useTheme: () => ({}) },
  };
  const module: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/settings/chapters.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports: module, require: (id: string) => { assert.ok(Object.hasOwn(imports, id), id); return imports[id]; } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); let root!: ReactTestRenderer;
  return { calls, auth, setPick: (value: typeof pick) => { pick = value; }, setSize: (value: number) => { size = value; },
    row: (label: string) => root.root.findAllByType('Row' as any).find((node) => node.props.label === label),
    async mount() { await act(async () => { root = create(React.createElement(QueryClientProvider, { client }, React.createElement(module.default))); await turn(); }); },
    async press(label: string) { await act(async () => { root.root.findAllByType('Row' as any).find((node) => node.props.label === label)!.props.onPress(); await turn(); }); },
    async close() { await act(async () => root.unmount()); client.clear(); },
  };
}
test('mounted chapter manager previews a bounded file and saves only after Apply', async () => {
  const h = harness(); await h.mount(); await h.press('Import TXT / JSON chapters');
  assert.equal(h.calls.reads, 1); assert.equal(h.calls.saves.length, 0); assert.ok(h.row('Apply chapter import'));
  await h.press('Apply chapter import'); assert.equal(h.calls.saves.length, 1);
  assert.equal(h.calls.saves[0].chapters.song.chapters[1].start, 30);
  assert.deepEqual(h.calls.deletes, ['file:///cache/chapters.txt']); await h.close();
});
test('oversized and late ABA chapter pickers cannot publish or overwrite another account', async () => {
  const big = harness(); big.setSize(CHAPTER_IMPORT_MAX_BYTES + 1); await big.mount(); await big.press('Import TXT / JSON chapters');
  assert.equal(big.calls.reads, 0); assert.equal(big.calls.saves.length, 0); await big.close();
  const h = harness(), wait = deferred<any>(); h.setPick(() => wait.promise); await h.mount(); await h.press('Import TXT / JSON chapters');
  const original = h.auth.getState().auth;
  await act(async () => { h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: original }); });
  await act(async () => { wait.resolve({ canceled: false, assets: [{ uri: 'file:///cache/late.txt', name: 'late.txt' }] }); await turn(); });
  assert.equal(h.calls.reads, 0); assert.equal(h.calls.saves.length, 0); assert.equal(h.row('Apply chapter import'), undefined); await h.close();
});
