import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import type { Song } from '../src/api/subsonic';

type Element = { type: unknown; props: Record<string, any> };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const track = (id: string, extra: Partial<Song> = {}): Song => ({ id, title: id, ...extra });
const event = (timestamp: number) => ({ nativeEvent: { timestamp }, stopped: false,
  stopPropagation() { this.stopped = true; } });

// Execute the real self-contained public predicate, without initializing the
// API module's unrelated network, database, player or persistence singletons.
const dataSource = ts.createSourceFile('data.ts', readFileSync(new URL('../src/api/data.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest);
const predicate = dataSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'canGoIntoPlaylist');
assert.ok(predicate);
const predicateExports: Record<string, any> = {};
runInNewContext(ts.transpileModule(predicate.getText(dataSource), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: predicateExports });
const canGoIntoPlaylist: (song: Song) => boolean = predicateExports.canGoIntoPlaylist;

function harness() {
  let cursor = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const cleanups = new Set<() => void>();
  const slot = <T,>(create: () => T): T => { const index = cursor++; return index in slots ? slots[index] : slots[index] = create(); };
  const memo = <T,>(create: () => T, deps: unknown[]) => {
    const state = slot(() => ({ deps: undefined as unknown[] | undefined, value: undefined as T | undefined }));
    if (!state.deps || state.deps.some((value, index) => !Object.is(value, deps[index]))) {
      state.deps = deps; state.value = create();
    }
    return state.value;
  };
  const session = { auth: true as unknown, offline: false };
  const opens: Song[][] = [];
  const requests: { kind: string; id: string; resolve: () => void }[] = [];
  const write = (kind: string, id: string) => new Promise<void>((resolve) => requests.push({ kind, id, resolve }));
  const react = {
    useRef: <T,>(value: T) => slot(() => ({ current: value })),
    useMemo: memo,
    useState: <T,>(initial: T) => {
      const state = slot(() => ({ value: initial }));
      return [state.value, (next: T) => { state.value = next; }];
    },
    useLayoutEffect: (create: () => (() => void) | undefined, deps: unknown[]) => {
      const state = slot(() => ({ deps: undefined as unknown[] | undefined, close: undefined as (() => void) | undefined }));
      if (state.deps && state.deps.every((value, index) => Object.is(value, deps[index]))) return;
      state.deps = deps;
      effects.push(() => {
        if (state.close) { cleanups.delete(state.close); state.close(); }
        state.close = create(); if (state.close) cleanups.add(state.close);
      });
    },
  };
  const imports: Record<string, any> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/glass': { GlassPressable: 'Pressable' },
    '@/api/data': { canGoIntoPlaylist, star: (id: string) => write('star', id), unstar: (id: string) => write('unstar', id) },
    '@/lib/favoritesCache': { applyStarChange() {}, resyncFavorites() {}, unstarWithUndo() {} },
    '@/lib/haptics': { haptic() {} },
    '@/store/auth': { useAuthStore: (select: (value: unknown) => unknown) => select(session) },
    '@/store/pins': { usePins: { getState: () => ({ unpin() {} }) } },
    '@/store/playlistPicker': { usePlaylistPicker: Object.assign(() => { throw new Error('the button must not subscribe to picker state'); }, {
      getState: () => ({ open: (songs: Song[]) => opens.push(songs) }),
    }) },
    '@/store/toast': { useToast: (select: (value: unknown) => unknown) => select({ show() {} }) },
    '@/i18n': { useT: () => (key: string) => key },
    '@/theme': { colors: { accent: '#123456', textSecondary: '#AABBCC' } },
    '@/components/volta/ArtistPagePalette': { useArtistPagePalette: () => ({ accent: '#FFFFFF', textSecondary: '#F5F7F6' }) },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/FavoriteButton.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, queueMicrotask, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected favorite dependency ${name}`); return imports[name];
  } });
  let props: Record<string, any> = { id: 'A', starred: false };
  let tree: Element;
  return {
    opens, requests, session,
    render(next = props) {
      props = next; cursor = 0; tree = exports.FavoriteButton(props);
      while (effects.length) effects.shift()!(); return tree;
    },
    tree: () => tree,
    unmount() { for (const close of cleanups) close(); cleanups.clear(); },
  };
}

describe('player favorite hold opens the existing playlist sheet', () => {
  it('keeps a song-row hold unassigned and leaves normal tap favorites intact', async () => {
    const h = harness(); const row = h.render({ id: 'A', resetKey: 'row-A', starred: false });
    assert.equal(row.props.onLongPress, undefined, 'selection gestures in song lists must not acquire a playlist action');
    row.props.onTouchStart(event(0)); const tap = row.props.onPress(event(700));
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].kind, 'star'); assert.equal(h.opens.length, 0);
    h.requests[0].resolve(); await tap;
  });

  it('opens the actual held song without toggling either favorite state or bubbling to the mini card', async () => {
    for (const starred of [false, true]) {
      const h = harness(); const song = track('A');
      const style = { width: 44, height: 44 }; const button = h.render({ id: 'A', starred, playlistSong: song,
        glyph: 'star', selectedColor: '#FFFFFF', unselectedColor: '#F5F7F6', size: 22, hitSlop: 0, style });
      button.props.onTouchStart(event(0)); const held = event(600); button.props.onLongPress(held);
      assert.equal(held.stopped, true); assert.equal(h.opens.length, 1); assert.equal(h.opens[0][0], song);
      button.props.onTouchEnd(event(700)); await button.props.onPress(event(700));
      assert.equal(h.requests.length, 0, 'a queued release after a hold cannot star or unstar');
      assert.equal(h.render().props.children.props.name, starred ? 'star' : 'star-outline');
      assert.equal(h.tree().props.children.props.color, starred ? '#FFFFFF' : '#F5F7F6');
      assert.equal(h.tree().props.style, style); assert.equal(h.tree().props.hitSlop, 0);
    }
  });

  it('retains ordinary short taps and permits a new tap after the held touch is released', async () => {
    const h = harness(); const song = track('A'); const button = h.render({ id: 'A', starred: false, playlistSong: song });
    button.props.onTouchStart(event(0)); button.props.onLongPress(event(600)); button.props.onTouchEnd(event(700));
    await Promise.resolve();
    button.props.onTouchStart(event(800)); const tap = button.props.onPress(event(900));
    assert.equal(h.opens.length, 1); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].kind, 'star');
    h.requests[0].resolve(); await tap;
  });

  it('uses the same eligibility rule for server/local/downloaded tracks and excludes radio and podcast URLs', () => {
    const allowed = [track('server'), track('local', { localUri: 'file:///music.mp3' }), track('download', { localUri: 'file:///download.mp3' })];
    const blocked = [track('radio', { url: 'https://radio.example/live' }), track('episode', { url: 'https://podcast.example/episode.mp3', vod: true })];
    for (const song of [...allowed, ...blocked]) {
      const h = harness(); const button = h.render({ id: song.id, playlistSong: song });
      assert.equal(canGoIntoPlaylist(song), allowed.includes(song));
      assert.equal(typeof button.props.onLongPress === 'function', allowed.includes(song));
    }
    assert.equal(harness().render({ id: 'album', type: 'album', playlistSong: track('album') }).props.onLongPress, undefined);
    assert.equal(harness().render({ id: 'other', playlistSong: track('wrong-song') }).props.onLongPress, undefined);
  });

  it('respects session presence while allowing offline local playlists without navigation', () => {
    const h = harness(); const beforeLogout = h.render({ id: 'A', playlistSong: track('A') });
    h.session.auth = null;
    let button = h.render();
    beforeLogout.props.onLongPress(event(600)); assert.equal(h.opens.length, 0, 'a prior account’s pending hold cannot open this profile’s picker');
    button.props.onLongPress(event(600)); assert.equal(h.opens.length, 0);
    h.session.offline = true; button = h.render();
    button.props.onLongPress(event(1200)); assert.equal(h.opens.length, 1); assert.equal(h.requests.length, 0);
  });

  it('rejects stale, recycled, hidden and unmounted long presses, including A to B to A', () => {
    const h = harness(); const a = track('A'); const b = track('B');
    const first = h.render({ id: 'A', playlistSong: a }); first.props.onTouchStart(event(100));
    const second = h.render({ id: 'B', playlistSong: b });
    first.props.onLongPress(event(700)); second.props.onLongPress(event(700));
    assert.equal(h.opens.length, 0, 'old touch ownership must not be reassigned to B');
    const third = h.render({ id: 'A', playlistSong: a });
    first.props.onLongPress(event(800)); assert.equal(h.opens.length, 0);
    third.props.onTouchStart(event(900)); third.props.onLongPress(event(800)); assert.equal(h.opens.length, 0, 'late older native events cannot claim a new touch');
    third.props.onLongPress(event(1500)); assert.equal(h.opens.length, 1);
    h.render({ id: 'A' }); third.props.onLongPress(event(1700)); assert.equal(h.opens.length, 1, 'inactive player removes the hold capability');
    const active = h.render({ id: 'A', playlistSong: a }); active.props.onTouchStart(event(2000));
    h.unmount(); active.props.onLongPress(event(2600)); assert.equal(h.opens.length, 1);
  });
});

it('the real queue menu reads the latest queue after dismissal and offers only playlist-capable tracks', () => {
  const source = ts.createSourceFile('queue.tsx', readFileSync(new URL('../src/app/queue.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onPress' && node.initializer
      && ts.isJsxExpression(node.initializer) && node.initializer.expression
      && ts.isArrowFunction(node.initializer.expression) && node.initializer.expression.getText(source).includes('usePlaylistPicker')) {
      handler = node.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(handler);
  let queue = [track('initial')]; let after!: () => void; const opened: Song[][] = [];
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(`export const run = ${handler.getText(source)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, canGoIntoPlaylist, close(callback: () => void) { after = callback; },
    usePlayerStore: { getState: () => ({ queue }) },
    usePlaylistPicker: { getState: () => ({ open(songs: Song[]) { opened.push(songs); } }) } });
  exports.run();
  queue = [track('radio', { url: 'https://radio/live' }), track('library'), track('episode', { url: 'https://podcast/file', vod: true })];
  after(); assert.deepEqual(opened[0].map((song) => song.id), ['library']);
  exports.run(); queue = [track('radio', { url: 'https://radio/live' })]; after();
  assert.equal(opened.length, 1, 'a queue with no tracks does not open an empty playlist picker');
});
