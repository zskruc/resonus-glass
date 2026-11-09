import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import { primuseAlbumLayout } from '../src/lib/primuseAlbumLayout';
import { buildPrimuseAlbumPalette } from '../src/lib/primuseAlbumPalette';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const element = React.createElement;

/** Real DetailHeroScene + artwork readiness provider + shared header + podcast
 * view. Only native image display, palette preparation and list hosts are
 * controlled boundaries. This does not simulate decoding or native FPS. */
function harness() {
  let renderer!: ReactTestRenderer;
  let prepared = false, textureUri: string | undefined = 'file:///field-A.png';
  let channel = { id: 'A', title: 'Show A', author: 'Author', imageUrl: 'file:///cover-A.png', episodeCount: 150 };
  let loadingMeta = true, endReached = 0, actionMounts = 0, backs = 0, dockDrags = 0;
  let pagingIdentity: string | undefined;
  const scheduledRN: (() => void)[] = [];
  const dockHandler = { onBeginDrag: () => { dockDrags++; } };
  const palette = buildPrimuseAlbumPalette('#4466aa', true);
  const imports: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
      RefreshControl: 'RefreshControl', ActivityIndicator: 'Spinner',
      useWindowDimensions: () => ({ fontScale: 1 }),
      StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' } } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24 }) },
    'expo-router': { useIsFocused: () => true, Link: 'Link' },
    'expo-status-bar': { StatusBar: 'StatusBar' }, 'expo-navigation-bar': { NavigationBar: 'NavigationBar' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '@/api/data': { COVER: { card: 720 }, coverArtUrl: (uri: string) => uri },
    '@/api/podcasts': { podcastCover: (show: any) => show.imageUrl },
    '@/components/Cover': { Cover: 'Cover' }, '@/components/ExplicitBadge': { ExplicitBadge: 'ExplicitBadge' },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/BackChevron': { BackChevron: (props: any) => element('Back', { ...props, onPress: () => { backs++; } }) },
    '@/components/RouteImageResources': { useRouteImageLease: () => React.useMemo(() => ({ active: true }), []) },
    '@/components/volta/ArtistPagePalette': { ArtistPagePaletteProvider: ({ children }: any) => children },
    '@/hooks/usePrimuseAlbumPalette': { usePrimuseAlbumPalette: () => ({ palette, ready: prepared, textureUri,
      textureScale: 1, textureRevision: 0, onArtworkLoad() {}, onArtworkError() {}, onTextureError() {} }) },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => dockHandler },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 140 },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400, height: 900 }), centredPadding: () => 20 },
    '@/i18n': { episodesLabel: (count: number) => `${count} episodes`, useT: () => (key: string) => key },
    '@/store/settings': { useSettings: (selector: (state: any) => any) => selector({ language: 'en' }) },
    '@/lib/artistHeaderTransition': { artistHeaderFromLayout: () => ({ largeOpacity: 1, compactOpacity: 0, backgroundOpacity: 0 }) },
    '@/lib/listPerf': { listPerf: { initialNumToRender: 10, removeClippedSubviews: true, windowSize: 11 } },
    '@/lib/primuseAlbumLayout': { primuseAlbumLayout },
    '@/theme': { spacing: { lg: 16, sm: 8 }, colors: { background: '#111111', text: '#ffffff' } },
  };
  function FlatList(props: any) {
    return element('FlatList', props, props.ListHeaderComponent,
      props.data.length ? props.renderItem({ item: props.data[0], index: 0 }) : props.ListEmptyComponent,
      props.ListFooterComponent);
  }
  imports['react-native-reanimated'] = { __esModule: true,
    default: { View: 'AnimatedView', Text: 'AnimatedText', FlatList },
    useSharedValue: (initial: any) => React.useState(() => {
      let value = initial; return { get: () => value, set: (next: any) => { value = next; } };
    })[0],
    useDerivedValue: (callback: () => any) => ({ get: callback }),
    useAnimatedStyle: (callback: () => any) => callback(), useAnimatedScrollHandler: (handlers: any) => handlers,
    useComposedEventHandler: (handlers: any[]) => handlers,
  };
  imports['react-native-worklets'] = { scheduleOnRN: (callback: () => void) => { scheduledRN.push(callback); } };
  function source(path: string) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, setTimeout, clearTimeout, require(name: string) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected progressive-shell import ${name}`); return imports[name];
    } });
    return exports;
  }
  imports['@/components/DetailHeroScene'] = source('src/components/DetailHeroScene.tsx');
  const scene = source('src/components/primuse/PrimuseAlbumScene.tsx');
  imports['@/components/primuse/PrimuseAlbumScene'] = scene;
  imports['./PrimuseAlbumScene'] = scene;
  imports['@/components/primuse/PrimuseAlbumHeader'] = source('src/components/primuse/PrimuseAlbumHeader.tsx');
  imports['@/components/primuse/PrimuseAlbumBackdrop'] = { PrimuseAlbumBackdrop: (props: any) => {
    const events = scene.usePrimuseAlbumScene();
    return element('Backdrop', { ...props, onDisplay: events.fieldDisplayed });
  } };
  const View = source('src/components/podcast/PodcastDetailView.tsx').PodcastDetailView;
  function Actions() {
    React.useLayoutEffect(() => { actionMounts++; return () => { actionMounts--; }; }, []);
    return element('ShowActions', { accessibilityRole: 'button' });
  }
  const onEndReached = () => { endReached++; };
  const render = () => element(View, { channel, episodes: [], offline: false, refreshing: false, onRefresh() {},
    loadingMeta, onEndReached, pagingIdentity, footer: element('MoreEpisodes'), empty: element('LoadingEpisodes'),
    actions: () => element(Actions), toolbar: () => element('ShowMenu'), filters: () => element('EpisodeFilters'),
    renderEpisode: () => element('Episode') });
  return {
    async mount() { await act(async () => { renderer = create(render()); }); },
    async update() { await act(async () => { renderer.update(render()); }); },
    async unmount() { await act(async () => { renderer?.unmount(); }); },
    root: () => renderer.root,
    async measure() { await act(async () => { renderer.root.findByProps({ testID: 'primuse-album-header' }).props.onLayout({ nativeEvent: { layout: { height: 510 } } }); }); },
    async cover(error = false) { await act(async () => {
      const cover = renderer.root.findByType('Cover' as any);
      cover.props[error ? 'onImageError' : 'onImageDisplay'](channel.imageUrl);
    }); },
    async field() { await act(async () => { renderer.root.findByType('Backdrop' as any).props.onDisplay(); }); },
    prepare(value: boolean, ...uris: (string | undefined)[]) { prepared = value; if (uris.length) textureUri = uris[0]; },
    show(id: string) { channel = { ...channel, id, title: `Show ${id}`, imageUrl: `file:///cover-${id}.png` }; },
    loading(value: boolean) { loadingMeta = value; },
    paging(identity: string | undefined) { pagingIdentity = identity; },
    queueDrag() {
      for (const handler of renderer.root.findByType('FlatList' as any).props.onScroll) handler?.onBeginDrag?.({});
    },
    async flushDrag() { await act(async () => { while (scheduledRN.length) scheduledRN.shift()!(); }); },
    async drag() {
      await act(async () => {
        for (const handler of renderer.root.findByType('FlatList' as any).props.onScroll) handler?.onBeginDrag?.({});
        while (scheduledRN.length) scheduledRN.shift()!();
      });
    },
    coverOpacity: () => renderer.root.findByProps({ testID: 'primuse-album-artwork' }).props.style.at(-1).opacity,
    fieldOpacity: () => renderer.root.findByProps({ testID: 'podcast-detail-artwork-field' }).props.style.at(-1).opacity,
    readyCallback: () => renderer.root.findByType(scene.PrimuseAlbumScene).props.onReadyChange as (ready: boolean) => void,
    mounts: () => actionMounts, ends: () => endReached, backs: () => backs, dockDrags: () => dockDrags,
  };
}

