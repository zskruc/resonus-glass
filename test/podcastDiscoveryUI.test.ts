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
import { PODCAST_DIRECTORY_GENRES, normalizePodcastDirectoryCountry } from '../src/lib/podcastDirectory';
import * as resume from '../src/lib/episodeResume';
import * as presentation from '../src/lib/podcastPresentation';
import { defaultDiscoveryPreferences } from '../src/lib/discoveryPreferences';
import { defaultCustomizationBoundary } from './helpers/defaultCustomizationBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function load(file: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, AbortController, URL, setTimeout, clearTimeout, require(name: string) { const customization = defaultCustomizationBoundary(name); if (customization) return customization;
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`); return imports[name];
  } }); return exports;
}
const channel = { id: 'show', title: 'Example show', feedUrl: 'https://feed.test/show.xml', author: 'Host' };
const show = { id: 101, title: 'Example show', author: 'Host', imageUrl: 'https://art.test/show.jpg', rank: 1 };
function harness(offline = false) {
  const auth = createStore(() => ({ auth: { username: 'A' }, offline, autoOffline: false }));
  const profile = () => auth.getState().auth.username;
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } } });
  const pushes: any[] = [], attempts: any[] = [], toasts: string[] = [], charts: any[] = [], searches: any[] = [], lookups: any[] = [], reads: string[] = [], refreshes: string[] = [], subscriptions: string[] = [], menus: any[] = [];
  let stored: any = channel, added = new Set<string>(), pushFails = false;
  const focus = createStore(() => ({ active: true }));
  let route: Record<string, string> = { id: channel.id };
  const pages: any[] = [], fullReads: string[] = [], queues: any[][] = [], progressReads: any[][] = [], currentEpisodeReads: string[] = [];
  let progressRead: (...args: any[]) => Promise<any[]> = async () => [];
  let playing: any, isPlaying = false, toggles = 0;
  let allEpisodes: any[] = [], pageRead: (id: string, options: any, owner: any) => Promise<any> = async (_id, options) => ({
    items: allEpisodes.slice(options.offset, options.offset + options.limit), total: allEpisodes.length,
    nextOffset: options.offset + options.limit < allEpisodes.length ? options.offset + options.limit : undefined, seasons: [],
  });
  let refresh: (options?: any) => Promise<any> = async () => channel;
  let preferredOrder = 'recent';
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
    'expo-router': { useRouter: () => ({ push: (path: any) => { attempts.push(path); if (pushFails) throw new Error('Navigation unavailable'); pushes.push(path); } }), useLocalSearchParams: () => route, useIsFocused: () => focus((state) => state.active),
      useFocusEffect: (effect: () => (() => void) | undefined) => { const active = focus((state) => state.active); React.useEffect(() => active ? effect() : undefined, [active, effect]); } },
    '@/api/podcasts': {
      directoryCharts: async (...args: any[]) => { charts.push(args); return [show]; },
      directorySearch: async (...args: any[]) => { searches.push(args); return [{ ...show, feedUrl: channel.feedUrl }]; },
      directoryLookup: async (...args: any[]) => { lookups.push(args); return lookup(); },
      getStoredChannel: async (feed: string) => { reads.push(feed); return stored; },
      refreshChannel: async (feed: string, options?: any) => { refreshes.push(feed); return refresh(options); },
      getChannel: async () => readChannel(),
      listEpisodes: async (id: string) => { fullReads.push(id); return allEpisodes; }, playedEpisodeIds: async () => new Set(),
      listEpisodePage: async (...args: [string, any, any]) => { pages.push(args); return pageRead(...args); },
      getPodcastEpisode: async (id: string) => { currentEpisodeReads.push(id); return allEpisodes.find((episode) => episode.id === id); },
      addedChannelIds: async () => added,
      listAddedChannels: async () => [channel], refreshAll: async () => ({ failed: 0, total: 0 }),
      subscribe: async (feed: string) => { subscriptions.push(feed); return subscribe(); },
      podcastCover: (value: any) => value.imageUrl, episodeToSong: (value: any) => value,
    },
    '@/api/netGate': { isManualOffline: () => auth.getState().offline && !auth.getState().autoOffline },
    '@/store/discoveryPreferences': { useDiscoveryPreferences: () => ({ profile: profile(), data: defaultDiscoveryPreferences(), loaded: true }) },
    '@/components/discovery/MediaCollectionFilter': { MediaCollectionFilter: 'CollectionFilter', matchesMediaCollection: () => true },
    '@/components/BackChevron': { BackChevron: 'Back' }, '@/components/BackButton': { BackButton: 'Back' },
    '@/components/BrowseFrame': { BrowseFrame: 'BrowseFrame', useSearchBox: () => false }, '@/components/Cover': { Cover: 'Cover' },
    '@/components/PodcastAddSheet': { PodcastAddSheet: 'AddSheet' },
    '@/components/podcast/PodcastOPMLManager': { PodcastOPMLManager: 'OPMLManager' },
    '@/components/podcast/PodcastEpisodeRow': { PodcastEpisodeRow: 'EpisodeRow' },
    '@/components/podcast/PodcastDetailView': { PodcastDetailView: (props: any) => React.createElement('DetailView', props,
      React.createElement('Back'), React.createElement('Text', null, props.channel.title),
      props.episodes.length ? null : props.empty, props.footer, props.actions({ ...palette, playLabel: '#222', controlFill: '#eee' }), props.toolbar(palette), props.filters({ ...palette, playLabel: '#222', controlFill: '#eee' }),
      ...props.episodes.map((episode: any, index: number) => React.createElement(React.Fragment, { key: episode.id }, props.renderEpisode(episode, index, palette)))) },
    '@/components/PodcastDownloadDialog': { PodcastDownloadDialog: 'DownloadDialog' },
    '@/components/EmptyState': { EmptyState: 'EmptyState' }, '@/components/glass': { GlassPressable: 'Button' },
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/components/Message': { Message: 'Message' },
    '@/components/PodcastMenuSheet': { openPodcastMenu: (value: any) => menus.push(value), openPodcastEpisodeMenu() {} },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => undefined },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 150 }, '@/hooks/useScreenSize': { useListPadding: () => 20 },
    '@/hooks/usePodcastEpisodeSort': { usePodcastEpisodeSort: (episodes: any[]) => ({ episodes, order: preferredOrder, openSort() {}, sortSheet: null }) },
    '@/hooks/useAppleMusicStyle': { useAppleMusicStyle: () => false }, '@/theme/appleMusic': { appleMusicStyles: {} },
    '@/i18n': { useT: () => (text: string, args: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(args[key])),
      episodesLabel: (n: number) => `${n} episodes` },
    '@/lib/podcastDirectory': { PODCAST_DIRECTORY_GENRES, normalizePodcastDirectoryCountry }, '@/lib/podcastFavorites': { usePodcastFavoriteIds: () => new Set() },
    '@/lib/podcastPresentation': presentation,
    '@/lib/listPerf': { listPerf: {} }, '@/lib/query': { queryClient: client }, '@/lib/format': { formatDuration: () => '' },
    '@/lib/localLibrary': { hashKey: (value: string) => value },
    '@/store/auth': { profileScopeId: profile, useAuthStore: auth },
    '@/store/toast': { useToast: (read: (value: any) => unknown) => read({ show: (text: string) => toasts.push(text) }) },
    '@/store/settings': { useSettings: (read: (value: any) => unknown) => read({ language: 'en' }) },
    '@/store/podcastDownloads': { usePodcastDownloads: (read: (value: any) => unknown) => read({ files: {}, scope: profile() }) },
    '@/store/player': { currentSong: () => playing, usePlayerStore: (read: (value: any) => unknown) => read({ isPlaying, toggle() { toggles++; }, playQueue(...args: any[]) { queues.push(args); } }) },
    '@/api/data': { COVER: { card: 500 }, coverArtUrl: (value: string) => value },
    '@/theme': { useTheme: () => palette, colors: palette, themed: (make: (value: any) => unknown) => make(palette),
      fontSize: { sm: 13, md: 16, lg: 20, xs: 11 }, spacing: { xs: 4, sm: 8, md: 12, lg: 20 }, radius: { pill: 100, lg: 20 }, tracking: { heading: 0 } },
  };
  common['@/lib/podcastPreview'] = load('../src/lib/podcastPreview.ts', { '@/store/auth': common['@/store/auth'], '@/lib/podcastDirectory': common['@/lib/podcastDirectory'] });
  common['@/lib/lyricOwner'] = load('../src/lib/lyricOwner.ts', { '@/store/auth': common['@/store/auth'] });
  common['@/hooks/usePodcastPreview'] = load('../src/hooks/usePodcastPreview.ts', common);
  common['@/lib/podcastLibrary'] = load('../src/lib/podcastLibrary.ts', {
    './episodeResume': resume, './localLibrary': common['@/lib/localLibrary'], '@/store/auth': common['@/store/auth'],
    './lyricOwner': common['@/lib/lyricOwner'],
    './podcastDb': { listEpisodeProgress: async (...args: any[]) => { progressReads.push(args); return progressRead(...args); }, listLibraryEpisodes: async () => [] },
  });
  let root!: ReactTestRenderer;
  const mount = async (detail: boolean | 'list' = false) => {
    const Screen = load(detail === 'list' ? '../src/app/podcasts.tsx' : detail ? '../src/app/podcast/[id].tsx' : '../src/app/podcast-discover.tsx', common).default;
    await act(async () => { root = create(React.createElement(Query.QueryClientProvider, { client }, React.createElement(Screen))); await turn(); });
    await act(async () => { await wait(5); });
  };
  const buttons = () => root.root.findAllByType('Button' as any);
  const button = (text: string) => buttons().find((value) => value.props.accessibilityLabel === text || value.findAllByType('Text' as any).some((node) => node.props.children === text));
  return { auth, client, pushes, attempts, toasts, charts, searches, lookups, reads, refreshes, subscriptions, menus, pages, fullReads, queues, progressReads, currentEpisodeReads, mount, button,
    tree: () => root, focus: (active: boolean) => focus.setState({ active }), failNavigation: (value: boolean) => { pushFails = value; }, preview: common['@/lib/podcastPreview'] as any, lookup: (next: typeof lookup) => { lookup = next; }, stored: (next: any) => { stored = next; },
    readChannel: (next: typeof readChannel) => { readChannel = next; }, refresh: (next: typeof refresh) => { refresh = next; }, sort: (value: string) => { preferredOrder = value; },
    progressRead: (next: typeof progressRead) => { progressRead = next; }, playing: (song: any) => { playing = song; isPlaying = !!song; }, toggles: () => toggles,
    route: (next: typeof route) => { route = next; }, episodes: (next: any[]) => { allEpisodes = next; }, pageRead: (next: typeof pageRead) => { pageRead = next; },
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
  assert.equal(h.pushes[0].pathname, '/podcast/[id]'); assert.equal(h.pushes[0].params.id, 'preview-101');
  assert.equal(h.preview.readPodcastPreview(h.pushes[0].params.preview).country, 'jp');
  assert.equal(h.lookups.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.refreshes.length, 0); assert.equal(h.subscriptions.length, 0);
  await h.close();
});

test('a chart tap opens its typed preview synchronously without lookup, SQLite, RSS or subscription and ignores duplicate taps', async () => {
  const h = harness(), never = deferred<any>(); h.lookup(() => never.promise); h.stored(undefined); await h.mount();
  const press = h.button('Preview Example show')!.props.onPress;
  await act(async () => {
    press();
    assert.equal(h.pushes.length, 1, 'the same call stack must issue navigation without awaiting a promise');
    press();
    assert.equal(h.pushes.length, 1, 'a queued duplicate cannot create a second handoff');
  });
  const path = h.pushes[0]; assert.equal(path.pathname, '/podcast/[id]'); assert.equal(path.params.id, 'preview-101');
  assert.equal(Object.keys(path.params).sort().join(','), 'id,preview', 'RSS URLs stay out of route params');
  const seed = h.preview.readPodcastPreview(path.params.preview);
  assert.equal(seed.show.id, 101); assert.equal(seed.show.title, show.title); assert.equal(seed.current(), true);
  assert.equal(h.lookups.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.refreshes.length, 0); assert.equal(h.subscriptions.length, 0);
  await act(async () => { h.focus(false); });
  await act(async () => { press(); }); assert.equal(h.pushes.length, 1, 'a departed screen cannot navigate from its old row');
  await act(async () => { h.focus(true); });
  assert.equal(h.button('Preview Example show')!.props.disabled, false);
  await act(async () => { h.button('Preview Example show')!.props.onPress(); });
  assert.equal(h.pushes.length, 2); assert.notEqual(h.pushes[1].params.preview, path.params.preview);
  assert.equal(seed.current(), true, 'back/reopen does not dispose the original StrictMode-safe handoff');
  await h.close();
});

test('offline cached directory entries still open immediately and a synchronous navigation failure can be retried', async () => {
  const h = harness(true);
  h.client.setQueryData(['podcastDirectory', 'A', 'us', 'all', ''], [{ ...show, feedUrl: channel.feedUrl }]);
  await h.mount();
  assert.equal(h.charts.length, 0); assert.equal(h.searches.length, 0);
  h.failNavigation(true);
  await act(async () => { h.button('Preview Example show')!.props.onPress(); });
  assert.equal(h.pushes.length, 0); assert.equal(h.button('Preview Example show')!.props.disabled, false);
  assert.equal(h.preview.readPodcastPreview(h.attempts[0].params.preview), undefined, 'failed navigation releases only its own seed');
  h.failNavigation(false);
  await act(async () => { h.button('Preview Example show')!.props.onPress(); });
  const seed = h.preview.readPodcastPreview(h.pushes[0].params.preview);
  assert.equal(seed.show.feedUrl, channel.feedUrl); assert.equal(seed.current(), true);
  assert.equal(h.lookups.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.refreshes.length, 0);
  await h.close();
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

test('batched account and offline round trips release canceled subscription busy states', async () => {
  for (const roundTrip of ['account', 'offline'] as const) {
    const h = harness(), pending = deferred<any>();
    if (roundTrip === 'offline') h.auth.setState({ offline: true, autoOffline: true });
    h.subscribe(() => pending.promise);
    try {
      await h.mount(true);
      await act(async () => { h.button('Subscribe')!.props.onPress(); await turn(); });
      assert.equal(h.button('Subscribe')!.props.disabled, true);
      await act(async () => {
        if (roundTrip === 'account') {
          const before = h.auth.getState().auth;
          h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: before });
        } else {
          h.auth.setState({ autoOffline: false }); h.auth.setState({ autoOffline: true });
        }
      });
      assert.equal(h.button('Subscribe')!.props.disabled, false, 'cancellation immediately releases busy state even if a native promise ignores abort');
      assert.equal(h.button('Subscribe')!.findAllByType('Spinner' as any).length, 0);
      await act(async () => { pending.resolve(channel); await turn(); });
      assert.equal(h.button('Subscribe')!.props.disabled, false, `subscription must leave busy state after ${roundTrip} cancellation`);
      assert.equal(h.button('Subscribe')!.findAllByType('Spinner' as any).length, 0);
      assert.equal(h.pushes.length, 0); assert.equal(h.toasts.length, 0);
    } finally { await h.close(); }
  }
});

test('a canceled subscribe completion cannot clear the replacement request spinner', async () => {
  const h = harness(), first = deferred<any>(), second = deferred<any>(); let calls = 0;
  h.subscribe(() => ++calls === 1 ? first.promise : second.promise);
  try {
    await h.mount(true);
    await act(async () => { h.button('Subscribe')!.props.onPress(); await turn(); });
    await act(async () => {
      const before = h.auth.getState().auth;
      h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: before });
    });
    await act(async () => { h.button('Subscribe')!.props.onPress(); await turn(); });
    assert.equal(calls, 2); assert.equal(h.button('Subscribe')!.props.disabled, true);
    await act(async () => { first.resolve(channel); await turn(); });
    assert.equal(h.button('Subscribe')!.props.disabled, true, 'the old finally must not release a newer request');
    assert.equal(h.button('Subscribe')!.findAllByType('Spinner' as any).length, 1);
    assert.equal(h.pushes.length, 0); assert.equal(h.toasts.length, 0);
    await act(async () => { second.resolve(channel); await turn(); });
    assert.ok(h.button('Subscribed'));
  } finally { await h.close(); }
});

const episodes = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `episode-${index}`, channelId: channel.id, title: `Episode ${index}`, publishedAt: 10_000 - index,
  url: `https://audio.test/${index}.mp3`, duration: 600,
}));
const settle = async () => { await act(async () => { await turn(); await wait(5); }); };
const visibleText = (h: ReturnType<typeof harness>, value: string) => h.tree().root.findAllByType('Text' as any)
  .some((text) => text.props.children === value);

