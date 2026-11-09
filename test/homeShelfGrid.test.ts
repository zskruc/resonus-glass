import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { defaultDiscoveryPreferences, homeShelfPreset, parseDiscoveryPreferences } from '../src/lib/discoveryPreferences';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function execute(source: string, values: Record<string, unknown>, imports: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, ...values, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } }); return exports;
}
const spacing = { lg: 20, md: 12, sm: 8 };
const nativeList = ({ data, renderItem, initialNumToRender = 3, ...props }: any) => React.createElement('VirtualList', { ...props, data, initialNumToRender },
  ...data.slice(0, initialNumToRender).map((item: any, index: number) => React.createElement(React.Fragment, { key: props.keyExtractor?.(item, index) ?? index }, renderItem({ item, index }))));
function grid() {
  return execute(readFileSync(new URL('../src/components/discovery/HomeShelfGrid.tsx', import.meta.url), 'utf8'), {}, {
    react: React, 'react/jsx-runtime': JSXRuntime, 'react-native': { FlatList: nativeList, View: 'View' }, '@/theme': { spacing },
  });
}

test('mounted grid virtualises horizontal columns with one, two or three cards, retains order and caps metadata at fifty', async () => {
  const { HomeShelfGrid, homeShelfColumns } = grid(), items = Array.from({ length: 70 }, (_, i) => ({ id: `album-${i}` }));
  let tree!: ReactTestRenderer;
  for (const rows of [1, 2, 3]) {
    const rendered: string[] = [];
    await act(async () => { tree = create(React.createElement(HomeShelfGrid, { items, rows, cardWidth: 140, keyFor: (item: any) => item.id,
      renderCard: (item: any) => { rendered.push(item.id); return React.createElement('AlbumCard', { album: item }); } })); });
    const list = tree.root.findByType('VirtualList' as any); assert.equal(list.props.horizontal, true); assert.equal(list.props.windowSize, 3); assert.equal(list.props.maxToRenderPerBatch, 3);
    assert.equal(list.props.data.length, Math.ceil(50 / rows)); assert.equal(rendered.length, rows * 3, 'only the first three columns are mounted');
    assert.ok(list.props.data.every((column: unknown[]) => column.length >= 1 && column.length <= rows));
    assert.deepEqual(Array.from(list.props.data.flat(), (item: any) => item.id), items.slice(0, 50).map((item) => item.id));
    assert.equal(list.props.getItemLayout(null, 2).offset, 20 + (140 + 12) * 2);
    await act(async () => { tree.unmount(); });
  }
  assert.equal(homeShelfColumns(items, Number.NaN)[0].length, 2);
});

test('old v1 preferences keep their original defaults; grid rows persist and home presets leave search/order inputs intact', () => {
  const data = defaultDiscoveryPreferences(), sectionOrder = ['randomArtists', 'randomAlbums', 'podcasts', 'playlists', 'recentlyPlayed', 'mostPlayedSongs'];
  data.search.sections.reverse(); data.search.sections[0].enabled = false;
  data.shelves.randomAlbums = { layout: 'cards', size: 'default', limit: 20 };
  assert.equal(parseDiscoveryPreferences(data).shelves.randomAlbums.rows, undefined, 'old card and song row defaults remain caller-owned');
  const compact = homeShelfPreset(data, sectionOrder, 'compact');
  assert.equal(compact.shelves.randomAlbums.layout, 'grid'); assert.equal(compact.shelves.randomAlbums.rows, 3); assert.equal(compact.shelves.randomAlbums.size, 'small');
  assert.deepEqual(compact.search, data.search); assert.deepEqual(sectionOrder, ['randomArtists', 'randomAlbums', 'podcasts', 'playlists', 'recentlyPlayed', 'mostPlayedSongs']);
  const restored = parseDiscoveryPreferences(JSON.parse(JSON.stringify(compact))); assert.equal(restored.shelves.randomAlbums.rows, 3);
  const covers = homeShelfPreset(restored, sectionOrder, 'covers'); assert.equal(covers.shelves.randomAlbums.layout, 'cards'); assert.equal(covers.shelves.randomAlbums.size, 'large');
  assert.deepEqual(homeShelfPreset(covers, sectionOrder, 'default').shelves, {});
  const invalid = parseDiscoveryPreferences({ ...data, shelves: { x: { layout: 'grid', size: 'small', limit: 500, rows: 9 } } }); assert.equal(invalid.shelves.x.limit, 50); assert.equal(invalid.shelves.x.rows, undefined);
});