test('podcast title, actions, back and paged episode shell are usable before either artwork layer is ready', async () => {
  const h = harness();
  try {
    await h.mount();
    const content = h.root().findByProps({ testID: 'detail-hero-scene-content' });
    assert.equal(content.props.style.at(-1).opacity, 1);
    assert.equal(content.props.pointerEvents, 'auto');
    assert.equal(h.root().findAllByProps({ testID: 'detail-hero-loading' }).length, 0);
    assert.equal(h.root().findByType('FlatList' as any).props.initialNumToRender, 7);
    assert.equal(h.root().findByType('FlatList' as any).props.removeClippedSubviews, true);
    assert.equal(h.root().findAllByType('LoadingEpisodes' as any).length, 1);
    assert.equal(h.root().findAllByType('MoreEpisodes' as any).length, 1);
    assert.equal(h.root().findAllByType('ShowActions' as any).length, 1);
    assert.equal(h.coverOpacity(), 0); assert.equal(h.fieldOpacity(), 0);
    await act(async () => { h.root().findByType('Back' as any).props.onPress(); h.root().findByType('FlatList' as any).props.onEndReached(); });
    assert.equal(h.backs(), 1); assert.equal(h.ends(), 0, 'mount-time end signals do not request the second page');
    await h.measure(); await h.cover();
    assert.equal(h.coverOpacity(), 0, 'a displayed cover must not reveal ahead of the prepared blur');
    h.prepare(true); await h.update();
    assert.equal(h.coverOpacity(), 0); assert.equal(h.fieldOpacity(), 0);
    await h.field();
    assert.equal(h.coverOpacity(), 1); assert.equal(h.fieldOpacity(), 1);
    assert.equal(h.mounts(), 1, 'artwork completion does not remount the usable controls');
    const coverStyle = h.root().findByProps({ testID: 'primuse-album-artwork' }).props.style.at(-1);
    assert.equal(h.root().findByProps({ testID: 'podcast-detail-artwork-field' }).props.style.at(-1), coverStyle);
    h.loading(false); await h.update();
    assert.equal(h.root().findAll((node) => String(node.type) === 'Text' && node.props.children === '150 episodes').length, 1);
  } finally { await h.unmount(); }
});

