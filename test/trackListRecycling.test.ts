import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { isValidElement } from 'react';

import { voltaDetailBackground } from '../src/lib/voltaPalette';
import { buildMinidiscAlbumPalette, minidiscAlbumCoverSize } from '../src/lib/minidiscAlbumPalette';
import { type UiStyle } from '../src/lib/uiStyle';

const { transformSync } = createRequire(import.meta.url)('@babel/core') as {
  transformSync(source: string, options: Record<string, unknown>): { code?: string | null } | null;
};

type Element = { type: any; props: Record<string, any> };
type Deps = readonly unknown[] | undefined;
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const event = (timestamp: number) => ({ nativeEvent: { timestamp }, stopPropagation() {} });
const turn = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// Persistent hook slots execute the production components and callbacks. No
// replacement key/ownership/index logic lives in this renderer.
function hooks() {
  let cursor = 0;
  let stateWrites = 0;
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
        stateWrites++;
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
    get stateWrites() { return stateWrites; },
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
  const settings: { uiStyle: UiStyle } = { uiStyle: 'spotify' };
  const timings: { toValue: number; complete(finished?: boolean): void; stops: number }[] = [];
  const listNative = { ...native, Animated: { ...native.Animated, timing: (_value: unknown, config: { toValue: number }) => {
    let callback: ((result: { finished: boolean }) => void) | undefined;
    const job = { toValue: config.toValue, stops: 0,
      complete(finished = true) { callback?.({ finished }); },
      start(next: typeof callback) { callback = next; },
      stop() { this.stops++; callback?.({ finished: false }); } };
    timings.push(job); return job;
  } } };
  const runtime = hooks();
  const anim = animation(runtime);
  const played: number[] = [];
  const removed: number[][] = [];
  const gestures: any[] = [];
  const scrolls: unknown[] = [];
  const dock = { dock: true };
  const module = load('components/TrackListView.tsx', runtime.react, {
    '@/components/glass': { GlassBackdrop: 'GlassBackdrop', GlassPressable: 'GlassPressable' },
    '@/components/PlaylistDetailHeader': load('components/PlaylistDetailHeader.tsx', runtime.react, {
      'react-native': listNative, './Icon': icon, './Cover': { Cover: 'Cover' },
      '@/i18n': { useT: () => (value: string) => value }, '@/theme': theme,
    }),
    '@/components/Icon': icon,
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'expo-router': { Link: 'Link', useRouter: () => ({ push() {}, back() {} }) },
    '@shopify/flash-list': { FlashList: 'FlashList' },
    'react-native': listNative,
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
    '@/lib/voltaPalette': { voltaDetailBackground },
    '@/lib/minidiscAlbumPalette': { minidiscAlbumCoverSize },
    '@/components/volta/MinidiscAlbumHeader': { MinidiscAlbumHeader: 'MinidiscAlbumHeader' },
    '@/store/artistPicker': { useArtistPicker: (select: (s: unknown) => unknown) => select({ open() {} }) },
    '@/store/player': { usePlayerStore: (select: (s: unknown) => unknown) => select({ shuffle: false, queueDealt: false }) },
    '@/store/settings': { useSettings: (select: (s: unknown) => unknown) => select(settings) },
    '@/theme': theme,
    '@/theme/motion': { motion: { duration: { fade: 120 }, reduceMotion: { decorative: 'system' } } },
    './BackChevron': { BackChevron: 'Back' }, './BarBlur': { TopBarBackground: 'TopBar' },
    './Cover': { Cover: 'Cover' }, './FavoriteButton': { FavoriteButton: 'Favorite' },
    './ExplicitBadge': { ExplicitBadge: 'Explicit', useExplicitBadge: () => false },
    './SelectionBar': { SelectionBar: 'SelectionBar' }, './TrackRow': { TrackRow: 'TrackRow' },
  });
  let tree: Element;
  const nativeList = { scrollToOffset: (options: unknown) => scrolls.push(options) };
  let mountedRef: any;
  let props: Record<string, any> = { title: 'Playlist', songs: [songA, songB, songA],
    playlistId: 'p1', playlistIndices: [4, 8, 12], searchable: true, showArtwork: true,
    onPlay: (index: number) => played.push(index), selection: { onRemove: (_songs: unknown, indices: number[]) => removed.push(indices) },
    footer: jsx('Footer', {}), emptyState: jsx('Empty', {}), discHeaders: { 0: 'Disc one' } };
  function render(next: Record<string, unknown> = {}) {
    props = { ...props, ...next }; runtime.begin(); tree = module.TrackListView(props); runtime.commit();
    const ref = recycler().props.ref;
    if (ref !== mountedRef) {
      if (typeof mountedRef === 'function') mountedRef(null);
      else if (mountedRef) mountedRef.current = null;
      if (typeof ref === 'function') ref(nativeList);
      else if (ref) ref.current = nativeList;
      mountedRef = ref;
    }
    return tree;
  }
  const recycler = () => find(tree, (node) => node.type === 'Animated:FlashList')!;
  const row = (index: number) => find(recycler().props.renderItem({ item: recycler().props.data[index], index }), (node) => node.type === 'TrackRow')!;
  const search = () => find(recycler().props.ListHeaderComponent, (node) => node.type === 'TextInput')!;
  render();
  return { render, recycler, row, search, played, removed, gestures, scrolls, dock, timings, animatedValues: anim.values,
    setUiStyle(style: UiStyle) { settings.uiStyle = style; return render(); },
    unmount: runtime.unmount, stateWrites: () => runtime.stateWrites,
    material: () => find(recycler().props.ListHeaderComponent, (node) => node.type === 'GlassBackdrop'),
    detach() { if (typeof mountedRef === 'function') mountedRef(null); else if (mountedRef) mountedRef.current = null; },
    attach(instance: unknown) { if (typeof mountedRef === 'function') mountedRef(instance); else if (mountedRef) mountedRef.current = instance; },
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

function nativeAnimatedObject() {
  // Compile the installed RN implementation, including its real depth limit,
  // ReactElement checks and recursive traversal. Stub only native base classes.
  const source = readFileSync(new URL('../node_modules/react-native/Libraries/Animated/nodes/AnimatedObject.js', import.meta.url), 'utf8');
  const compiled = transformSync(source, { configFile: false, babelrc: false, plugins: [
    'babel-plugin-syntax-hermes-parser', '@babel/plugin-transform-flow-strip-types', '@babel/plugin-transform-modules-commonjs',
  ] });
  const exports: Record<string, any> = {};
  class Node {}
  runInNewContext(compiled!.code!, { exports, Object, require(name: string) {
    if (name === './AnimatedNode' || name === './AnimatedWithChildren') return { __esModule: true, default: Node };
    if (name === 'react') return { isValidElement };
    throw new Error(`Unexpected RN AnimatedObject dependency ${name}`);
  } });
  return exports.default as { from(value: unknown): unknown };
}

function row() {
  const runtime = hooks();
  let pagePalette: Record<string, string> | undefined;
  const anim = animation(runtime);
  const presses: string[] = [];
  const longs: string[] = [];
  const menus: string[] = [];
  const settings = { uiStyle: 'spotify' as UiStyle, showSongDuration: true, showListRating: false,
    swipeAction: 'queue', swipeLeftAction: 'off' };
  const settingsModule = { useSettings: (select: (s: unknown) => unknown) => select(settings) };
  const styleModule = load('theme/appleMusic.ts', runtime.react, {
    'react-native': native, '@/theme': theme,
  });
  const styleHookModule = load('hooks/useAppleMusicStyle.ts', runtime.react, {
    '@/store/settings': settingsModule,
  });
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
    '@/store/settings': settingsModule,
    '@/lib/haptics': { haptic() {} },
    '@/store/toast': { useToast: (select: (s: unknown) => unknown) => select({ show() {} }) },
    '@/i18n': { useT: () => (value: string) => value },
    '@/theme': theme,
    '@/hooks/useAppleMusicStyle': styleHookModule,
    '@/theme/appleMusic': styleModule,
    '@/components/volta/ArtistPagePalette': { useArtistPagePalette: () => pagePalette },
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
    setUiStyle(style: UiStyle) { settings.uiStyle = style; return render(); },
    setPagePalette(value: Record<string, string> | undefined) { pagePalette = value; return render(); },
    body: () => find(tree, (node) => node.type === 'Animated:Pressable')!,
    menu: () => find(tree, (node) => node.type === 'Pressable')!,
    tree: () => tree, values: anim.values, unmount: runtime.unmount };
}

describe('recycled shared playlist rendering and positions', () => {
  it('applies the artist page foreground after Apple row styling and restores defaults outside its context', () => {
    const h = row();
    h.setUiStyle('appleMusic');
    const palette = { text: '#FAF9F3', textSecondary: '#D5D1C8', textMuted: '#C2BCAF', accent: '#F3E9D2' };
    h.setPagePalette(palette);
    const textColor = (text: string | number) => {
      const node = find(h.tree(), element => element.type === 'Text' && element.props.children === text)!;
      return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)).color;
    };
    assert.equal(textColor(songA.title), palette.text);
    assert.equal(textColor(songA.artist), palette.textSecondary);
    assert.equal(textColor('2:03'), palette.textMuted);
    assert.equal(h.menu().props.children.props.color, palette.textSecondary);
    h.render({ isCurrent: true });
    assert.equal(textColor(songA.title), palette.accent);
    h.render({ position: 4, isCurrent: false });
    assert.equal(textColor(4), palette.textMuted);
    h.setPagePalette(undefined);
    assert.equal(textColor(songA.title), colors.text);
    assert.equal(textColor(songA.artist), colors.textSecondary);
    assert.equal(textColor(4), colors.textMuted);
    h.body().props.onPress(event(1));
    assert.deepEqual(h.presses, ['A'], 'the scoped palette never changes the live press binding');
  });

  it('switches the real header presentation without resetting occurrences, callbacks or duplicate selection', () => {
    const h = list();
    const initial = h.recycler().props;
    const oldPress = h.row(2).props.onPress;
    const containsPlayLabel = () => !!find(h.recycler().props.ListHeaderComponent,
      (node) => node.type === 'Text' && node.props.children === 'Play');
    assert.equal(containsPlayLabel(), false, 'the retained Spotify header has its original icon-only Play');
    h.setUiStyle('appleMusic');
    assert.equal(containsPlayLabel(), true, 'the actual optional Apple header has its labeled Play pill');
    assert.equal(h.recycler().props.data, initial.data);
    assert.equal(h.recycler().props.ref, initial.ref);
    assert.equal(h.recycler().props.renderScrollComponent, initial.renderScrollComponent);
    assert.equal(h.recycler().props.onScroll.handlers[1], h.dock);
    assert.deepEqual(h.recycler().props.data.map((item: any) => item.rowKey), initial.data.map((item: any) => item.rowKey));
    oldPress();
    assert.deepEqual(h.played, [2], 'a pre-switch callback still targets the original duplicate occurrence');
    h.row(2).props.onLongPress(); h.render();
    h.setUiStyle('spotify');
    assert.equal(containsPlayLabel(), false);
    assert.equal(h.recycler().props.data, initial.data);
    assert.equal(h.row(2).props.selected, true);
    assert.equal(h.row(0).props.selected, false);
    h.selectionBar().props.actions.find((action: any) => action.icon === 'remove-circle-outline').onPress();
    assert.equal(JSON.stringify(h.removed), '[[12]]', 'switching style must not change the selected server position');
  });

  it('switches Volta and Minidisc albums without replacing the recycler, scroll owner or duplicate selection', () => {
    const h = list();
    h.setUiStyle('appleMusic');
    const initial = h.recycler();
    const oldPress = h.row(2).props.onPress;
    initial.props.onScroll.handlers[0].onScroll({ contentOffset: { y: 420 } });
    const position = h.animatedValues.find((value) => value.get() === 420);
    assert.ok(position, 'the production scroll handler must update its real shared value');
    oldPress();
    assert.deepEqual(h.played, [2]);
    h.row(2).props.onLongPress(); h.render();

    const albumPresentation = { palette: buildMinidiscAlbumPalette('#F5B52F', false), meta: 'Electronic · 2026' };
    for (const presentation of [albumPresentation, undefined, albumPresentation, undefined]) {
      h.render({ albumPresentation: presentation });
      const current = h.recycler();
      assert.equal(!!find(current.props.ListHeaderComponent, (node) => node.type === 'MinidiscAlbumHeader'), !!presentation);
      assert.equal(current.type, initial.type);
      assert.equal(current.props.ref, initial.props.ref, 'the same native FlashList owns the scroll position');
      assert.equal(current.props.renderScrollComponent, initial.props.renderScrollComponent);
      assert.equal(current.props.data, initial.props.data);
      assert.equal(current.props.onScroll.handlers[1], h.dock);
      assert.ok(h.animatedValues.includes(position));
      assert.equal(position.get(), 420, 'changing only album presentation cannot reset native scrolling');
      assert.equal(h.row(2).props.selected, true);
      assert.equal(h.row(0).props.selected, false);
    }
    assert.deepEqual(h.scrolls, [], 'no imperative scroll reset is requested');
    h.render({ albumPresentation });
    h.setUiStyle('spotify');
    assert.equal(find(h.recycler().props.ListHeaderComponent, (node) => node.type === 'MinidiscAlbumHeader'), undefined,
      'the saved album preference never replaces Spotify pages');
    h.selectionBar().props.actions.find((action: any) => action.icon === 'remove-circle-outline').onPress();
    assert.equal(JSON.stringify(h.removed), '[[12]]', 'the selected occurrence keeps its original server position');
  });

  it('uses the original Volta album action row and retains favorite in its existing overflow menu', () => {
    const h = list();
    const played: { index: number; shuffled?: boolean }[] = [];
    let downloads = 0, menus = 0;
    const album = { albumActionLayout: 'volta', favorite: { id: 'album-one', type: 'album', starred: true },
      download: { status: 'done', progress: 1, onPress: () => { downloads++; } },
      onMenu: () => { menus++; }, onPlay: (index: number, options?: { shuffled?: boolean }) => played.push({ index, ...options }) };
    h.setUiStyle('appleMusic'); h.render(album);
    const initial = h.recycler().props;
    const header = () => h.recycler().props.ListHeaderComponent;
    const buttons: Element[] = [];
    function collect(tree: unknown) {
      if (Array.isArray(tree)) { tree.forEach(collect); return; }
      if (!tree || typeof tree !== 'object' || !('props' in tree)) return;
      const element = tree as Element;
      if (element.type === 'GlassPressable' && element.props.accessibilityLabel) buttons.push(element);
      collect(element.props.children);
    }
    collect(header());
    assert.deepEqual(buttons.map((button) => button.props.accessibilityLabel), ['Shuffle', 'Play', 'Remove download', 'More options']);
    assert.equal(find(header(), (node) => node.type === 'Favorite'), undefined,
      'favorite must not occupy a disconnected second row under Play');
    for (const button of buttons) button.props.onPress();
    assert.deepEqual(played, [{ index: 0, shuffled: true }, { index: 0 }]);
    assert.equal(downloads, 1);
    assert.equal(menus, 1, 'the overflow opens the existing album menu with its favorite action');
    assert.equal(h.recycler().props.data, initial.data);
    assert.equal(h.recycler().props.ref, initial.ref);
    assert.equal(h.recycler().props.renderScrollComponent, initial.renderScrollComponent);
    h.row(2).props.onLongPress(); h.render();
    assert.equal(h.row(2).props.selected, true, 'the compact action row must retain batch selection');
    h.render({ download: undefined });
    assert.equal(find(header(), (node) => node.props.accessibilityLabel === 'Download')!.props.disabled, true,
      'offline albums keep a stable four-slot layout without enabling unavailable downloads');
    assert.ok(find(header(), (node) => node.props.accessibilityLabel === 'More options'));
    const palette = buildMinidiscAlbumPalette('#F5B52F', false);
    h.render({ albumPresentation: { palette, meta: 'Electronic · 2026' } });
    assert.equal(find(header(), (node) => node.type === 'MinidiscAlbumHeader')!.props.palette, palette,
      'Minidisc keeps its own existing action presentation');
    h.setUiStyle('spotify');
    assert.ok(find(header(), (node) => node.type === 'Favorite'), 'Spotify keeps its original favorite control');
  });

  it('passes a stable function ref so installed RN Animated cannot traverse twenty thousand playlist occurrences', () => {
    const h = list();
    h.render({ songs: Array.from({ length: 20_000 }, (_, index) => ({ ...songA, id: String(index) })) });
    const first = h.recycler().props;
    let inspectedRows = 0;
    // Normalize VM-created occurrence prototypes into the dependency's realm.
    const data = first.data.map((item: object) => new Proxy({ ...item }, {
      ownKeys(target) { inspectedRows++; return Reflect.ownKeys(target); },
    }));
    const imperativeApi = {};
    // FlashList's actual imperative API exposes this enumerable props getter.
    Object.defineProperty(imperativeApi, 'props', { enumerable: true, get: () => ({ ...first, data }) });
    const animatedObject = nativeAnimatedObject();
    animatedObject.from({ current: imperativeApi });
    assert.equal(inspectedRows, 20_000, 'the old forwarded object ref reaches every occurrence before MAX_DEPTH');
    inspectedRows = 0;
    h.attach(imperativeApi);
    assert.equal(typeof first.ref, 'function');
    assert.equal(animatedObject.from(first.ref), null);
    assert.equal(inspectedRows, 0, 'the real RN traversal must stop at the production function ref');
    h.render({ currentId: '1' });
    assert.equal(h.recycler().props.ref, first.ref);
    assert.equal(h.recycler().props.renderScrollComponent, first.renderScrollComponent);
    assert.equal(h.recycler().props.onScroll.handlers[1], h.dock);
  });

  it('keeps imperative scrolling on the current native instance and clears it on ref detach', () => {
    const h = list();
    const cancelSearch = () => {
      h.search().props.onFocus(); h.render();
      const cancel = find(h.recycler().props.ListHeaderComponent, (node) => node.type === 'GlassPressable'
        && node.props.children?.props.children === 'Cancel')!;
      cancel.props.onPress(); h.render();
    };
    cancelSearch();
    assert.equal(h.scrolls.length, 1);
    h.detach();
    cancelSearch();
    assert.equal(h.scrolls.length, 1, 'detached list cannot receive an old scroll command');
    const replacement: unknown[] = [];
    h.attach({ scrollToOffset: (options: unknown) => replacement.push(options) });
    cancelSearch();
    assert.equal(h.scrolls.length, 1);
    assert.equal(JSON.stringify(replacement), '[{"offset":0,"animated":false}]');
  });

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

describe('collapsed search material capture safety in the actual shared list', () => {
  const reveal = (h: ReturnType<typeof list>) => {
    h.gestures.at(-1).callbacks.onBegin();
    h.gestures.at(-1).callbacks.onChange({ translationY: 70 });
    h.render();
  };
  const cancel = (h: ReturnType<typeof list>) => {
    h.search().props.onFocus(); h.render();
    find(h.recycler().props.ListHeaderComponent, (node) => node.type === 'GlassPressable'
      && node.props.children?.props.children === 'Cancel')!.props.onPress();
    h.render();
  };

  it('keeps the native search consumer detached at zero height and retains identical material through both animations', () => {
    const h = list();
    assert.equal(h.material(), undefined, 'ordinary list scrolling must have no hidden enabled native search glass');
    assert.ok(h.search(), 'the input and pull-to-reveal host retain their existing tree');
    reveal(h);
    assert.ok(h.material());
    const opticalProps = { ...h.material()!.props };
    const opening = h.timings.at(-1)!;
    assert.ok(opening.toValue > 0);
    opening.complete(); h.render();
    assert.ok(h.material(), 'open search retains its material');
    cancel(h);
    const closing = h.timings.at(-1)!;
    assert.equal(closing.toValue, 0);
    assert.deepEqual({ ...h.material()!.props }, opticalProps, 'closing uses unchanged material parameters');
    closing.complete(false); h.render();
    assert.ok(h.material(), 'an interrupted animation cannot report zero height');
    cancel(h); h.timings.at(-1)!.complete(); h.render();
    assert.equal(h.material(), undefined, 'only completed collapse detaches the native consumer');
    assert.equal(h.search().props.value, '');
  });

  it('rejects a queued old collapse completion after a new reveal and an ABA collapse', () => {
    const h = list();
    reveal(h); h.timings.at(-1)!.complete(); h.render();
    cancel(h); const oldClose = h.timings.at(-1)!;
    reveal(h); const newOpen = h.timings.at(-1)!;
    assert.ok(oldClose.stops > 0);
    oldClose.complete(); h.render();
    assert.ok(h.material(), 'old finished callback cannot remove a newly opened material');
    newOpen.complete(); h.render();
    cancel(h); const newClose = h.timings.at(-1)!;
    oldClose.complete(); h.render();
    assert.ok(h.material(), 'ABA close has a different generation');
    newClose.complete(); h.render();
    assert.equal(h.material(), undefined);
  });

  it('stops the owner animation on unmount and ignores its queued completion and old reveal gesture', () => {
    const h = list();
    reveal(h); cancel(h);
    const closing = h.timings.at(-1)!;
    const oldGesture = h.gestures.at(-1);
    h.unmount();
    assert.ok(closing.stops > 0);
    const writes = h.stateWrites();
    closing.complete();
    oldGesture.callbacks.onBegin(); oldGesture.callbacks.onChange({ translationY: 70 });
    assert.equal(h.stateWrites(), writes, 'retired component cannot schedule material/reveal state');
    const replacement = list();
    reveal(replacement);
    closing.complete(); replacement.render();
    assert.ok(replacement.material(), 'an old owner cannot detach the new list material');
  });
});

describe('production recycled row and press feedback ownership', () => {
  it('keeps a row touch owned by the same song while its presentation switches', () => {
    const h = row();
    h.body().props.onTouchStart(event(10));
    h.body().props.onPressIn(event(10));
    const resetKey = find(h.tree(), (node) => node.type === 'Cover')!.props.resetKey;
    h.setUiStyle('appleMusic');
    assert.equal(find(h.tree(), (node) => node.type === 'Cover')!.props.resetKey, resetKey);
    h.body().props.onTouchEnd(event(11));
    h.body().props.onPressOut(event(11));
    h.body().props.onPress(event(11));
    assert.deepEqual(h.presses, ['A']);
    h.setUiStyle('spotify');
    h.menu().props.onPress(event(20));
    assert.deepEqual(h.menus, ['A']);
  });

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
