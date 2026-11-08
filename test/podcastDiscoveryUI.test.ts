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
import { PODCAST_DIRECTORY_GENRES } from '../src/lib/podcastDirectory';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function load(file: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, AbortController, setTimeout, clearTimeout, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`); return imports[name];
  } }); return exports;
}
const channel = { id: 'show', title: 'Example show', feedUrl: 'https://feed.test/show.xml', author: 'Host' };
const show = { id: 101, title: 'Example show', author: 'Host', imageUrl: 'https://art.test/show.jpg', rank: 1 };
function harness(offline = false) {
  const auth = createStore(() => ({ auth: { username: 'A' }, offline, autoOffline: false }));
  const profile = () => auth.getState().auth.username;
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } } });
  const pushes: string[] = [], toasts: string[] = [], charts: any[] = [], searches: any[] = [], lookups: any[] = [], reads: string[] = [], refreshes: string[] = [], subscriptions: string[] = [], menus: any[] = [];
  let stored: any = channel, added = new Set<string>();
  let readChannel: () => Promise<any> = async () => profile() === 'A' ? channel : undefined;
  let lookup: () => Promise<any> = async () => ({ ...show, feedUrl: channel.feedUrl });
  let subscribe: () => Promise<any> = async () => { added = new Set([...added, channel.id]); return channel; };
  const FlatList = ({ data, renderItem, ListHeaderComponent, ListFooterComponent, ListEmptyComponent, ...props }: any) => React.createElement('List', { ...props, data },
    ListHeaderComponent, ...data.map((item: any, index: number) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item, index }))),
    data.length ? null : ListEmptyComponent, ListFooterComponent);
  const palette = { text: '#161616', textSecondary: '#666', textMuted: '#777', accent: '#a81950', onAccent: '#fff', background: '#fff', surfaceHighlight: '#eee', border: '#ddd' };
  const common: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime, '@tanstack/react-query': Query,
    'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', Pressable: 'Pressable', ActivityIndicator: 'Spinner', RefreshControl: 'RefreshControl', Linking: { openURL() {} } },
    'react-native-reanimated': { __esModule: true, default: { FlatList } },
    'expo-router': { useRouter: () => ({ push: (path: string) => pushes.push(path) }), useLocalSearchParams: () => ({ id: channel.id }),
      useFocusEffect: () => {} },
    '@/api/podcasts': {
      directoryCharts: async (...args: any[]) => { charts.push(args); return [show]; },
      directorySearch: async (...args: any[]) => { searches.push(args); return [{ ...show, feedUrl: channel.feedUrl }]; },
      directoryLookup: async (...args: any[]) => { lookups.push(args); return lookup(); },
      getStoredChannel: async (feed: string) => { reads.push(feed); return stored; },
      refreshChannel: async (feed: string) => { refreshes.push(feed); return channel; },
      getChannel: async () => readChannel(),
      listEpisodes: async () => [], playedEpisodeIds: async () => new Set(),
      addedChannelIds: async () => added,
      listAddedChannels: async () => [channel], refreshAll: async () => ({ failed: 0, total: 0 }),
      subscribe: async (feed: string) => { subscriptions.push(feed); return subscribe(); },
      podcastCover: (value: any) => value.imageUrl, episodeToSong: (value: any) => value,
    },
    '@/api/netGate': { isManualOffline: () => auth.getState().offline && !auth.getState().autoOffline },
    '@/components/BackChevron': { BackChevron: 'Back' }, '@/components/BackButton': { BackButton: 'Back' },
    '@/components/BrowseFrame': { BrowseFrame: 'BrowseFrame', useSearchBox: () => false }, '@/components/Cover': { Cover: 'Cover' },
    '@/components/PodcastAddSheet': { PodcastAddSheet: 'AddSheet' },
    '@/components/EmptyState': { EmptyState: 'EmptyState' }, '@/components/glass': { GlassPressable: 'Button' },
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/components/Message': { Message: 'Message' },
    '@/components/PodcastMenuSheet': { openPodcastMenu: (value: any) => menus.push(value), openPodcastEpisodeMenu() {} },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => undefined },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 150 }, '@/hooks/useScreenSize': { useListPadding: () => 20 },
    '@/hooks/usePodcastEpisodeSort': { usePodcastEpisodeSort: (episodes: any[]) => ({ episodes, openSort() {}, sortSheet: null }) },
    '@/hooks/useAppleMusicStyle': { useAppleMusicStyle: () => false }, '@/theme/appleMusic': { appleMusicStyles: {} },
    '@/i18n': { useT: () => (text: string, args: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(args[key])),
      episodesLabel: (n: number) => `${n} episodes` },
    '@/lib/podcastDirectory': { PODCAST_DIRECTORY_GENRES }, '@/lib/podcastFavorites': { usePodcastFavoriteIds: () => new Set() },
    '@/lib/listPerf': { listPerf: {} }, '@/lib/query': { queryClient: client }, '@/lib/format': { formatDuration: () => '' },
    '@/store/auth': { profileScopeId: profile, useAuthStore: auth },
    '@/store/toast': { useToast: (read: (value: any) => unknown) => read({ show: (text: string) => toasts.push(text) }) },
    '@/store/settings': { useSettings: (read: (value: any) => unknown) => read({ language: 'en' }) },
    '@/store/podcastDownloads': { usePodcastDownloads: (read: (value: any) => unknown) => read({ files: {} }) },
    '@/store/player': { currentSong: () => undefined, usePlayerStore: (read: (value: any) => unknown) => read({ playQueue() {} }) },
    '@/api/data': { COVER: { card: 500 }, coverArtUrl: (value: string) => value },
    '@/theme': { useTheme: () => palette, colors: palette, themed: (make: (value: any) => unknown) => make(palette),
      fontSize: { sm: 13, md: 16, lg: 20, xs: 11 }, spacing: { xs: 4, sm: 8, md: 12, lg: 20 }, radius: { pill: 100, lg: 20 }, tracking: { heading: 0 } },
  };
  let root!: ReactTestRenderer;
  const mount = async (detail: boolean | 'list' = false) => {
    const Screen = load(detail === 'list' ? '../src/app/podcasts.tsx' : detail ? '../src/app/podcast/[id].tsx' : '../src/app/podcast-discover.tsx', common).default;
    await act(async () => { root = create(React.createElement(Query.QueryClientProvider, { client }, React.createElement(Screen))); await turn(); });
    await act(async () => { await wait(5); });
  };
  const buttons = () => root.root.findAllByType('Button' as any);
  const button = (text: string) => buttons().find((value) => value.props.accessibilityLabel === text || value.findAllByType('Text' as any).some((node) => node.props.children === text));
  return { auth, client, pushes, toasts, charts, searches, lookups, reads, refreshes, subscriptions, menus, mount, button,
    tree: () => root, lookup: (next: typeof lookup) => { lookup = next; }, stored: (next: any) => { stored = next; },
    readChannel: (next: typeof readChannel) => { readChannel = next; },
    added: (ids: string[]) => { added = new Set(ids); }, subscribe: (next: typeof subscribe) => { subscribe = next; },
    close: async () => { await act(async () => root.unmount()); client.clear(); } };
}

test('the subscribed-shows screen links to discovery while retaining the existing RSS add sheet', async () => {
  const h = harness(); await h.mount('list');
  assert.equal(h.tree().root.findByType('AddSheet' as any).props.visible, false);
  await act(async () => { h.button('Add podcast')!.props.onPress(); });
  assert.equal(h.tree().root.findByType('AddSheet' as any).props.visible, true);
  await act(async () => { h.tree().root.findByType('AddSheet' as any).props.onCancel(); });
  await act(async () => { h.button('Discover podcasts')!.props.onPress(); });
  assert.deepEqual(h.pushes, ['/podcast-discover']); assert.equal(h.subscriptions.length, 0);
  await h.close();
});

test('directory UI changes chart category and region, debounces link searches and hides obsolete clickable results', async () => {
  const h = harness(); await h.mount();
  assert.equal(h.charts.length, 1); assert.equal(h.charts[0][0].country, 'us');
  assert.equal(PODCAST_DIRECTORY_GENRES.length, 19);
  assert.ok(PODCAST_DIRECTORY_GENRES.every((value) => h.button(value.key)));
  assert.equal(h.tree().root.findByType('Cover' as any).props.rounded, undefined, 'show artwork keeps square cover corners');
  await act(async () => { h.button('Science')!.props.onPress(); await turn(); });
  assert.equal(h.charts.at(-1)[0].genreId, 1533);
  await act(async () => { h.button('Podcast region')!.props.onPress(); });
  await act(async () => { h.button('Japan')!.props.onPress(); await turn(); });
  await act(async () => { await wait(5); });
  assert.equal(h.charts.at(-1)[0].country, 'jp');
  const search = h.tree().root.findByType('TextInput' as any);
  const stalePress = h.button('Preview Example show')!.props.onPress;
  await act(async () => { search.props.onChangeText('old'); search.props.onChangeText('https://podcasts.apple.com/jp/podcast/example/id101'); });
  assert.equal(h.searches.length, 0); assert.equal(h.button('Preview Example show'), undefined);
  await act(async () => { stalePress(); await turn(); });
  assert.equal(h.lookups.length, 0, 'a stale row callback cannot open while a new query is being typed');
  await act(async () => { await wait(380); await turn(); });
  await act(async () => { await wait(5); });
  assert.equal(h.searches.length, 1); assert.equal(h.searches[0][0], 'https://podcasts.apple.com/jp/podcast/example/id101');
  assert.equal(h.searches[0][1].country, 'jp');
  await act(async () => { h.button('Preview Example show')!.props.onPress(); await turn(); });
  assert.deepEqual(h.pushes, ['/podcast/show']); assert.equal(h.refreshes.length, 0); assert.equal(h.subscriptions.length, 0);
  await h.close();
});

test('opening a chart resolves just that show and previews the feed without subscribing', async () => {
  const h = harness(); h.stored(undefined); await h.mount();
  assert.equal(h.lookups.length, 0); assert.equal(h.refreshes.length, 0);
  await act(async () => { h.button('Preview Example show')!.props.onPress(); await turn(); });
  assert.equal(h.lookups.length, 1); assert.equal(h.lookups[0][0], 101);
  assert.deepEqual(h.refreshes, [channel.feedUrl]); assert.deepEqual(h.pushes, ['/podcast/show']);
  assert.equal(h.subscriptions.length, 0); await h.close();
});

test('offline discovery uses only cached metadata and stored feeds, while late lookup results cannot cross profiles or resume after offline', async () => {
  const offline = harness(true);
  offline.client.setQueryData(['podcastDirectory', 'A', 'us', 'all', ''], [{ ...show, feedUrl: channel.feedUrl }]);
  await offline.mount();
  assert.equal(offline.charts.length, 0); assert.equal(offline.searches.length, 0);
  await act(async () => { offline.button('Preview Example show')!.props.onPress(); await turn(); });
  assert.deepEqual(offline.pushes, ['/podcast/show']); assert.equal(offline.lookups.length, 0); assert.equal(offline.refreshes.length, 0);
  await offline.close();
  for (const change of ['account', 'offline', 'unmount'] as const) {
    const h = harness(), pending = deferred<any>(); h.lookup(() => pending.promise); h.stored(undefined); await h.mount();
    await act(async () => { h.button('Preview Example show')!.props.onPress(); await turn(); });
    assert.equal(h.lookups.length, 1);
    await act(async () => {
      if (change === 'account') { const before = h.auth.getState().auth; h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: before }); }
      else if (change === 'offline') h.auth.setState({ offline: true });
      else h.tree().unmount();
    });
    await act(async () => { pending.resolve({ ...show, feedUrl: channel.feedUrl }); await turn(); });
    assert.equal(h.refreshes.length, 0); assert.equal(h.pushes.length, 0); assert.equal(h.subscriptions.length, 0);
    if (change !== 'unmount') await h.close(); else h.client.clear();
  }
});

test('podcast preview has an explicit subscription action and uses membership rather than a stored feed to show its state', async () => {
  const h = harness(); await h.mount(true);
  assert.ok(h.button('Subscribe')); assert.equal(h.button('Subscribed'), undefined); assert.equal(h.subscriptions.length, 0);
  await act(async () => { h.button('Subscribe')!.props.onPress(); await turn(); });
  assert.deepEqual(h.subscriptions, [channel.feedUrl]); assert.ok(h.button('Subscribed'));
  await act(async () => { h.button('Subscribed')!.props.onPress(); });
  assert.deepEqual(h.menus, [channel]); assert.equal(h.subscriptions.length, 1);
  await h.close();
  const existing = harness(); existing.added([channel.id]); await existing.mount(true);
  assert.ok(existing.button('Subscribed')); assert.equal(existing.subscriptions.length, 0); await existing.close();
});

test('a podcast preview remains escapable while its local episode page is loading', async () => {
  const h = harness(), pending = deferred<any>(); h.readChannel(() => pending.promise); await h.mount(true);
  assert.equal(h.tree().root.findAllByType('Back' as any).length, 1);
  assert.equal(h.tree().root.findAllByType('Spinner' as any).length, 1);
  await act(async () => { pending.resolve(channel); await turn(); });
  await h.close();
});

test('subscription UI refuses offline and old-account callbacks and never projects a late subscribe into another profile', async () => {
  const offline = harness(true); await offline.mount(true);
  assert.equal(offline.button('Subscribe')!.props.disabled, true);
  await act(async () => { offline.button('Subscribe')!.props.onPress(); await turn(); });
  assert.equal(offline.subscriptions.length, 0); await offline.close();
  const h = harness(), pending = deferred<any>(); h.subscribe(() => pending.promise); await h.mount(true);
  const stalePress = h.button('Subscribe')!.props.onPress;
  await act(async () => { stalePress(); await turn(); });
  assert.equal(h.subscriptions.length, 1);
  await act(async () => { h.auth.setState({ auth: { username: 'B' } }); await turn(); });
  await act(async () => { stalePress(); pending.resolve(channel); await turn(); });
  assert.equal(h.subscriptions.length, 1); assert.equal(h.toasts.length, 0);
  assert.equal(h.client.getQueryData(['podcastChannels', 'added', 'B']) instanceof Set, true);
  assert.equal((h.client.getQueryData(['podcastChannels', 'added', 'B']) as Set<string>).has(channel.id), false);
  await h.close();
});

test('batched account and offline round trips release canceled preview and subscription busy states', async () => {
  for (const detail of [false, true]) for (const roundTrip of ['account', 'offline'] as const) {
    const h = harness(), pending = deferred<any>();
    if (roundTrip === 'offline') h.auth.setState({ offline: true, autoOffline: true });
    if (detail) h.subscribe(() => pending.promise); else h.lookup(() => pending.promise);
    try {
      await h.mount(detail);
      const label = detail ? 'Subscribe' : 'Preview Example show';
      await act(async () => { h.button(label)!.props.onPress(); await turn(); });
      assert.equal(h.button(label)!.props.disabled, true);
      await act(async () => {
        if (roundTrip === 'account') {
          const before = h.auth.getState().auth;
          h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: before });
        } else {
          h.auth.setState({ autoOffline: false }); h.auth.setState({ autoOffline: true });
        }
      });
      assert.equal(h.button(label)!.props.disabled, false, 'cancellation immediately releases busy state even if a native promise ignores abort');
      assert.equal(h.button(label)!.findAllByType('Spinner' as any).length, 0);
      await act(async () => { pending.resolve(detail ? channel : { ...show, feedUrl: channel.feedUrl }); await turn(); });
      assert.equal(h.button(label)!.props.disabled, false, `${detail ? 'subscription' : 'preview'} must leave busy state after ${roundTrip} cancellation`);
      assert.equal(h.button(label)!.findAllByType('Spinner' as any).length, 0);
      assert.equal(h.pushes.length, 0); assert.equal(h.toasts.length, 0);
    } finally { await h.close(); }
  }
});

test('a canceled preview or subscribe completion cannot clear the replacement request spinner', async () => {
  for (const detail of [false, true]) {
    const h = harness(), first = deferred<any>(), second = deferred<any>(); let calls = 0;
    const response = () => ++calls === 1 ? first.promise : second.promise;
    if (detail) h.subscribe(response); else h.lookup(response);
    try {
      await h.mount(detail);
      const label = detail ? 'Subscribe' : 'Preview Example show';
      await act(async () => { h.button(label)!.props.onPress(); await turn(); });
      await act(async () => {
        const before = h.auth.getState().auth;
        h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: before });
      });
      await act(async () => { h.button(label)!.props.onPress(); await turn(); });
      assert.equal(calls, 2); assert.equal(h.button(label)!.props.disabled, true);
      await act(async () => { first.resolve(detail ? channel : { ...show, feedUrl: channel.feedUrl }); await turn(); });
      assert.equal(h.button(label)!.props.disabled, true, 'the old finally must not release a newer request');
      assert.equal(h.button(label)!.findAllByType('Spinner' as any).length, 1);
      assert.equal(h.pushes.length, 0); assert.equal(h.toasts.length, 0);
      await act(async () => { second.resolve(detail ? channel : { ...show, feedUrl: channel.feedUrl }); await turn(); });
      if (detail) assert.ok(h.button('Subscribed')); else assert.deepEqual(h.pushes, ['/podcast/show']);
    } finally { await h.close(); }
  }
});