test('actual album, playlist, artist, discover and podcast shelf components select the shared mounted grid while default cards remain unchanged', async () => {
  const source = readFileSync(new URL('../src/app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = new Set(['useShelfItems', 'useShelfRows', 'useShelfCard', 'AlbumSection', 'PlaylistsSection', 'PodcastEpisodesSection', 'ArtistSection', 'DiscoverSection', 'shuffled', 'SongListCarousel']);
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && functions.has(node.name?.text ?? '')).map((node) => node.getText(ast)).join('\n');
  const ShelfContext = React.createContext<any>(undefined), AppleHomeContext = React.createContext(false), card = { id: 'one', name: 'Album', title: 'Title' };
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...card, id: `item-${i}`, episode: { id: `episode-${i}`, title: 'Episode' }, channel: { id: 'show', title: 'Show' } }));
  let query: any, fetches: any[] = [];
  const values = { ...React, ShelfContext, AppleHomeContext, spacing, styles: { rowContent: {} }, voltaStyles: {},
    useAuthStore: Object.assign((select: any) => select({ auth: {}, offline: true }), { getState: () => ({ auth: {}, offline: true }) }), useScreenSize: () => ({ width: 400, wide: false }),
    useQuery: (options: any) => { query = options; return { data: rows, isLoading: false }; },
    getAlbumList: async (...args: any[]) => { fetches.push(args); return rows; }, getPlaylists: async () => rows, listRecentEpisodes: async () => rows, getArtists: async () => rows,
    FlatList: nativeList, View: 'View', TrackRow: 'TrackRow', songListStyles: { page: {} },
    useSongMenu: (select: any) => select({ open() {} }), usePlayerStore: (select: any) => select({ playQueue() {} }), useSettings: (select: any) => select({ showListArtwork: true }),
    captureLyricOwner: () => () => true, SONG_PAGE_SIZE: 3, SONG_PAGE_MAX: 420, HomeShelf: 'HomeShelf', HomeShelfTitle: 'Title', SectionHeader: 'Header', AlbumRow: 'AlbumRow', ArtistRow: 'ArtistRow',
    AlbumCard: 'AlbumCard', PlaylistCard: 'PlaylistCard', PodcastEpisodeCard: 'PodcastEpisodeCard', ArtistCard: 'ArtistCard', AlbumCardsSkeleton: 'Skeleton', HomeShelfGrid: grid().HomeShelfGrid,
    listPerf: {}, SHELF_CARD: 150, SHELF_CARD_WIDE: 190, ARTIST_SIZE: 130, ARTIST_SIZE_WIDE: 165, DISCOVER_POOL: 50, DISCOVER_OFFSET: 15,
  };
  const exports = execute(`${declarations}\nexports.screens={AlbumSection,PlaylistsSection,PodcastEpisodesSection,ArtistSection,DiscoverSection};exports.SongListCarousel=SongListCarousel`, values, { 'react/jsx-runtime': JSXRuntime });
  for (const [name, Screen] of Object.entries(exports.screens)) {
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(ShelfContext.Provider, { value: { layout: 'grid', rows: 3, size: 'small', limit: 7 } }, React.createElement(Screen as any, { title: name, type: 'newest', reshuffleKey: 0 }))); });
    const list = tree.root.findByType('VirtualList' as any); assert.equal(list.props.data.length, 3, name); assert.equal(list.props.data[0].length, 3, name); assert.equal(list.props.horizontal, true, name);
    const expected = name === 'PodcastEpisodesSection' ? 'PodcastEpisodeCard' : name === 'PlaylistsSection' ? 'PlaylistCard' : name === 'ArtistSection' ? 'ArtistCard' : 'AlbumCard';
    assert.equal(tree.root.findAllByType(expected as any).length, 7, `${name}: each configured item mounts once across three columns`);
    await act(async () => { tree.unmount(); });
  }
  let defaultTree!: ReactTestRenderer;
  await act(async () => { defaultTree = create(React.createElement(exports.screens.AlbumSection, { title: 'Albums', type: 'newest' })); });
  await query.queryFn(); assert.deepEqual(fetches.at(-1), ['newest', undefined]);
  assert.equal(defaultTree.root.findAllByType('AlbumCard' as any).length, 3, 'the existing one-row card carousel remains the default');
  await act(async () => { defaultTree.unmount(); });
  for (const count of [undefined, 1, 2, 3]) {
    let songTree!: ReactTestRenderer;
    await act(async () => { songTree = create(React.createElement(ShelfContext.Provider, { value: count ? { layout: 'default', rows: count, limit: 12, size: 'default' } : undefined }, React.createElement(exports.SongListCarousel, { songs: rows, title: 'Songs' }))); });
    const list = songTree.root.findByType('VirtualList' as any); assert.equal(list.props.data[0].length, count ?? 3, 'song rows honour one/two/three; the old default remains three');
    assert.equal(list.props.horizontal, true); assert.equal(list.props.data.flat().length, rows.length);
    await act(async () => { songTree.unmount(); });
  }
});
