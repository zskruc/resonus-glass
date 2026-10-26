import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Element = { type: any; props: Record<string, any> };
type Deps = readonly unknown[] | undefined;
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const event = (timestamp: number) => ({ nativeEvent: { timestamp }, stopPropagation() {} });
const turn = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// Persistent hook slots execute the production components and callbacks. No
// replacement key/ownership/index logic lives in this renderer.
function hooks() {
  let cursor = 0;
  const slots: any[] = [];
  const pending: (() => void)[] = [];
  const cleanups = new Set<() => void>();
  function slot<T>(create: () => T): T {
    const index = cursor++;
    if (!(index in slots)) slots[index] = create();
    return slots[index];
  }
  const changed = (a: Deps, b: Deps) => !a || !b || a.length !== b.length
    || a.some((value, index) => !Object.is(value, b[index]));
  function memo<T>(create: () => T, deps: Deps): T {
    const saved = slot(() => ({ deps: undefined as Deps, value: undefined as T | undefined }));
    if (changed(saved.deps, deps)) { saved.deps = deps; saved.value = create(); }
    return saved.value as T;
  }
  function effect(create: () => (() => void) | void, deps: Deps) {
    const saved = slot(() => ({ deps: undefined as Deps, cleanup: undefined as (() => void) | undefined }));
    if (!changed(saved.deps, deps)) return;
    saved.deps = deps;
    pending.push(() => {
      if (saved.cleanup) { cleanups.delete(saved.cleanup); saved.cleanup(); }
      saved.cleanup = create() || undefined;
      if (saved.cleanup) cleanups.add(saved.cleanup);
    });
  }
  const react = {
    useRef: <T,>(value: T) => slot(() => ({ current: value })),
    useState: <T,>(value: T | (() => T)) => {
      const state = slot(() => ({ value: typeof value === 'function' ? (value as () => T)() : value }));
      return [state.value, (next: T | ((previous: T) => T)) => {
        state.value = typeof next === 'function' ? (next as (previous: T) => T)(state.value) : next;
      }];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: Deps) => memo(() => callback, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    useId: () => slot(() => 'test-list-instance'),
    memo: (component: any, equal: any) => Object.assign(component, { equal }),
  };
  return {
    react,
    slot,
    begin() { cursor = 0; },
    commit() { while (pending.length) pending.shift()!(); },
    unmount() { for (const cleanup of cleanups) cleanup(); cleanups.clear(); },
  };
}

function load(path: string, react: object, imports: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports: Record<string, any> = {};
  runInNewContext(compiled.outputText, { exports, queueMicrotask,
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      assert.ok(Object.hasOwn(imports, name), `Unexpected ${path} import ${name}`);
      return imports[name];
    },
  });
  return exports;
}

const colors = { accent: '#f00', background: '#111', text: '#fff', textSecondary: '#aaa', textMuted: '#888' };
const theme = { colors, spacing: { sm: 8, md: 12, lg: 16 }, radius: { pill: 999 },
  fontSize: {}, tracking: {}, themed: (factory: (c: unknown) => unknown) => factory(colors), useTheme() {} };
const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator', Keyboard: { dismiss() {} },
  Animated: { Value: class { value: number; constructor(value: number) { this.value = value; } }, View: 'NativeAnimatedView',
    timing: () => ({ start() {} }) }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} } };
const icon = { __esModule: true, default: Object.assign(() => null, { glyphMap: {} }) };
function animation(runtime: ReturnType<typeof hooks>) {
  const values: any[] = [];
  const api = {
    __esModule: true,
    default: { createAnimatedComponent: (component: string) => `Animated:${component}`, View: 'AnimatedView' },
    Extrapolation: { CLAMP: 'clamp' },
    interpolate: () => 0,
    useSharedValue: (initial: unknown) => runtime.slot(() => {
      const mutable = { value: initial, animation: undefined as any,
        get() { return this.value; },
        set(next: any) { if (typeof next === 'object') this.animation = next; else this.value = next; } };
      values.push(mutable);
      return mutable;
    }),
    cancelAnimation: (value: any) => { value.animation = undefined; },
    withDelay: (duration: number, next: unknown) => ({ kind: 'delay', duration, next }),
    withTiming: (target: number) => ({ kind: 'timing', target }),
    useAnimatedStyle: (updater: () => unknown) => ({ updater }),
    useAnimatedScrollHandler: (callbacks: unknown) => callbacks,
    useComposedEventHandler: (handlers: unknown) => ({ handlers }),
    useDerivedValue: (updater: () => unknown) => ({ get: updater }),
    useAnimatedReaction() {},
  };
  return { api, values };
}