test('a mounted directory detail displays the public title and back immediately while lookup is held', async () => {
  const h = harness(), lookup = deferred<any>();
  h.lookup(() => lookup.promise); h.stored(undefined);
  const handle = h.preview.beginPodcastPreview(show, 'jp');
  h.route({ id: handle.id, preview: handle.token });
  try {
    await h.mount(true);
    assert.equal(visibleText(h, show.title), true);
    assert.equal(h.tree().root.findAllByType('Back' as any).length, 1);
    assert.equal(h.tree().root.findByType('DetailView' as any).props.episodes.length, 0);
    assert.equal(h.lookups.length, 1); assert.equal(h.lookups[0][1].country, 'jp');
    assert.equal(h.reads.length, 0); assert.equal(h.refreshes.length, 0); assert.equal(h.pages.length, 0);
    assert.equal(h.fullReads.length, 0); assert.equal(h.subscriptions.length, 0);
    assert.equal(h.button('Play')!.props.disabled, true);
  } finally { await h.close(); }
});

test('cached first seven episodes render while feed refresh waits, pagination adds twenty, and explicit playback builds the complete queue', async () => {
  const h = harness(), refresh = deferred<any>(), all = episodes(32);
  h.episodes(all); h.stored({ ...channel, episodeCount: all.length, refreshedAt: 1 });
  h.refresh(() => refresh.promise);
  const handle = h.preview.beginPodcastPreview({ ...show, feedUrl: channel.feedUrl });
  h.route({ id: handle.id, preview: handle.token });
  try {
    await h.mount(true); await settle();
    const detail = () => h.tree().root.findByType('DetailView' as any);
    assert.equal(h.refreshes.length, 1, 'background feed request remains pending');
    assert.equal(visibleText(h, channel.title), true);
    assert.equal(detail().props.episodes.length, 7);
    assert.equal(h.pages[0][0], channel.id); assert.equal(h.pages[0][1].offset, 0); assert.equal(h.pages[0][1].limit, 7);
    assert.equal(h.pages[0][1].order, 'recent'); assert.equal(h.fullReads.length, 0, 'opening the page never reads the full episode catalog');
    await act(async () => { h.tree().root.findAllByType('EpisodeRow' as any)[3].props.onPlay(); await turn(); });
    assert.deepEqual(h.fullReads, [channel.id]); assert.equal(h.queues.length, 1);
    assert.equal(h.queues[0][0].length, 32, 'playback does not stop at the seven displayed rows');
    assert.equal(h.queues[0][1], 3); assert.deepEqual(h.queues[0][0].map((item: any) => item.id), all.map((item) => item.id));
    assert.equal(h.queues[0][3], '/podcast/show');
    await act(async () => { detail().props.onEndReached(); await turn(); }); await settle();
    assert.equal(detail().props.episodes.length, 27);
    const more = h.pages.find(([, options]) => options.offset === 7);
    assert.ok(more); assert.equal(more[1].limit, 20);
    assert.deepEqual(detail().props.episodes.map((item: any) => item.id), all.slice(0, 27).map((item) => item.id));
    assert.equal(h.fullReads.length, 1, 'pagination never rebuilds the playback queue');
    assert.equal(h.subscriptions.length, 0);
    await act(async () => { refresh.reject(new Error('Background refresh deadline')); await turn(); }); await settle();
    assert.equal(detail().props.episodes.length, 27, 'a refresh failure never removes already usable cached pages');
    assert.equal(visibleText(h, channel.title), true); assert.ok(h.button('Retry'));
    assert.equal(h.tree().root.findAllByType('Back' as any).length, 1);
  } finally { await h.close(); }
});

