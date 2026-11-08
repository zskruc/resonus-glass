/** Actual episode screen, native show notes and queue adapter with controlled platform I/O. */
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
import * as chapters from '../src/lib/podcastChapters';
import * as notes from '../src/lib/podcastShowNotes';
import * as playback from '../src/lib/podcastEpisodePlayback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
function load(file: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, AbortController, setTimeout, clearTimeout, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  } }); return exports;
}
function harness() {
  const auth = createStore<any>(() => ({ auth: { username: 'A' }, offline: false, autoOffline: false }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth.username };
  const owner = load('../src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const query = new Query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const episode = { id: 'feed/episode', channelId: 'feed', title: 'An episode', url: 'https://audio.test/episode.mp3', duration: 3600,
    descriptionHtml: '<h2>Topics</h2><p>00:30 Introduction and <a href="https://publisher.test/info">details</a></p>',
    chaptersUrl: 'https://publisher.test/chapters.json', chapters: [{ startSec: 0, title: 'Embedded start' }] };
  const channel = { id: 'feed', title: 'A show', feedUrl: 'https://publisher.test/rss', imageUrl: 'https://publisher.test/cover.jpg' };
  query.setQueryData(['podcastEpisodeDetail', 'A', episode.id, channel.id], { episode, channel });
  const source = ts.createSourceFile('podcasts.ts', readFileSync(new URL('../src/api/podcasts.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const adapter: Record<string, any> = {};
  const adapterSource = source.statements.filter((node) => ts.isFunctionDeclaration(node) && ['episodeToSong', 'podcastCover'].includes(node.name?.text ?? '')
    || ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => decl.name.getText(source) === 'SUFFIXES'))
    .map((node) => node.getText(source)).join('\n');
  runInNewContext(ts.transpileModule(adapterSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: adapter });
  let seekVersion = 0, focused = true;
  const queued: any[] = [], seeks: number[] = [], links: string[] = [], errors: string[] = [];
  const player = createStore<any>(() => ({ queue: [], index: 0, isPlaying: false, isBuffering: false,
    playQueue: async (queue: any[], index: number, title: string, origin: string) => {
      queued.push({ queue, title, origin }); player.setState({ queue, index, isPlaying: true }); return true;
    }, seekTo: (seconds: number) => { seekVersion++; seeks.push(seconds); }, toggle: () => player.setState({ isPlaying: !player.getState().isPlaying }),
  }));
  const native = { View: 'View', Text: 'Text', ActivityIndicator: 'Spinner', Linking: { openURL: async (url: string) => { links.push(url); } },
    FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent }: any) => React.createElement('List', {}, ListHeaderComponent,
      ...(data.length ? data.map((item: any, index: number) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))) : [ListEmptyComponent])),
  };
  const palette = { accent: '#05f', onAccent: '#fff', text: '#fff', textSecondary: '#ddd', textMuted: '#aaa', background: '#111', surfaceHighlight: '#444' };
  const theme = { colors: palette, fontSize: { sm: 12, md: 16, lg: 20 }, spacing: { sm: 4, md: 8, lg: 16, xl: 24 }, radius: { pill: 50 }, themed: (fn: any) => fn(palette), useTheme: () => {} };
  const common = { react: React, 'react/jsx-runtime': JSXRuntime, 'react-native': native, '@/theme': theme };
  const showNotes = load('../src/components/PodcastShowNotes.tsx', common);
  const requests: { signal: AbortSignal; url: string }[] = [];
  let request: (url: string, init: any) => Promise<any> = async () => ({ ok: true, headers: { get: () => null }, text: async () => '{"chapters":[{"startTime":90,"title":"Remote topic"}]}' });
  const Screen = load('../src/app/podcast-episode/[id].tsx', { ...common,
    'expo/fetch': { fetch: async (url: string, init: any) => { requests.push({ url, signal: init.signal }); return request(url, init); } },
    '@tanstack/react-query': Query,
    'expo-router': { useIsFocused: () => focused, useLocalSearchParams: () => ({ id: episode.id, channelId: channel.id }), useRouter: () => ({ push() {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20 }) },
    '@/api/podcasts': adapter, '@/api/netGate': { isManualOffline: () => auth.getState().offline && !auth.getState().autoOffline },
    '@/components/BackChevron': { BackChevron: 'Back' }, '@/components/Cover': { Cover: 'Cover' },
    '@/components/glass': { GlassPressable: 'Button' }, '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/components/Message': { Message: 'Message' },
    '@/components/PodcastShowNotes': showNotes, '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => () => {} },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 180 }, '@/i18n': { useT: () => (key: string, args: any = {}) => key.replace(/\{(\w+)\}/g, (_: string, name: string) => String(args[name])) },
    '@/lib/lyricOwner': owner, '@/lib/localLibrary': { hashKey: (value: string) => value }, '@/lib/podcastChapters': chapters,
    '@/lib/podcastDb': { getEpisode: async () => null, getChannel: async () => null }, '@/lib/podcastEpisodePlayback': playback,
    '@/lib/podcastShowNotes': notes, '@/lib/query': { queryClient: query }, '@/store/auth': authModule,
    '@/store/player': { usePlayerStore: player, currentSong: (state: any) => state.queue[state.index], playbackUserSeekVersion: () => seekVersion },
    '@/store/podcastDownloads': { podcastFile: () => undefined }, '@/store/settings': { useSettings: (selector: any) => selector({ language: 'en' }) },
    '@/store/toast': { useToast: (selector: any) => selector({ show: (error: string) => errors.push(error) }) },
  }).default;
  const tree = () => React.createElement(Query.QueryClientProvider, { client: query }, React.createElement(Screen));
  return { query, tree, auth, episode, channel, queued, seeks, links, errors, requests,
    request: (work: typeof request) => { request = work; }, blur: () => { focused = false; } };
}
function button(root: ReactTestRenderer, label: string) {
  const text = root.root.findAllByType('Text' as any).find((node) => node.props.children === label)!;
  let target = text.parent; while (target && (target.type as unknown) !== 'Button') target = target.parent;
  assert.ok(target, label); return target;
}

