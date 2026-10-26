import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveAppleMusicPlayerTransition } from '../src/lib/appleMusicPlayerTransition';

type Element = { type: unknown; props: Record<string, any> };
type Props = { routeKey: string; routeName: string; children: unknown };
type Deps = readonly unknown[] | undefined;
type Scope = { slots: any[]; cursor: number; focused: boolean; effects: (() => void)[]; cleanups: Set<() => void> };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

// Execute the production component and bus. Only the React/native boundaries
// are substituted; focus commits and UI style reads advance independently.
function harness() {
  const scopes = new Map<string, Scope>();
  let current!: Scope;
  function slot<T>(create: () => T): T { return current.slots[current.cursor++] ??= create(); }
  const changed = (a: Deps, b: Deps) => !a || !b || a.length !== b.length
    || a.some((value, index) => !Object.is(value, b[index]));
  function memo<T>(create: () => T, deps: Deps): T {
    const box = slot(() => ({ deps: undefined as Deps, value: undefined as T | undefined }));
    if (changed(box.deps, deps)) { box.deps = deps; box.value = create(); }
    return box.value as T;
  }
  function effect(create: () => (() => void) | void, deps: Deps) {
    const owner = current;
    const box = slot(() => ({ deps: undefined as Deps, cleanup: undefined as (() => void) | undefined }));
    if (!changed(box.deps, deps)) return;
    box.deps = deps;
    owner.effects.push(() => {
      if (box.cleanup) { owner.cleanups.delete(box.cleanup); box.cleanup(); }
      box.cleanup = create() || undefined;
      if (box.cleanup) owner.cleanups.add(box.cleanup);
    });
  }
  const animated = {
    __esModule: true, default: { View: 'AnimatedView' },
    makeMutable: (initial: unknown) => ({ value: initial,
      get() { return this.value; }, set(value: unknown) { this.value = value; } }),
    useAnimatedStyle: (read: () => unknown) => {
      const box = slot(() => ({ read })); box.read = read; return box;
    },
  };
  const dependencies: Record<string, unknown> = {
    react: { useLayoutEffect: effect, useMemo: memo,
      useRef: (value: unknown) => slot(() => ({ current: value })) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { useIsFocused: () => current.focused },
    'react-native-reanimated': animated,
    'react-native': { StyleSheet: { create: (styles: unknown) => styles } },
  };
  function load(path: string) {
    const compiled = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports: Record<string, any> = {};
    runInNewContext(compiled, { exports, require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected ${path} import ${name}`);
      return dependencies[name];
    } });
    return exports;
  }
  const bus = load('lib/playerReveal.ts');
  dependencies['@/lib/playerReveal'] = bus;
  const component = load('components/PlayerUnderlayTransform.tsx');
  function commit(key: string) {
    const scope = scopes.get(key)!;
    while (scope.effects.length) scope.effects.shift()!();
  }
  return {
    bus,
    render(key: string, props: Props, focused: boolean, commitNow = true): Element {
      if (!scopes.has(key)) scopes.set(key, { slots: [], cursor: 0, focused, effects: [], cleanups: new Set() });
      current = scopes.get(key)!; current.cursor = 0; current.focused = focused;
      const tree = component.PlayerUnderlayTransform(props);
      if (commitNow) commit(key);
      return tree;
    },
    commit,
    unmount(key: string) {
      const scope = scopes.get(key)!;
      for (const cleanup of scope.cleanups) cleanup();
      scope.cleanups.clear(); scopes.delete(key);
    },
  };
}

function style(tree: Element): Record<string, any> {
  const flatten = (value: any): Record<string, any> => Array.isArray(value)
    ? Object.assign({}, ...value.map(flatten)) : value?.read ? value.read() : value ?? {};
  return plain(flatten(tree.props.style));
}

function publishFrame(bus: Record<string, any>, routeKey: string, progress = 1) {
  const resolved = resolveAppleMusicPlayerTransition({
    viewportWidth: 384, viewportHeight: 832, progress,
    snapshot: { viewportWidth: 384, viewportHeight: 832,
      miniPlayer: { x: 16, y: 700, width: 352, height: 56 },
      miniArtwork: { x: 24, y: 708, width: 40, height: 40 },
      playerArtwork: { x: 49.2, y: 132.13, width: 285.6, height: 285.6 } },
  });
  assert.ok(resolved);
  const frame = { owner: bus.createPlayerSurfaceOwner(), routeKey, ...resolved.underlay };
  bus.playerUnderlayFrame.set(frame);
  return frame;
}

function assertIdentity(tree: Element) {
  const value = style(tree);
  assert.deepEqual(value.transform, [{ translateY: 0 }, { scale: 1 }]);
  assert.equal(value.borderRadius, 0);
  assert.equal(value.overflow, 'visible');
}

test('only a focused eligible route records the origin, retaining it when the player or another modal takes focus', () => {
  const h = harness();
  const home = { routeKey: 'home-1', routeName: '(tabs)', children: jsx('Home', {}) };
  h.render('home', home, false);
  assert.equal(h.bus.playerUnderlayRouteKey.get(), null);
  h.render('home', home, true, false);
  assert.equal(h.bus.playerUnderlayRouteKey.get(), null, 'an abandoned render cannot claim origin');
  h.commit('home');
  assert.equal(h.bus.playerUnderlayRouteKey.get(), 'home-1');
  h.render('home', home, false);
  assert.equal(h.bus.playerUnderlayRouteKey.get(), 'home-1', 'blur preserves the last underlying route');
  for (const name of ['player', 'player/index', 'lyrics', 'lyrics/full', 'queue', 'queue/index', 'login', 'login/profile']) {
    const tree = h.render(name, { routeKey: `${name}-1`, routeName: name, children: null }, true);
    assert.equal(h.bus.playerUnderlayRouteKey.get(), 'home-1', `${name} cannot claim the player origin`);
    assertIdentity(tree);
  }
  h.unmount('home');
  assert.equal(h.bus.playerUnderlayRouteKey.get(), 'home-1', 'removing a wrapper cannot clear another transition owner');
  h.render('settings', { routeKey: 'settings-1', routeName: 'settings/appearance', children: null }, true);
  assert.equal(h.bus.playerUnderlayRouteKey.get(), 'settings-1');
});

test('only the independently retained screen with the matching route key follows the actual player underlay frame', () => {
  const h = harness();
  const child = jsx('Playlist', {});
  const first = h.render('first', { routeKey: 'playlist-A', routeName: 'playlist/[id]', children: child }, true);
  const second = h.render('second', { routeKey: 'playlist-B', routeName: 'playlist/[id]', children: child }, false);
  const frame = publishFrame(h.bus, 'playlist-A', .6);
  const value = style(first);
  assert.deepEqual(value.transform, [{ translateY: frame.translateY }, { scale: frame.scale }]);
  assert.equal(value.borderRadius, frame.cornerRadius);
  assert.equal(value.overflow, 'hidden');
  assertIdentity(second);
  h.render('first', { routeKey: 'playlist-A', routeName: 'playlist/[id]', children: child }, false);
  assert.deepEqual(style(first).transform, [{ translateY: frame.translateY }, { scale: frame.scale }],
    'a covered route remains animated after losing focus');
  publishFrame(h.bus, 'playlist-B', 1);
  assertIdentity(first);
  assert.equal(style(second).transform[1].scale, .9);
});

test('null and stale frames explicitly reset transform, clipping and radius without remounting the child', () => {
  const h = harness();
  const child = jsx('Page', { state: 'retained' });
  let tree = h.render('page', { routeKey: 'page-A', routeName: 'artist/[id]', children: child }, true);
  publishFrame(h.bus, 'page-A');
  assert.equal(style(tree).overflow, 'hidden');
  h.bus.playerUnderlayFrame.set(null);
  assertIdentity(tree);
  assert.equal(tree.props.children, child);
  publishFrame(h.bus, 'page-A');
  tree = h.render('page', { routeKey: 'page-B', routeName: 'artist/[id]', children: child }, true);
  assertIdentity(tree);
  assert.equal(tree.props.children, child);
  publishFrame(h.bus, 'orphaned-route');
  assertIdentity(tree);
  publishFrame(h.bus, 'page-B');
  tree = h.render('page', { routeKey: 'page-B', routeName: 'queue', children: child }, true);
  assertIdentity(tree);
});

test('an excluded modal ignores even a matching frame and the wrapper preserves pointer-through native content without images', () => {
  const h = harness();
  const child = [jsx('NativeList', { scrollOffset: 300 }), jsx('Overlay', { visible: true })];
  const tree = h.render('modal', { routeKey: 'player-1', routeName: 'player', children: child }, true);
  publishFrame(h.bus, 'player-1');
  assertIdentity(tree);
  assert.equal(h.bus.playerUnderlayRouteKey.get(), null);
  assert.equal(tree.type, 'AnimatedView');
  assert.equal(tree.props.pointerEvents, 'box-none');
  assert.equal(tree.props.collapsable, false);
  assert.equal(style(tree).flex, 1);
  assert.equal(tree.props.children, child, 'existing screen instances pass through unchanged; no copied artwork or extra content layer');
});