function find(tree: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) {
    for (const item of tree) { const match = find(item, predicate); if (match) return match; }
  } else if (tree && typeof tree === 'object' && 'props' in tree) {
    const element = tree as Element;
    if (predicate(element)) return element;
    return find(element.props.children, predicate);
  }
}

const songA = { id: 'A', title: 'Àlpha', artist: 'Singer', duration: 123, track: 1, starred: 'yes' };
const songB = { id: 'B', title: 'Beta', artist: 'Other', duration: 99, track: 2 };

function list() {
  const runtime = hooks();
  const anim = animation(runtime);
  const played: number[] = [];
  const removed: number[][] = [];
  const gestures: any[] = [];
  const scrolls: unknown[] = [];
  const dock = { dock: true };
  const module = load('components/TrackListView.tsx', runtime.react, {
    '@/components/glass': { GlassBackdrop: 'GlassBackdrop', GlassPressable: 'GlassPressable' },
    '@/components/Icon': icon,
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'expo-router': { Link: 'Link', useRouter: () => ({ push() {}, back() {} }) },
    '@shopify/flash-list': { FlashList: 'FlashList' },
    'react-native': native,
    'react-native-reanimated': anim.api,
    'react-native-worklets': { scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => callback(...args) },
    'react-native-gesture-handler': { ScrollView: 'GHScrollView', GestureDetector: 'GestureDetector', Gesture: { Pan() {
      const pan = { options: {} as any, callbacks: {} as any } as any;
      for (const name of ['withRef', 'enabled', 'activeOffsetY', 'failOffsetY'])
        pan[name] = (value: unknown) => { pan.options[name] = value; return pan; };
      for (const name of ['onBegin', 'onChange']) pan[name] = (callback: unknown) => { pan.callbacks[name] = callback; return pan; };
      gestures.push(pan); return pan;
    } } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/hooks/useDominantColor': { useCoverTint: () => ({ color: '#333', known: true }) },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 20 },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => dock },
    '@/hooks/useScreenSize': { centredPadding: () => 16, useScreenSize: () => ({ width: 400, height: 800 }) },
    '@/hooks/useSelectionMenu': { useSelectionMenu: () => ({ actions: [], dialogs: null }) },
    '@/i18n': { useT: () => (value: string) => value },
    '@/lib/artistNav': { artistTargets: () => [] },
    '@/lib/haptics': { haptic() {} },
    '@/store/artistPicker': { useArtistPicker: (select: (s: unknown) => unknown) => select({ open() {} }) },
    '@/store/player': { usePlayerStore: (select: (s: unknown) => unknown) => select({ shuffle: false, queueDealt: false }) },
    '@/theme': theme,
    '@/theme/motion': { motion: { duration: { fade: 120 }, reduceMotion: { decorative: 'system' } } },
    './BackChevron': { BackChevron: 'Back' }, './BarBlur': { TopBarBackground: 'TopBar' },
    './Cover': { Cover: 'Cover' }, './FavoriteButton': { FavoriteButton: 'Favorite' },
    './ExplicitBadge': { ExplicitBadge: 'Explicit', useExplicitBadge: () => false },
    './SelectionBar': { SelectionBar: 'SelectionBar' }, './TrackRow': { TrackRow: 'TrackRow' },
  });
  let tree: Element;
  let props: Record<string, any> = { title: 'Playlist', songs: [songA, songB, songA],
    playlistId: 'p1', playlistIndices: [4, 8, 12], searchable: true, showArtwork: true,
    onPlay: (index: number) => played.push(index), selection: { onRemove: (_songs: unknown, indices: number[]) => removed.push(indices) },
    footer: jsx('Footer', {}), emptyState: jsx('Empty', {}), discHeaders: { 0: 'Disc one' } };
  function render(next: Record<string, unknown> = {}) {
    props = { ...props, ...next }; runtime.begin(); tree = module.TrackListView(props); runtime.commit();
    const ref = recycler().props.ref;
    if (ref && !ref.current) ref.current = { scrollToOffset: (options: unknown) => scrolls.push(options) };
    return tree;
  }
  const recycler = () => find(tree, (node) => node.type === 'Animated:FlashList')!;
  const row = (index: number) => find(recycler().props.renderItem({ item: recycler().props.data[index], index }), (node) => node.type === 'TrackRow')!;
  const search = () => find(recycler().props.ListHeaderComponent, (node) => node.type === 'TextInput')!;
  render();
  return { render, recycler, row, search, played, removed, gestures, scrolls, dock,
    selectionBar: () => find(tree, (node) => node.type === 'SelectionBar')!,
    tree: () => tree };
}

function flashListCell(listProps: Record<string, any>) {
  const runtime = hooks();
  // Run the installed 2.0.2 ViewHolder itself, including its children memo.
  // In that release the memo omits index, so an index-only harness would miss
  // the actual duplicate-Song failure that occurrence descriptors prevent.
  const module = load('../node_modules/@shopify/flash-list/src/recyclerview/ViewHolder.tsx',
    { __esModule: true, default: runtime.react, ...runtime.react }, {
      'react-native': native, './components/CompatView': { CompatView: 'FlashListCell' },
    });
  const calls: string[] = [];
  const renderItem = (info: any) => {
    calls.push(info.item.rowKey);
    return listProps.renderItem(info);
  };
  const refHolder = new Map();
  const render = (index: number) => {
    runtime.begin();
    const tree = module.ViewHolder({
      item: listProps.data[index], index, renderItem, extraData: listProps.extraData,
      target: 'Cell', refHolder, layout: { x: 0, y: index * 64, width: 400, height: 64 },
    });
    runtime.commit();
    return find(tree, (node) => node.type === 'TrackRow')!;
  };
  return { render, calls };
}

function row() {
  const runtime = hooks();
  const anim = animation(runtime);
  const presses: string[] = [];
  const longs: string[] = [];
  const menus: string[] = [];
  const pressModule = load('hooks/usePressFeedback.ts', runtime.react, {
    'react-native-reanimated': anim.api, '@/theme/motion': { motion: { duration: { press: 120, exit: 100 } } },
  });
  const module = load('components/TrackRow.tsx', runtime.react, {
    '@/components/Icon': icon,
    'react-native': native,
    'react-native-reanimated': anim.api,
    '@/api/data': { COVER: { thumb: 96 }, songCoverUrl: (song: any) => song.id, star() {} },
    '@/hooks/useFavoriteIds': { useFavoriteIds: () => new Set(['A']) },
    '@/lib/format': { formatDuration: () => '2:03' },
    '@/lib/favoritesCache': { applyStarChange() {}, resyncFavorites() {}, unstarWithUndo() {} },
    '@/store/auth': { useAuthStore: (select: (s: unknown) => unknown) => select({ offline: false }) },
    '@/store/downloads': { useDownloads: (select: (s: unknown) => unknown) => select({ files: {} }) },
    '@/store/player': { usePlayerStore: (select: (s: unknown) => unknown) => select({ addToQueue() {}, playNext() {} }) },
    '@/store/songMenu': { useSongMenu: (select: (s: unknown) => unknown) => select({ open: (song: any) => menus.push(song.id) }) },
    '@/store/settings': { useSettings: (select: (s: unknown) => unknown) => select({ showSongDuration: true, showListRating: false, swipeAction: 'queue', swipeLeftAction: 'off' }) },
    '@/lib/haptics': { haptic() {} },
    '@/store/toast': { useToast: (select: (s: unknown) => unknown) => select({ show() {} }) },
    '@/i18n': { useT: () => (value: string) => value },
    '@/theme': theme,
    './Cover': { Cover: 'Cover', useCoverRadius: () => 4 },
    '@/hooks/usePressFeedback': pressModule,
    '@/lib/perfLog': { bump() {} },
    './PlayingBars': { PlayingBars: 'PlayingBars' },
    './ExplicitBadge': { ExplicitBadge: 'Explicit', useExplicitBadge: () => false },
    './FavoriteButton': { FavoriteButton: 'Favorite' },
    './TrackSwipeable': { TrackSwipeable: 'TrackSwipeable' },
  });
  let tree: Element;
  let props: Record<string, any> = { song: songA, rowOccurrenceKey: 'A#0', displayIndex: 0, serverIndex: 4,
    ownerScope: 'list-one', showArtwork: true, onPress: () => presses.push('A'), onLongPress: () => longs.push('A') };
  const render = (next: Record<string, unknown> = {}) => {
    props = { ...props, ...next }; runtime.begin(); tree = module.TrackRow(props); runtime.commit(); return tree;
  };
  render();
  return { render, presses, longs, menus, props: () => props, equal: module.TrackRow.equal,
    body: () => find(tree, (node) => node.type === 'Animated:Pressable')!,
    menu: () => find(tree, (node) => node.type === 'Pressable')!,
    tree: () => tree, values: anim.values, unmount: runtime.unmount };
}

describe('recycled shared playlist rendering and positions', () => {
  it('keeps the GH scroll host stable and both scroll animations wired while recycling two bounded row types', () => {
    const h = list();
    const first = h.recycler().props;
    assert.equal(first.maxItemsInRecyclePool, 32);
    assert.equal(first.maintainVisibleContentPosition.disabled, true);
    for (const prop of ['windowSize', 'initialNumToRender', 'removeClippedSubviews', 'drawDistance'])
      assert.equal(prop in first, false);
    assert.equal(first.getItemType(first.data[0], 0), 'disc');
    assert.equal(first.getItemType(first.data[1], 1), 'track');
    const host = first.renderScrollComponent({ marker: true });
    assert.equal(host.type, 'GHScrollView');
    assert.equal(host.props.simultaneousHandlers, h.gestures[0].options.withRef);
    assert.equal(first.onScroll.handlers.length, 2);
    assert.equal(first.onScroll.handlers[1], h.dock);
    first.onScroll.handlers[0].onScroll({ contentOffset: { y: 50 } });
    h.search().props.onFocus(); h.render();
    assert.equal(h.recycler().props.renderScrollComponent, first.renderScrollComponent);
    assert.ok(h.recycler().props.ListHeaderComponent);
    assert.ok(h.recycler().props.ListFooterComponent);
  });

  it('keeps duplicate keys distinct, filtering accents and preserving unfiltered playback/server positions', () => {
    const h = list();
    const initial = h.recycler().props;
    assert.notEqual(initial.keyExtractor(initial.data[0], 0), initial.keyExtractor(initial.data[2], 2));
    h.search().props.onChangeText('alpha'); h.render();
    assert.equal(h.recycler().props.data.length, 2);
    const second = h.row(1);
    assert.equal(second.props.displayIndex, 2);
    assert.equal(second.props.serverIndex, 12);
    assert.equal(second.props.menuContext.index, 12);
    assert.equal(second.props.rowOccurrenceKey, initial.keyExtractor(initial.data[2], 2));
    second.props.onPress();
    assert.deepEqual(h.played, [2]);
    assert.equal(h.recycler().props.getItemType(h.recycler().props.data[0], 0), 'track');
    assert.equal(find(h.recycler().props.renderItem({ item: h.recycler().props.data[0], index: 0 }), (node) => node.type === 'DiscHeader'), undefined);
  });

  it('keeps occurrence descriptors stable across unrelated renders and filters while retaining the original Song references', () => {
    const h = list();
    const initial = h.recycler().props.data;
    assert.notEqual(initial[0], initial[2]);
    assert.equal(initial[0].song, songA);
    assert.equal(initial[2].song, songA);
    h.render({ currentId: 'B' });
    assert.equal(h.recycler().props.data, initial);
    h.search().props.onChangeText('alpha'); h.render();
    assert.equal(h.recycler().props.data[0], initial[0]);
    assert.equal(h.recycler().props.data[1], initial[2]);
    assert.equal(h.row(1).props.song, songA);
    h.render({ songs: [songA, songA, songB], playlistIndices: [12, 4, 8] });
    const moved = h.recycler().props.data[0];
    assert.equal(moved.song, songA);
    assert.equal(moved.rowKey, initial[2].rowKey);
    assert.equal(moved.origIndex, 0);
    assert.equal(moved.serverIndex, 12);
    assert.notEqual(moved, initial[2]);
  });

  it('refreshes duplicate playback, menus and selection identity through the actual installed FlashList ViewHolder memo', () => {
    for (const playlistIndices of [[4, 8, 12], undefined]) {
      const h = list();
      h.render({ playlistIndices });
      const props = h.recycler().props;
      const cell = flashListCell(props);
      const first = cell.render(0);
      first.props.onPress();
      const duplicate = cell.render(2);
      duplicate.props.onPress();
      assert.deepEqual(h.played, [0, 2]);
      assert.equal(first.props.song, songA);
      assert.equal(duplicate.props.song, songA);
      assert.equal(duplicate.props.displayIndex, 2);
      assert.equal(duplicate.props.serverIndex, playlistIndices ? 12 : 2);
      assert.equal(duplicate.props.menuContext.index, playlistIndices ? 12 : 2);
      assert.equal(duplicate.props.rowOccurrenceKey, props.data[2].rowKey);
      assert.notEqual(duplicate.props.rowOccurrenceKey, first.props.rowOccurrenceKey);
      assert.deepEqual(cell.calls, [props.data[0].rowKey, props.data[2].rowKey]);
      cell.render(2);
      assert.equal(cell.calls.length, 2);
      duplicate.props.onLongPress(); h.render();
      assert.equal(h.row(2).props.selected, true);
      assert.equal(h.row(0).props.selected, false);
    }
  });

  it('preserves selected duplicate occurrence after sorting and removes its original server position', () => {
    const h = list();
    h.row(2).props.onLongPress(); h.render();
    h.render({ songs: [songA, songA, songB], playlistIndices: [12, 4, 8] });
    assert.equal(h.row(0).props.selected, true);
    assert.equal(h.row(1).props.selected, false);
    h.selectionBar().props.actions.find((action: any) => action.icon === 'remove-circle-outline').onPress();
    assert.equal(JSON.stringify(h.removed), '[[12]]');
  });

  it('refreshes playback behavior through an existing memoized row callback and preserves current marker/empty content', () => {
    const h = list();
    const oldPress = h.row(1).props.onPress;
    h.render({ onPlay: (index: number) => h.played.push(index + 100), currentId: 'B' });
    oldPress();
    assert.deepEqual(h.played, [101]);
    assert.equal(h.row(1).props.isCurrent, true);
    h.render({ songs: [] });
    assert.ok(find(h.recycler().props.ListEmptyComponent, (node) => node.type === 'Empty'));
    assert.ok(h.recycler().props.ListFooterComponent);
  });

  it('retains pull-to-reveal, description expansion, no-results and cancel-to-top through the recycler', () => {
    const h = list();
    const stableHost = h.recycler().props.renderScrollComponent;
    h.render({ description: 'A description spanning several lines.' });
    const measure = find(h.recycler().props.ListHeaderComponent, (node) => !!node.props.onTextLayout)!;
    measure.props.onTextLayout({ nativeEvent: { lines: [{}, {}, {}] } }); h.render();
    const more = find(h.recycler().props.ListHeaderComponent, (node) => node.type === 'GlassPressable'
      && node.props.children?.props.children === 'Show more')!;
    more.props.onPress(); h.render();
    assert.ok(find(h.recycler().props.ListHeaderComponent, (node) => node.type === 'Text'
      && node.props.children === 'A description spanning several lines.' && !node.props.onTextLayout
      && node.props.numberOfLines === undefined));
    h.gestures.at(-1).callbacks.onBegin();
    h.gestures.at(-1).callbacks.onChange({ translationY: 70 }); h.render();
    assert.equal(h.gestures.at(-1).options.enabled, false);
    h.search().props.onFocus(); h.search().props.onChangeText('unmatched'); h.render();
    assert.equal(h.recycler().props.data.length, 0);
    assert.ok(h.recycler().props.ListEmptyComponent);
    const cancel = find(h.recycler().props.ListHeaderComponent, (node) => node.type === 'GlassPressable'
      && node.props.children?.props.children === 'Cancel')!;
    cancel.props.onPress(); h.render();
    assert.equal(h.recycler().props.data.length, 3);
    assert.equal(h.search().props.value, '');
    assert.equal(JSON.stringify(h.scrolls), '[{"offset":0,"animated":false}]');
    assert.equal(h.recycler().props.renderScrollComponent, stableHost);
  });
});

describe('production recycled row and press feedback ownership', () => {
  it('compares duplicate occurrence, playback/server position and list scope even for the same Song object', () => {
    const h = row();
    for (const [field, value] of Object.entries({ rowOccurrenceKey: 'A#1', displayIndex: 1, serverIndex: 12, ownerScope: 'list-two' }))
      assert.equal(h.equal(h.props(), { ...h.props(), [field]: value }), false, field);
    const cover = find(h.tree(), (node) => node.type === 'Cover')!;
    const favorite = find(h.tree(), (node) => node.type === 'Favorite')!;
    assert.equal(cover.props.resetKey, favorite.props.resetKey);
    h.render({ rowOccurrenceKey: 'A#1', displayIndex: 1, serverIndex: 12 });
    assert.notEqual(find(h.tree(), (node) => node.type === 'Cover')!.props.resetKey, cover.props.resetKey);
  });

  it('cancels delayed dimming on rebind, ignores old callbacks and returns opacity to one', () => {
    const h = row();
    const old = h.body().props;
    old.onPressIn(event(10));
    assert.equal(h.values[0].animation.kind, 'delay');
    h.render({ song: songB, rowOccurrenceKey: 'B#0', onPress: () => h.presses.push('B') });
    assert.equal(h.values[0].get(), 1);
    assert.equal(h.values[0].animation, undefined);
    old.onPressIn(event(10)); old.onPress(event(11)); old.onLongPress(event(11));
    assert.equal(h.values[0].animation, undefined);
    assert.deepEqual(h.presses, []);
    assert.deepEqual(h.longs, []);
    h.body().props.onTouchStart(event(20)); h.body().props.onPressIn(event(20)); h.body().props.onPress(event(21));
    assert.deepEqual(h.presses, ['B']);
  });

  it('rejects A pointer release delivered to B latest callbacks and permits later accessibility activation', async () => {
    const h = row();
    h.body().props.onTouchStart(event(10)); h.body().props.onPressIn(event(10));
    h.render({ song: songB, rowOccurrenceKey: 'B#0', onPress: () => h.presses.push('B'), onLongPress: () => h.longs.push('B') });
    const latest = h.body().props;
    latest.onLongPress(event(11)); latest.onTouchEnd(event(12)); latest.onPressOut(event(12)); latest.onPress(event(12));
    assert.deepEqual(h.presses, []);
    assert.deepEqual(h.longs, []);
    await turn(); latest.onPress(event(30));
    assert.deepEqual(h.presses, ['B']);
  });

  it('does not adopt a held finger that leaves A press rect and re-enters after recycling to B', async () => {
    const h = row();
    h.body().props.onTouchStart(event(10)); h.body().props.onPressIn(event(10));
    h.body().props.onPressOut(event(11)); await turn();
    h.render({ song: songB, rowOccurrenceKey: 'B#0', onPress: () => h.presses.push('B'), onLongPress: () => h.longs.push('B') });
    h.body().props.onPressIn(event(12)); h.body().props.onLongPress(event(12)); h.body().props.onPress(event(13));
    assert.deepEqual(h.presses, []);
    assert.deepEqual(h.longs, []);
  });

  it('keeps an old delayed PressOut from clearing a newer pointer before another recycle', async () => {
    const h = row();
    const a = h.body().props;
    a.onPressIn(event(10)); a.onPress(event(11));
    h.render({ song: songB, rowOccurrenceKey: 'B#0' });
    h.body().props.onPressIn(event(20));
    a.onPressOut(event(11)); h.body().props.onPressOut(event(11)); await turn();
    h.render({ rowOccurrenceKey: 'C#0', onPress: () => h.presses.push('C') });
    h.body().props.onPress(event(21));
    assert.deepEqual(h.presses, ['A']);
  });

  it('isolates ABA pointers and nested menu presses when the native view is reused', () => {
    const h = row();
    h.body().props.onTouchStart(event(10)); h.body().props.onPressIn(event(10));
    h.menu().props.onTouchStart(event(10)); h.menu().props.onPressIn(event(10));
    h.render({ rowOccurrenceKey: 'B#0' }); h.render({ rowOccurrenceKey: 'A#0' });
    h.body().props.onPress(event(11)); h.body().props.onLongPress(event(11)); h.menu().props.onPress(event(11));
    assert.deepEqual(h.presses, []); assert.deepEqual(h.longs, []); assert.deepEqual(h.menus, []);
    h.menu().props.onTouchStart(event(20)); h.menu().props.onPressIn(event(20)); h.menu().props.onPress(event(21));
    assert.deepEqual(h.menus, ['A']);
  });
});