test('a failed directory feed request keeps its public metadata and back control instead of a blocking spinner', async () => {
  const h = harness(), refresh = deferred<any>(); h.stored(undefined); h.refresh(() => refresh.promise);
  const handle = h.preview.beginPodcastPreview({ ...show, feedUrl: channel.feedUrl });
  h.route({ id: handle.id, preview: handle.token });
  try {
    await h.mount(true);
    assert.equal(visibleText(h, show.title), true); assert.equal(h.refreshes.length, 1);
    await act(async () => { refresh.reject(new Error('Feed deadline')); await turn(); }); await settle();
    assert.equal(visibleText(h, show.title), true);
    assert.equal(h.tree().root.findAllByType('Back' as any).length, 1);
    assert.equal(h.tree().root.findAllByType('Spinner' as any).length, 0);
    assert.ok(h.button('Retry')); assert.equal(h.button('Play')!.props.disabled, true);
    assert.equal(h.pages.length, 0); assert.equal(h.fullReads.length, 0); assert.equal(h.subscriptions.length, 0);
  } finally { await h.close(); }
});

test('a real RSS prefix is playable before the full transfer, and full promotion restores the saved ordering', async () => {
  const h = harness(), done = deferred<any>(), all = episodes(37);
  let callbacks: any, stored: any;
  h.sort('alpha'); h.stored(undefined); h.readChannel(async () => stored);
  h.refresh((options) => { callbacks = options; return done.promise; });
  const handle = h.preview.beginPodcastPreview({ ...show, feedUrl: channel.feedUrl });
  h.route({ id: handle.id, preview: handle.token });
  try {
    await h.mount(true);
    assert.equal(h.tree().root.findByType('DetailView' as any).props.episodes.length, 0);
    const presentation = h.tree().root.findByType('DetailView' as any).props.presentationIdentity;
    assert.equal(h.tree().root.findByType('DetailView' as any).props.initialArtworkUri, show.imageUrl);
    stored = { ...channel, syncComplete: false, episodeCount: 7 };
    h.episodes(all.slice(0, 7));
    await act(async () => { callbacks.onPreview(stored); await turn(); }); await settle();
    const detail = () => h.tree().root.findByType('DetailView' as any);
    assert.equal(detail().props.episodes.length, 7);
    assert.equal(detail().props.presentationIdentity, presentation, 'RSS identity promotion does not start a new visual scene');
    assert.equal(detail().props.initialArtworkUri, show.imageUrl);
    assert.equal(detail().props.loadingMeta, true, '7 is not presented as the complete catalog count');
    assert.equal(visibleText(h, 'First episodes'), true);
    assert.equal(h.pages.at(-1)[1].order, 'recent', 'partial data does not impersonate the full alphabetical result');
    for (const action of ['Sort by', 'Download episodes', 'Subscribe', 'More']) assert.equal(h.button(action)!.props.disabled, true, action);
    assert.equal(h.button('Play')!.props.disabled, false);
    await act(async () => { h.tree().root.findAllByType('EpisodeRow' as any)[2].props.onPlay(); await turn(); });
    assert.equal(h.queues[0][0].length, 7); assert.equal(h.queues[0][0][2].id, all[2].id);
    const before = h.pages.length;
    await act(async () => { detail().props.onEndReached(); await turn(); });
    assert.equal(h.pages.length, before, 'prefix pagination cannot pretend to fetch the missing catalog');
    stored = { ...channel, syncComplete: true, episodeCount: all.length };
    h.episodes(all);
    await act(async () => { done.resolve(stored); await turn(); }); await settle();
    assert.equal(detail().props.loadingMeta, false);
    assert.equal(detail().props.presentationIdentity, presentation, 'full synchronization retains the original opening');
    assert.equal(visibleText(h, 'Episodes'), true);
    assert.equal(visibleText(h, 'First episodes'), false);
    assert.equal(h.pages.at(-1)[1].order, 'alpha', 'saved order is restored without changing the preference');
    assert.equal(h.button('Sort by')!.props.disabled, false);
    assert.equal(h.button('Download episodes')!.props.disabled, false);
  } finally { await h.close(); }
});

