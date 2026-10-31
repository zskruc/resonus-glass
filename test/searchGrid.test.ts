import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { currentSearchData, readCurrentSearch, searchGridGeometry, searchGridItems, searchRequestKey } from '../src/lib/searchGrid';
import type { SearchResult } from '../src/api/data';

test('typing, clearing or shortening a query cannot expose an earlier debounced response', () => {
  const previous = { artists: [{ id: 'old', name: 'Previous' }], albums: [], songs: [] };
  assert.equal(currentSearchData(' Previous ', 'Previous', previous), previous);
  for (const input of ['New', '', ' ', 'P']) assert.equal(currentSearchData(input, 'Previous', previous), undefined);
  assert.equal(currentSearchData('New', 'New', undefined), undefined);
  assert.notDeepEqual(searchRequestKey('account-one', false, 'New'), searchRequestKey('account-two', false, 'New'));
  assert.notDeepEqual(searchRequestKey('account-one', false, 'New'), searchRequestKey('account-one', true, 'New'));
});

test('a superseded account, offline mode or cancelled query does not publish a late transport result', async () => {
  let current = true, calls = 0, finish!: (value: string) => void;
  const result = readCurrentSearch('Old', () => current, async (query) => {
    calls++; assert.equal(query, 'Old'); return new Promise<string>((resolve) => { finish = resolve; });
  });
  current = false; finish('previous-account-data');
  await assert.rejects(result, /superseded/);
  await assert.rejects(readCurrentSearch('New', () => current, async () => { calls++; return 'unexpected'; }), /superseded/);
  assert.equal(calls, 1, 'a scope already cancelled before the call cannot initiate another request');
  current = true;
  assert.equal(await readCurrentSearch('New', () => current, async () => 'current-account-data'), 'current-account-data');
});

test('filtered models keep stable media IDs, deduplicate repeated IDs and never mix kinds sharing a name', () => {
  const first = { id: 'one', name: 'Same title', coverArt: 'artist-one' };
  const result: SearchResult = { artists: [first, { id: 'two', name: 'Same title' }, { id: 'one', name: 'Duplicate' }],
    albums: [{ id: 'one', name: 'Same title', artist: 'Someone' }], songs: [] };
  const artists = searchGridItems('artists', result);
  assert.deepEqual(artists.map((item) => item.key), ['artist:one', 'artist:two']);
  assert.equal(artists[0].kind === 'artist' && artists[0].artist, first);
  assert.deepEqual(searchGridItems('albums', result).map((item) => item.key), ['album:one']);
  assert.deepEqual(searchGridItems('albums', undefined), []);
  assert.equal(result.artists.length, 3, 'the result cache is not modified');
});

test('portrait, landscape and narrow grids fit whole rows without overflowing or forcing giant tablet cards', () => {
  assert.equal(searchGridGeometry(328, 'artists', 16).columns, 3);
  assert.equal(searchGridGeometry(328, 'albums', 16).columns, 2);
  assert.equal(searchGridGeometry(720, 'artists', 16).columns, 6);
  assert.equal(searchGridGeometry(720, 'albums', 16).columns, 4);
  for (const kind of ['artists', 'albums'] as const) for (const width of [1, 31, 100, 220, 328, 440, 600, 720, 1024, 1300]) {
    const { columns, cardWidth } = searchGridGeometry(width, kind, 16);
    assert.ok(columns >= 1 && columns <= 8);
    assert.ok(cardWidth > 0);
    assert.ok(columns * cardWidth + (columns - 1) * 16 <= width);
  }
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const shape = searchGridGeometry(width, 'artists', 16);
    assert.ok(Number.isFinite(shape.cardWidth)); assert.equal(shape.columns, 1);
  }
});