test('the actual episode screen renders safe notes, keeps chapters opt-in, and timestamp/chapter actions queue the RSS identity then seek', async () => {
  const h = harness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(h.tree()); });
    assert.equal(button(root, 'Play').props.style.backgroundColor, '#05f', 'the action has an explicit contrasting fill even when the glass material is transparent');
    assert.match(JSON.stringify(root.toJSON()), /Introduction/); assert.equal(h.requests.length, 0);
    await act(async () => { root.root.findAllByType('Text' as any).find((node) => node.props.children === '00:30')!.props.onPress(); });
    assert.deepEqual(h.seeks, [30]); assert.equal(h.queued[0].queue[0].id, h.episode.id);
    assert.equal(h.queued[0].queue[0].url, h.episode.url); assert.equal(h.queued[0].queue[0].podcastChannelId, 'feed');
    await act(async () => { button(root, 'Chapters').props.onPress(); }); assert.equal(h.requests.length, 0);
    assert.match(JSON.stringify(root.toJSON()), /Embedded start/);
    await act(async () => { button(root, 'Load chapters').props.onPress(); await turn(); await turn(); });
    assert.equal(h.requests.length, 1); assert.match(JSON.stringify(root.toJSON()), /Remote topic/);
    await act(async () => { button(root, 'Remote topic').props.onPress(); }); assert.deepEqual(h.seeks, [30, 90]);
    assert.equal(h.queued.length, 1, 'same accepted episode seeks directly without reloading its audio'); assert.deepEqual(h.errors, []);
  } finally { await act(async () => root?.unmount()); h.query.clear(); }
});

test('leaving the actual episode screen cancels a hung chapter read and prevents its result or tap from reaching another profile', async () => {
  const h = harness(); h.request(async () => new Promise(() => {})); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(h.tree()); });
    await act(async () => { button(root, 'Chapters').props.onPress(); });
    await act(async () => { button(root, 'Load chapters').props.onPress(); await turn(); }); assert.equal(h.requests.length, 1);
    const stalePlay = root.root.findByProps({ accessibilityLabel: 'Play' }).props.onPress;
    await act(async () => { h.auth.setState({ auth: { username: 'B' } }); await turn(); });
    assert.equal(h.requests[0].signal.aborted, true); assert.doesNotMatch(JSON.stringify(root.toJSON()), /An episode|Introduction|Embedded start/);
    await act(async () => { stalePlay(); }); assert.deepEqual(h.queued, []); assert.deepEqual(h.seeks, []);
  } finally { await act(async () => root?.unmount()); h.query.clear(); }
});