test('reopening a locally stored prefix resumes synchronization and preserves usable rows if the transfer fails', async () => {
  const h = harness(), done = deferred<any>(), partial = { ...channel, syncComplete: false, episodeCount: 7 };
  h.episodes(episodes(7)); h.readChannel(async () => partial); h.refresh(() => done.promise);
  try {
    await h.mount(true); await settle();
    assert.equal(h.refreshes.length, 1);
    assert.equal(h.tree().root.findByType('DetailView' as any).props.episodes.length, 7);
    await act(async () => { done.reject(new Error('Remainder unavailable')); await turn(); }); await settle();
    assert.equal(h.refreshes.length, 1, 'a failed prefix sync does not start an automatic retry loop');
    assert.equal(h.tree().root.findByType('DetailView' as any).props.episodes.length, 7);
    assert.equal(visibleText(h, 'The rest of this feed could not be loaded. The available episodes can still be played.'), true);
    assert.ok(h.button('Retry'));
    assert.equal(h.button('Play')!.props.disabled, false);
  } finally { await h.close(); }
});

test('a reopened partial feed resumes after offline and a batched network round trip without leaving a stale refresh spinner', async () => {
  const h = harness(true), partial = { ...channel, syncComplete: false }, requests: { options: any; task: ReturnType<typeof deferred<any>> }[] = [];
  h.episodes(episodes(7)); h.readChannel(async () => partial);
  h.refresh((options) => { const task = deferred<any>(); requests.push({ options, task }); return task.promise; });
  try {
    await h.mount(true); await settle();
    const detail = () => h.tree().root.findByType('DetailView' as any);
    assert.equal(h.refreshes.length, 0); assert.equal(detail().props.refreshing, false);
    assert.equal(visibleText(h, 'Only part of this feed is available offline.'), true);
    await act(async () => { h.auth.setState({ offline: false }); await turn(); }); await settle();
    assert.equal(requests.length, 1); assert.equal(detail().props.refreshing, true);
    const first = requests[0];
    await act(async () => { h.auth.setState({ offline: true }); await turn(); }); await settle();
    assert.equal(first.options.signal.aborted, true); assert.equal(detail().props.refreshing, false);
    await act(async () => { first.task.reject(new Error('Aborted')); await turn(); });
    await act(async () => { h.auth.setState({ offline: false }); await turn(); }); await settle();
    assert.equal(requests.length, 2);
    const second = requests[1];
    await act(async () => { h.auth.setState({ offline: true }); h.auth.setState({ offline: false }); await turn(); }); await settle();
    assert.equal(second.options.signal.aborted, true); assert.equal(requests.length, 3);
    await act(async () => { second.task.reject(new Error('Aborted ABA')); await turn(); });
    assert.equal(detail().props.refreshing, true, 'old completion cannot clear the new owner spinner');
    await act(async () => { requests[2].task.reject(new Error('Publisher unavailable')); await turn(); }); await settle();
    assert.equal(detail().props.refreshing, false);
    assert.equal(detail().props.episodes.length, 7);
    assert.ok(h.button('Retry'));
  } finally { await h.close(); }
});