type Element = { type: unknown; props: Record<string, any>; key?: string };
function renderer() {
  const coverRequests: string[] = [];
  const recent: any[] = [];
  const exports: Record<string, any> = {};
  const jsx = (type: unknown, props: Record<string, any>, key?: string): Element => ({ type, props, key });
  const imports: Record<string, unknown> = {
    react: { memo: (component: unknown) => component },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'expo-router': { Link: 'Link' },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { flatten: (value: unknown) => value } },
    'react-native-gesture-handler': { FlatList: 'VirtualGrid' },
    'react-native-reanimated': { __esModule: true, default: { createAnimatedComponent: (value: unknown) => value } },
    '@/api/data': { COVER: { card: 600 }, coverArtUrl: (id: string) => { coverRequests.push(id); return `cover:${id}`; } },
    '@/theme': { fontSize: { lg: 22, sm: 13 }, spacing: { md: 16, lg: 22, xs: 4 },
      themed: (create: (colors: unknown) => unknown) => create({ text: '#fff' }), useTheme: () => {} },
    '@/theme/appleMusic': { appleMusicStyles: { sectionTitle: {}, cardTitle: {} } },
    './AlbumCard': { AlbumCard: 'AlbumCard' }, './Cover': { Cover: 'Cover' },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/SearchResultGrid.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: (name: string) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const dock = () => {};
  const props = { identity: 'account:online:artists:query', items: [], columns: 3, cardWidth: 98,
    pagePadding: 16, bottomPadding: 180, title: 'Artists', feedback: null, appleMusic: true,
    onScroll: dock, addRecent: (item: unknown) => recent.push(item) };
  return { coverRequests, recent, dock, render: (options: Record<string, unknown> = {}) => exports.SearchResultGrid({ ...props, ...options }) as Element };
}

test('large result sets create covers only for requested virtual cells and use one dock-driven scroll surface', () => {
  const h = renderer();
  const artists = Array.from({ length: 10_000 }, (_, i) => ({ id: String(i), name: `Artist ${i}`, coverArt: `image-${i}` }));
  const items = searchGridItems('artists', { artists, albums: [], songs: [] });
  const tree = h.render({ items });
  assert.equal(tree.type, 'VirtualGrid'); assert.equal(tree.props.data.length, 10_000);
  assert.equal(h.coverRequests.length, 0, 'rendering the list does not eagerly resolve or load all 10,000 covers');
  assert.equal(tree.props.onScroll, h.dock);
  assert.equal(tree.props.initialNumToRender, 3, 'multi-column virtualization starts with three rows, at most nine artist covers');
  assert.equal(tree.props.maxToRenderPerBatch, 2); assert.equal(tree.props.windowSize, 5);
  assert.equal(tree.props.keyboardShouldPersistTaps, 'handled');
  const cell = tree.props.renderItem({ item: items[9_999] }) as Element;
  const link = cell.props.children as Element; const press = link.props.children as Element;
  assert.equal(link.props.href, '/artist/9999');
  assert.deepEqual(h.coverRequests, ['image-9999']);
  press.props.onPress();
  assert.equal(h.recent[0].id, '9999'); assert.equal(h.recent[0].kind, 'artist');
  assert.equal(h.recent[0].href, '/artist/9999');
});

test('album cells retain the shared card/menu, width, navigation callback and stable keys', () => {
  const h = renderer(); const album = { id: 'album', name: 'Record', artist: 'Singer', coverArt: 'art' };
  const items = searchGridItems('albums', { artists: [], albums: [album], songs: [] });
  const tree = h.render({ items, columns: 2, cardWidth: 156, identity: 'account:online:albums:query' });
  const card = tree.props.renderItem({ item: items[0] }).props.children as Element;
  assert.equal(card.type, 'AlbumCard'); assert.equal(card.props.album, album); assert.equal(card.props.width, 156);
  card.props.onPress();
  assert.equal(h.recent[0].kind, 'album'); assert.equal(h.recent[0].artist, 'Singer');
  assert.equal(h.recent[0].href, '/album/album'); assert.equal(tree.props.keyExtractor(items[0]), 'album:album');
  assert.notEqual(tree.key, h.render({ identity: 'account:online:artists:new-query', columns: 4 }).key,
    'query/filter/column changes get a fresh list instead of recycling another result layout');
});

test('an empty filtered grid retains its current loading/error/empty feedback with safe bottom padding', () => {
  const h = renderer(); const feedback = { type: 'Message', props: { message: 'retry' } };
  const tree = h.render({ feedback });
  assert.equal(tree.props.ListEmptyComponent, feedback);
  assert.equal(tree.props.ListHeaderComponent, null);
  assert.equal(tree.props.contentContainerStyle.paddingBottom, 180);
});