test('switching show A to B to A rejects prior readiness without hiding or remounting the shell', async () => {
  const h = harness();
  try {
    await h.mount(); await h.measure(); h.prepare(true); await h.update(); await h.cover(); await h.field();
    const firstA = h.readyCallback();
    assert.equal(h.coverOpacity(), 1);
    h.show('B'); h.prepare(false, 'file:///field-B.png'); await h.update();
    const oldB = h.readyCallback();
    assert.equal(h.coverOpacity(), 0); assert.equal(h.fieldOpacity(), 0);
    await act(async () => { firstA(true); });
    assert.equal(h.coverOpacity(), 0);
    h.prepare(true); await h.update(); await h.cover(); await h.field();
    assert.equal(h.coverOpacity(), 1);
    await act(async () => { firstA(false); });
    assert.equal(h.coverOpacity(), 1, 'a stale callback cannot retract B');
    h.show('A'); h.prepare(false, 'file:///field-A.png'); await h.update();
    await act(async () => { firstA(true); oldB(true); });
    assert.equal(h.coverOpacity(), 0, 'the earlier A token does not own the new A scene');
    assert.equal(h.fieldOpacity(), 0);
    assert.equal(h.mounts(), 1);
    assert.equal(h.root().findByProps({ testID: 'detail-hero-scene-content' }).props.pointerEvents, 'auto');
  } finally { await h.unmount(); }
});

test('cover failure with no prepared texture settles the artwork fallback without blocking the page', async () => {
  const h = harness();
  try {
    h.prepare(true, undefined); await h.mount(); await h.measure();
    assert.equal(h.coverOpacity(), 0);
    await h.cover(true);
    assert.equal(h.coverOpacity(), 1); assert.equal(h.fieldOpacity(), 1);
    assert.equal(h.root().findByProps({ testID: 'detail-hero-scene-content' }).props.style.at(-1).opacity, 1);
    assert.equal(h.mounts(), 1);
  } finally { await h.unmount(); }
});

test('mount-time end signals wait for one real drag while dock/header events remain composed', async () => {
  const h = harness();
  try {
    await h.mount();
    const list = h.root().findByType('FlatList' as any);
    assert.equal(list.props.onScrollBeginDrag, undefined, 'a JS prop must not replace the composed native handler');
    await act(async () => { list.props.onEndReached(); list.props.onEndReached(); });
    assert.equal(h.ends(), 0);
    await h.drag();
    assert.equal(h.ends(), 1, 'the first user drag flushes the pending request once');
    assert.equal(h.dockDrags(), 1, 'the same begin-drag still reaches the dock worklet');
    await h.drag();
    assert.equal(h.ends(), 1, 'begin-drag alone is not another paging request');
    await act(async () => { h.root().findByType('FlatList' as any).props.onEndReached(); });
    assert.equal(h.ends(), 2, 'normal near-end paging is enabled after user interaction');
  } finally { await h.unmount(); }
});

test('a queued old drag cannot unlock a new query identity, and the default scope follows the show', async () => {
  const h = harness();
  try {
    await h.mount();
    await act(async () => { h.root().findByType('FlatList' as any).props.onEndReached(); });
    h.queueDrag(); h.paging('new-query'); await h.update(); await h.flushDrag();
    assert.equal(h.ends(), 0);
    await act(async () => { h.root().findByType('FlatList' as any).props.onEndReached(); });
    assert.equal(h.ends(), 0, 'the new first page remains user-driven');
    await h.drag(); assert.equal(h.ends(), 1);
    h.paging(undefined); h.show('B'); await h.update();
    await act(async () => { h.root().findByType('FlatList' as any).props.onEndReached(); });
    assert.equal(h.ends(), 1, 'a different channel resets the default paging gate');
    await h.drag(); assert.equal(h.ends(), 2);
  } finally { await h.unmount(); }
});