test('Continue uses the page resume id outside the first seven while the initial progress query remains pending', async () => {
  const h = harness(), pending = deferred<any[]>(), all = episodes(32); let explicit = false;
  h.episodes(all);
  h.progressRead(() => explicit ? Promise.resolve([{ id: 'episode-15', positionSec: 120, durationSec: 600 }]) : pending.promise);
  h.pageRead(async (_id, options) => ({ items: all.slice(options.offset, options.offset + options.limit), total: all.length,
    nextOffset: options.offset + options.limit < all.length ? options.offset + options.limit : undefined,
    seasons: [], resumeId: 'episode-15' }));
  try {
    await h.mount(true); await settle();
    assert.equal(h.client.getQueryState(['podcastPlayed', 'progress', channel.id, 'A'])?.status, 'pending');
    assert.equal(h.tree().root.findAllByType('EpisodeRow' as any).length, 7);
    assert.ok(h.button('Continue playing')); assert.equal(h.fullReads.length, 0);
    const before = h.progressReads.length; explicit = true;
    await act(async () => { h.button('Continue playing')!.props.onPress(); await turn(); }); await settle();
    assert.equal(h.progressReads.length, before + 1, 'explicit play rereads progress rather than waiting on the UI query');
    assert.equal(h.queues.length, 1); assert.equal(h.queues[0][0].length, 32); assert.equal(h.queues[0][1], 15);
    assert.equal(h.queues[0][0][15].id, 'episode-15');
    assert.equal(h.client.getQueryState(['podcastPlayed', 'progress', channel.id, 'A'])?.status, 'pending');
  } finally { await h.close(); }
});

