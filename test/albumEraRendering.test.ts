import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as eras from '../src/lib/albumEras';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
const light = { background: '#fafafa', text: '#111111', textSecondary: '#555555', textMuted: '#666666', accent: '#aa2244', surfaceHighlight: '#dddddd' };
const translate = (key: string, values: Record<string, unknown> = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(values[name]));

test('era cards use the frame colour without live backdrop capture; equivalent metadata does not redraw their glass or covers', async () => {
  const Theme = React.createContext(light), visits: unknown[] = [];
  let glassRenders = 0, coverRenders = 0;
  const { AlbumEraCard } = load('../src/components/AlbumEraCard.tsx', {
    react: React, 'react/jsx-runtime': JSXRuntime, 'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View' },
    'expo-router': { router: { push(value: unknown) { visits.push(value); } } },
    '@/components/Cover': { Cover: (props: any) => { coverRenders++; return React.createElement('Cover', props); } },
    '@/components/glass': { GlassSurface: (props: any) => { glassRenders++; return React.createElement('GlassSurface', props); } },
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/i18n': { useT: () => translate },
    '@/theme': { useTheme: () => React.useContext(Theme), themed: (make: any) => make(light) },
  });
  let tree!: ReactTestRenderer;
  const props = { era: '1980s', year: 1980, count: 40, fraction: 0.5, downloaded: false, covers: [{ id: 'one', uri: 'https://A/one' }, { id: 'two', uri: 'https://A/two' }] };
  const render = (colors: typeof light, values = props) => React.createElement(Theme.Provider, { value: colors }, React.createElement(AlbumEraCard, values));
  await act(async () => { tree = create(render(light)); });
  const surface = () => tree.root.findByType('GlassSurface' as any).props;
  assert.equal(surface().staticBackdropColor, light.background);
  assert.equal(surface().radius, 22);
  assert.equal(surface().blurRadius, undefined, 'the material still uses the saved/default optical parameters');
  assert.equal(glassRenders, 1); assert.equal(coverRenders, 2);
  await act(async () => { tree.update(render(light, { ...props, covers: props.covers.map((cover) => ({ ...cover })) })); });
  assert.equal(glassRenders, 1, 'new query wrappers with identical visible values do not redraw a card');
  assert.equal(coverRenders, 2);
  const dark = { ...light, background: '#141414', text: '#ffffff' };
  await act(async () => { tree.update(render(dark)); });
  assert.equal(surface().staticBackdropColor, dark.background, 'memoization still observes live theme changes');
  assert.equal(glassRenders, 2);
  await act(async () => { tree.update(render(dark, { ...props, downloaded: true, covers: props.covers.map((cover) => ({ ...cover, uri: cover.uri.replace('//A/', '//B/') })) })); });
  assert.deepEqual(tree.root.findAllByType('Cover' as any).map((cover) => cover.props.uri), ['https://B/one', 'https://B/two'], 'identical album IDs from a different source must not retain old images');
  await act(async () => { tree.root.findByType('Pressable' as any).props.onPress(); });
  assert.equal(JSON.stringify(visits), JSON.stringify([{ pathname: '/album-years/1980s', params: { downloaded: '1' } }]));
  await act(async () => { tree.unmount(); });
});

test('the real year screen fills the viewport but batches large multi-column artwork in two rows and retains stable row data', async () => {
  let layout = 'grid', columns = 3;
  const index = eras.albumEraIndex([{ offset: 0, albums: Array.from({ length: 90 }, (_, id) => ({ id: String(id), name: `Album ${id}`, year: 1984 })) as any }]);
  const result = { index, complete: false, isError: false, issue: undefined, restart: async () => {} };
  const { default: Screen } = load('../src/app/album-years/[year].tsx', {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View' },
    'react-native-reanimated': { __esModule: true, default: { FlatList: 'List' } },
    'expo-router': { useLocalSearchParams: () => ({ year: '1980s' }) },
    '@/components/AlbumCard': { AlbumCard: 'AlbumCard' }, '@/components/AlbumRow': { AlbumRow: () => null },
    '@/components/BackChevron': { BackChevron: 'Back' }, '@/components/BrowseFrame': { BrowseFrame: 'Frame' },
    '@/components/EmptyState': { EmptyState: 'Empty' }, '@/components/glass': { GlassPressable: 'Button' },
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/hooks/useAlbumEras': { useAlbumEras: () => result },
    '@/hooks/useGridColumns': { useGridColumns: () => ({ columns, openGridMenu() {}, gridSheet: null }) },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => 'ui-thread-handler' },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 160 },
    '@/hooks/useScreenSize': { useListPadding: () => 20, useScreenSize: () => ({ width: 412, height: 900 }) },
    '@/i18n': { useT: () => translate }, '@/lib/albumEras': eras,
    '@/lib/listPerf': { listPerf: { initialNumToRender: 10, maxToRenderPerBatch: 10, windowSize: 11, removeClippedSubviews: true } },
    '@/store/settings': { useSettings: (select: any) => select({ browseAlbumsLayout: layout, setBrowseAlbumsLayout() {} }) },
    '@/theme': { spacing: { lg: 20, sm: 8 }, useTheme: () => light, themed: (make: any) => make(light) },
  });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(Screen)); });
  const first = tree.root.findByType('List' as any).props;
  assert.equal(first.data.length, 90); assert.equal(first.numColumns, 3);
  assert.equal(first.maxToRenderPerBatch, 2); assert.equal(first.windowSize, 5);
  assert.ok(first.initialNumToRender * ((412 - 40 - 16) / 3 + 56) >= 900, 'the initial rows still cover the viewport');
  assert.equal(first.onScroll, 'ui-thread-handler');
  result.complete = true;
  await act(async () => { tree.update(React.createElement(Screen)); });
  const complete = tree.root.findByType('List' as any).props;
  assert.equal(complete.data, first.data); assert.equal(complete.renderItem, first.renderItem, 'loading chrome does not replace the renderer or album array');
  layout = 'list';
  await act(async () => { tree.update(React.createElement(Screen)); });
  const list = tree.root.findByType('List' as any);
  assert.equal(list.props.numColumns, 1); assert.equal(list.props.maxToRenderPerBatch, 10);
  columns = 4;
  await act(async () => { tree.update(React.createElement(Screen)); });
  assert.equal(tree.root.findByType('List' as any), list, 'an irrelevant grid-column preference must not remount a list');
  await act(async () => { tree.unmount(); });
});