test('playing an in-progress SQL page reads current progress even when the display progress query is unresolved', async () => {
  const h = harness(), pending = deferred<any[]>(), all = episodes(32); let explicit = false;
  const matching = [all[15], all[22]];
  h.episodes(all);
  h.progressRead(() => explicit ? Promise.resolve([
    { id: 'episode-15', positionSec: 120, durationSec: 600 },
    { id: 'episode-22', positionSec: 200, durationSec: 600 },
    { id: 'episode-3', positionSec: 600, durationSec: 600 },
  ]) : pending.promise);
  h.pageRead(async (_id, options) => ({ items: options.filter === 'progress' ? matching : all.slice(0, 7),
    total: options.filter === 'progress' ? 2 : all.length, nextOffset: undefined, seasons: [], resumeId: 'episode-15' }));
  try {
    await h.mount(true); await settle();
    await act(async () => { h.button('In progress')!.props.onPress(); await turn(); }); await settle();
    const rows = h.tree().root.findAllByType('EpisodeRow' as any);
    assert.deepEqual(rows.map((row) => row.props.episode.id), matching.map((episode) => episode.id));
    assert.equal(h.client.getQueryState(['podcastPlayed', 'progress', channel.id, 'A'])?.status, 'pending');
    assert.equal(h.fullReads.length, 0); const before = h.progressReads.length; explicit = true;
    await act(async () => { rows[1].props.onPlay(); await turn(); }); await settle();
    assert.equal(h.progressReads.length, before + 1);
    assert.equal(h.queues.length, 1); assert.deepEqual(h.queues[0][0].map((episode: any) => episode.id), ['episode-15', 'episode-22']);
    assert.equal(h.queues[0][1], 1); assert.equal(h.toasts.includes('Not available offline'), false);
  } finally { await h.close(); }
});

test('the default show page pauses its current episode beyond the first seven without fetching another episode record', async () => {
  const h = harness(), all = episodes(32); h.episodes(all);
  h.playing({ ...all[15], podcastChannelId: channel.id });
  try {
    await h.mount(true); await settle();
    assert.equal(h.tree().root.findAllByType('EpisodeRow' as any).length, 7);
    assert.ok(h.button('Pause')); assert.equal(h.currentEpisodeReads.length, 0);
    await act(async () => { h.button('Pause')!.props.onPress(); await turn(); });
    assert.equal(h.toggles(), 1); assert.equal(h.queues.length, 0); assert.equal(h.fullReads.length, 0);
  } finally { await h.close(); }
});