test('the real era overview retains attached hosts for at most twenty-four rows and still clips larger catalogues', async () => {
  const albums = (count: number) => eras.albumEraIndex([{ offset: 0, albums: Array.from({ length: count }, (_, i) => ({ id: `album-${i}`, name: `Album ${i}`, year: 1900 + i * 10 })) as any }]);
  const result = { index: albums(23), complete: true, isError: false, issue: undefined, restart: async () => {} };
  result.index.unknown.push({ id: 'unknown', name: 'Unknown' } as any);
  const { default: Screen } = load('../src/app/album-eras.tsx', {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View' },
    'react-native-reanimated': { __esModule: true, default: { FlatList: 'List' } },
    'expo-router': { useLocalSearchParams: () => ({ downloaded: '1' }) },
    '@/api/data': { COVER: { thumb: 200 }, coverArtUrl: (id: string, size: number) => `${id}?size=${size}` },
    '@/components/AlbumEraCard': { AlbumEraCard: 'EraCard' },
    '@/components/BackChevron': { BackChevron: 'Back' }, '@/components/BrowseFrame': { BrowseFrame: 'Frame' },
    '@/components/EmptyState': { EmptyState: 'Empty' }, '@/components/glass': { GlassPressable: 'Button' },
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/hooks/useAlbumEras': { useAlbumEras: (downloaded: boolean) => { assert.equal(downloaded, true); return result; } },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => 'ui-thread-handler' },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 160 }, '@/hooks/useScreenSize': { useListPadding: () => 20 },
    '@/i18n': { useT: () => translate },
    '@/lib/listPerf': { listPerf: { initialNumToRender: 10, maxToRenderPerBatch: 10, windowSize: 11, removeClippedSubviews: true } },
    '@/theme': { spacing: { lg: 20 }, useTheme: () => light, themed: (make: any) => make(light) },
  });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(Screen)); });
  const bounded = tree.root.findByType('List' as any).props;
  assert.equal(bounded.data.length, 24, 'unknown years count towards the attachment bound');
  assert.equal(bounded.removeClippedSubviews, false);
  assert.equal(bounded.initialNumToRender, 10); assert.equal(bounded.windowSize, 11);
  const first = bounded.renderItem({ item: bounded.data[0] }).props;
  assert.equal(first.era, '2120s'); assert.equal(first.downloaded, true);
  assert.equal(first.covers[0].uri, 'album-22?size=200');
  result.index = albums(24); result.index.unknown.push({ id: 'unknown', name: 'Unknown' } as any);
  await act(async () => { tree.update(React.createElement(Screen)); });
  const large = tree.root.findByType('List' as any).props;
  assert.equal(large.data.length, 25); assert.equal(large.removeClippedSubviews, true);
  assert.equal(JSON.stringify(large.contentContainerStyle), JSON.stringify(bounded.contentContainerStyle), 'attachment mode does not change padding or row spacing');
  assert.equal(large.onScroll, bounded.onScroll);
  assert.equal(large.renderItem({ item: large.data.find((item: any) => item.key === first.era) }).props.covers[0].uri, first.covers[0].uri);
  result.index = albums(24);
  await act(async () => { tree.update(React.createElement(Screen)); });
  assert.equal(tree.root.findByType('List' as any).props.removeClippedSubviews, false);
  await act(async () => { tree.unmount(); });
});
