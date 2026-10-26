import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createCoverPathCache } from '../src/lib/coverPathCache';

type Element = { type: unknown; key?: string; props: Record<string, any> };
type Dependency = readonly unknown[] | undefined;
const jsx = (type: unknown, props: Record<string, unknown>, key?: string | number): Element =>
  ({ type, props, key: key === undefined ? undefined : String(key) });
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const pressEvent = (timestamp: number) => ({ nativeEvent: { timestamp }, stopPropagation() {} });

// Render the real components with persistent hook slots, separate layout and
// passive effects, and controllable requests. Their actual handlers execute;
// the harness supplies no replacement ownership/reset policy.
function hooks() {
  let cursor = 0;
  let writes = 0;
  const slots: any[] = [];
  const layout: (() => void)[] = [];
  const passive: (() => void)[] = [];
  const cleanups = new Set<() => void>();
  function slot<T>(create: () => T): T {
    const index = cursor++;
    if (!(index in slots)) slots[index] = create();
    return slots[index];
  }
  const different = (left: Dependency, right: Dependency) =>
    !left || !right || left.length !== right.length || left.some((value, index) => !Object.is(value, right[index]));
  function memo<T>(create: () => T, dependencies: Dependency): T {
    const saved = slot(() => ({ dependencies: undefined as Dependency, value: undefined as T | undefined }));
    if (different(saved.dependencies, dependencies)) {
      saved.dependencies = dependencies;
      saved.value = create();
    }
    return saved.value as T;
  }
  function effect(create: () => (() => void) | void, dependencies: Dependency, pending: (() => void)[]) {
    const saved = slot(() => ({ dependencies: undefined as Dependency, cleanup: undefined as (() => void) | undefined }));
    if (!different(saved.dependencies, dependencies)) return;
    saved.dependencies = dependencies;
    pending.push(() => {
      if (saved.cleanup) { cleanups.delete(saved.cleanup); saved.cleanup(); }
      saved.cleanup = create() || undefined;
      if (saved.cleanup) cleanups.add(saved.cleanup);
    });
  }
  return {
    react: {
      useRef: <T,>(value: T) => slot(() => ({ current: value })),
      useState: <T,>(value: T | (() => T)) => {
        const state = slot(() => ({ value: typeof value === 'function' ? (value as () => T)() : value }));
        return [state.value, (next: T | ((previous: T) => T)) => {
          writes++;
          state.value = typeof next === 'function' ? (next as (previous: T) => T)(state.value) : next;
        }];
      },
      useMemo: memo,
      useCallback: (callback: unknown, dependencies: Dependency) => memo(() => callback, dependencies),
      useEffect: (create: () => (() => void) | void, dependencies: Dependency) => effect(create, dependencies, passive),
      useLayoutEffect: (create: () => (() => void) | void, dependencies: Dependency) => effect(create, dependencies, layout),
    },
    begin() { cursor = 0; },
    commit() { while (layout.length) layout.shift()!(); },
    passive() { while (passive.length) passive.shift()!(); },
    unmount() { for (const cleanup of cleanups) cleanup(); cleanups.clear(); },
    writes: () => writes,
  };
}

function load(file: string, react: object, imports: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports: Record<string, any> = {};
  runInNewContext(compiled.outputText, {
    exports, setTimeout, clearTimeout, queueMicrotask,
    require(id: string) {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === '@/components/Icon') return { __esModule: true, default: 'Icon' };
      assert.ok(Object.hasOwn(imports, id), `Unexpected ${file} import ${id}`);
      return imports[id];
    },
  });
  return exports;
}

function favorite() {
  const runtime = hooks();
  type Request = { kind: 'star' | 'unstar'; id: string; type: string;
    resolve(): void; reject(reason: Error): void };
  const requests: Request[] = [];
  const changes: unknown[][] = [];
  const undos: { type: string; id: string; revert: () => void }[] = [];
  let resyncs = 0;
  const request = (kind: Request['kind'], id: string, type: string) => new Promise<void>((resolve, reject) => {
    requests.push({ kind, id, type, resolve, reject });
  });
  const module = load('FavoriteButton', runtime.react, {
    '@/components/glass': { GlassPressable: 'Pressable' },
    '@/api/data': { star: (id: string, type: string) => request('star', id, type),
      unstar: (id: string, type: string) => request('unstar', id, type) },
    '@/lib/favoritesCache': { applyStarChange: (...args: unknown[]) => changes.push(args),
      resyncFavorites: () => { resyncs++; },
      unstarWithUndo: (type: string, id: string, revert: () => void) => undos.push({ type, id, revert }) },
    '@/lib/haptics': { haptic() {} },
    '@/store/auth': { useAuthStore: (select: (state: unknown) => unknown) => select({ auth: true, offline: false }) },
    '@/store/pins': { usePins: { getState: () => ({ unpin() {} }) } },
    '@/store/toast': { useToast: (select: (state: unknown) => unknown) => select({ show() {} }) },
    '@/i18n': { useT: () => (value: string) => value },
    '@/theme': { colors: { accent: '#123', textSecondary: '#aaa' } },
  });
  let tree: Element;
  let props: Record<string, unknown>;
  const render = (next = props) => {
    props = next;
    runtime.begin(); tree = module.FavoriteButton(props); runtime.commit(); runtime.passive();
    return tree;
  };
  render({ id: 'A', starred: false, resetKey: 'row-A' });
  return { render, requests, changes, undos, resyncs: () => resyncs,
    tree: () => tree, icon: () => (tree.props.children as Element).props.name,
    writes: runtime.writes, unmount: runtime.unmount };
}

function artwork() {
  const runtime = hooks();
  let displayed = 0;
  const detected: unknown[][] = [];
  const cacheRequests: string[] = [];
  const cacheAnswers = new Map<string, Promise<string | null>>();
  const Image = Object.assign(() => null, { getCachePathAsync: (uri: string) => {
    cacheRequests.push(uri);
    return cacheAnswers.get(uri) ?? Promise.resolve(null);
  } });
  const appState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
  const module = load('Cover', runtime.react, {
    'expo-image': { Image },
    'react-native': { AppState: appState, View: 'Placeholder' },
    '@/api/data': { CACHED_COVER: 'cached-cover:', COVER: { card: 1200, full: 2000, thumb: 96 } },
    '@/hooks/useImageAnimation': { useImageAnimation: () => ({ autoplay: false, onDisplay() { displayed++; } }) },
    '@/lib/perfLog': { bump() {} },
    '@/lib/coverPathCache': { createCoverPathCache },
    '@/store/settings': { useSettings: (select: (state: unknown) => unknown) => select({ coverCorners: 'rounded' }) },
    '@/theme': { colors: { surfaceHighlight: '#333', textSecondary: '#aaa' }, radius: { sm: 4, md: 8, lg: 12, xl: 16, pill: 999 } },
  });
  let tree: Element;
  let props: Record<string, unknown>;
  const render = (next = props, commit = true) => {
    props = next;
    runtime.begin(); tree = module.Cover(props);
    if (commit) { runtime.commit(); runtime.passive(); }
    return tree;
  };
  render({ uri: 'https://covers/A', size: 48, transition: 0, resetKey: 'row-A',
    onAnimatedDetected: (...args: unknown[]) => detected.push(args) });
  return { render, tree: () => tree, isImage: () => tree.type === Image, detected,
    displayed: () => displayed, cacheRequests, cacheAnswers, writes: runtime.writes,
    commit() { runtime.commit(); runtime.passive(); }, unmount: runtime.unmount };
}

describe('favorite state in a recycled song row', () => {
  it('does not let A failure/finally overwrite B optimistic favorite or release B busy state', async () => {
    const h = favorite();
    const old = h.tree();
    const a = old.props.onPress(); h.render();
    assert.equal(h.icon(), 'heart');
    h.render({ id: 'B', starred: true, resetKey: 'row-B' });
    const b = h.tree().props.onPress(); h.render();
    assert.equal(h.icon(), 'heart-outline');
    assert.deepEqual(h.requests.map(({ kind, id }) => [kind, id]), [['star', 'A'], ['unstar', 'B']]);
    h.requests[0].reject(new Error('A failed')); await a; h.render();
    assert.equal(h.icon(), 'heart-outline');
    await h.tree().props.onPress();
    assert.equal(h.requests.length, 2, 'A finally must not clear the current B request');
    h.requests[1].resolve(); await b; h.render();
    assert.deepEqual(h.changes, [['song', 'B', false]]);
    assert.equal(h.resyncs(), 1);
    await old.props.onPress();
    assert.equal(h.requests.length, 2, 'an old event callback cannot act on a recycled row');
  });

  it('still updates the original backend/cache and preserves original Undo after the slot changes', async () => {
    const h = favorite();
    const pending = h.tree().props.onPress();
    h.render({ id: 'B', starred: false, resetKey: 'row-B' });
    const before = h.writes();
    h.requests[0].resolve(); await pending;
    assert.deepEqual(h.changes, [['song', 'A', true]]);
    assert.equal(h.writes(), before);
    h.render({ id: 'A', starred: true, resetKey: 'row-A-again', undo: true });
    await h.tree().props.onPress(); h.render();
    assert.equal(h.icon(), 'heart-outline');
    assert.equal(h.undos[0].id, 'A');
    h.render({ id: 'B', starred: false, resetKey: 'row-B-again', undo: true });
    h.undos[0].revert(); h.render();
    assert.equal(h.icon(), 'heart-outline');
    h.render({ id: 'A', starred: false, resetKey: 'row-A-third', undo: true });
    h.undos[0].revert(); h.render();
    assert.equal(h.icon(), 'heart-outline', 'old A Undo cannot mutate a later A binding');
  });

  it('rejects a pointer started on A when release uses B latest callback, then allows accessibility activation', async () => {
    const h = favorite();
    h.tree().props.onPressIn(pressEvent(10));
    h.render({ id: 'B', starred: false, resetKey: 'row-B' });
    h.tree().props.onPressOut(pressEvent(20));
    await h.tree().props.onPress(pressEvent(20));
    assert.equal(h.requests.length, 0);
    await turn();
    const accessible = h.tree().props.onPress();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].id, 'B');
    h.requests[0].resolve(); await accessible;
  });

  it('keeps the physical touch owner when the same finger leaves and reenters a recycled favorite', async () => {
    const h = favorite();
    h.render({ id: 'A', starred: true, resetKey: 'row-A', undo: true });
    h.tree().props.onTouchStart?.(pressEvent(10));
    h.tree().props.onPressIn(pressEvent(10));
    h.tree().props.onPressOut(pressEvent(20));
    await turn();
    h.render({ id: 'B', starred: true, resetKey: 'row-B', undo: true });
    // Pressability calls the newest onPressIn again when this finger returns
    // to the press rect; no new native touch-down has happened on B.
    h.tree().props.onPressIn(pressEvent(30));
    h.tree().props.onTouchEnd?.(pressEvent(40));
    h.tree().props.onPressOut(pressEvent(40));
    await h.tree().props.onPress(pressEvent(40));
    assert.equal(h.undos.length, 0, 'the touch started on A must not unstar B');
    assert.equal(h.requests.length, 0);
    await turn();

    h.tree().props.onTouchStart?.(pressEvent(50));
    h.tree().props.onPressIn(pressEvent(50));
    h.tree().props.onTouchEnd?.(pressEvent(60));
    h.tree().props.onPressOut(pressEvent(60));
    await h.tree().props.onPress(pressEvent(60));
    assert.deepEqual(h.undos.map(({ id }) => id), ['B'], 'a new B touch still works');
  });

  it('does not let delayed old press-out or touch-end expire a newer physical touch owner', async () => {
    const h = favorite();
    const firstA = h.tree();
    firstA.props.onTouchStart?.(pressEvent(10));
    firstA.props.onPressIn(pressEvent(10));
    firstA.props.onTouchEnd?.(pressEvent(20));
    await turn();
    h.render({ id: 'B', starred: true, resetKey: 'row-B', undo: true });
    h.tree().props.onTouchStart?.(pressEvent(30));
    h.tree().props.onPressIn(pressEvent(30));
    firstA.props.onPressOut(pressEvent(20));
    h.tree().props.onPressOut(pressEvent(20));
    h.tree().props.onTouchEnd?.(pressEvent(20));
    await h.tree().props.onPress(pressEvent(20));
    assert.equal(h.undos.length, 0, 'an old release cannot activate the newer touch');
    await turn();

    h.render({ id: 'A', starred: true, resetKey: 'row-A', undo: true });
    h.tree().props.onPressIn(pressEvent(40));
    h.tree().props.onTouchEnd?.(pressEvent(50));
    h.tree().props.onPressOut(pressEvent(50));
    await h.tree().props.onPress(pressEvent(50));
    assert.equal(h.undos.length, 0, 'the newer touch still belongs to B through ABA recycling');
    await turn();

    await h.tree().props.onPress();
    assert.deepEqual(h.undos.map(({ id }) => id), ['A'], 'accessibility can activate after release');
  });

  it('releases a cancelled physical touch without blocking accessibility on the next binding', async () => {
    const h = favorite();
    h.tree().props.onTouchStart?.(pressEvent(10));
    h.tree().props.onPressIn(pressEvent(10));
    h.render({ id: 'B', starred: true, resetKey: 'row-B', undo: true });
    h.tree().props.onTouchCancel?.(pressEvent(20));
    h.tree().props.onPressOut(pressEvent(20));
    await turn();
    await h.tree().props.onPress();
    assert.deepEqual(h.undos.map(({ id }) => id), ['B']);
  });

  it('resynchronizes starred props immediately and retains the non-recycled public API', async () => {
    const h = favorite();
    h.render({ id: 'A', starred: true });
    assert.equal(h.icon(), 'heart');
    assert.equal(h.tree().props.onPressIn, undefined);
    assert.equal(h.tree().props.onPressOut, undefined);
    assert.equal(h.tree().props.onTouchStart, undefined);
    assert.equal(h.tree().props.onTouchEnd, undefined);
    assert.equal(h.tree().props.onTouchCancel, undefined);
    const pending = h.tree().props.onPress();
    h.requests[0].resolve(); await pending;
    h.render({ id: 'A', starred: false });
    assert.equal(h.icon(), 'heart-outline');
    h.unmount();
  });

  it('rejects duplicate activation before React rerenders and ignores local completion after unmount', async () => {
    const h = favorite();
    const first = h.tree().props.onPress();
    await h.tree().props.onPress();
    assert.equal(h.requests.length, 1);
    h.unmount();
    const before = h.writes();
    h.requests[0].resolve(); await first;
    assert.equal(h.writes(), before);
    assert.deepEqual(h.changes, [['song', 'A', true]]);
  });

  it('cannot revert a later A binding even when its resetKey returns to the same string', async () => {
    const h = favorite();
    const firstA = h.tree().props.onPress();
    h.render({ id: 'B', starred: false, resetKey: 'row-B' });
    h.render({ id: 'A', starred: true, resetKey: 'row-A' });
    const before = h.writes();
    h.requests[0].reject(new Error('first A failed')); await firstA;
    h.render();
    assert.equal(h.icon(), 'heart');
    assert.equal(h.writes(), before);
  });

  it('expires a cancelled pointer after press-out without blocking a subsequent accessibility activation', async () => {
    const h = favorite();
    h.tree().props.onPressIn(pressEvent(10));
    h.render({ id: 'B', starred: false, resetKey: 'row-B' });
    h.tree().props.onPressOut(pressEvent(20));
    await turn();
    const accessible = h.tree().props.onPress();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].id, 'B');
    h.requests[0].resolve(); await accessible;
  });
});

describe('cover state in a recycled song row', () => {
  it('shows B image in its first render without inheriting A failure or running a reset effect', () => {
    const h = artwork();
    h.tree().props.onError(); h.render();
    assert.equal(h.isImage(), false);
    const before = h.writes();
    h.render({ uri: 'https://covers/B', size: 48, transition: 0, resetKey: 'row-B' }, false);
    assert.equal(h.isImage(), true);
    assert.equal(h.writes(), before);
    assert.equal(h.tree().props.preferStatic, true);
    assert.equal(h.tree().props.transition, 0);
    assert.equal(h.tree().props.cachePolicy, 'memory-disk');
    h.commit();
  });

  it('changes only native image source keys and ignores old error/display/detection callbacks', () => {
    const h = artwork();
    const a = h.tree();
    h.render({ uri: 'https://covers/B', size: 48, transition: 0, resetKey: 'row-B' });
    assert.notEqual(h.tree().key, a.key, 'source change must not reuse the old native event target');
    const before = h.writes();
    a.props.onError(); a.props.onDisplay(); a.props.onLoad({ source: { isAnimated: true } });
    h.render();
    assert.equal(h.isImage(), true);
    assert.equal(h.writes(), before);
    assert.equal(h.displayed(), 0);
    assert.equal(h.detected.length, 0);
    const b = h.tree();
    h.render({ uri: 'https://covers/B', size: 48, transition: 0, resetKey: 'another-song-same-album' });
    assert.equal(h.tree().key, b.key, 'same album/source should retain its native image');
    assert.equal(h.tree().props.recyclingKey, 'https://covers/B');
    h.tree().props.onError(); h.render();
    assert.equal(h.isImage(), false, 'a genuine current-source error still falls back');
    h.render({ uri: 'https://covers/B', size: 48, resetKey: 'third-song-same-album' }, false);
    assert.equal(h.isImage(), true, 'a later binding can retry the same failed source in its first render');
    h.commit();
  });

  it('keeps offline cache-only resolution scoped to its URI and never downloads a miss', async () => {
    const h = artwork();
    let answerA!: (value: string | null) => void;
    h.cacheAnswers.set('https://covers/A?size=96', new Promise((resolve) => { answerA = resolve; }));
    h.cacheAnswers.set('https://covers/B?size=96', Promise.resolve('/cache/B'));
    h.render({ uri: 'cached-cover:https://covers/A?size=96', size: 48, resetKey: 'offline-A' });
    h.render({ uri: 'cached-cover:https://covers/B?size=96', size: 48, resetKey: 'offline-B' });
    await turn(); h.render();
    assert.equal(h.tree().props.source.uri, 'file:///cache/B');
    answerA('/cache/A'); await turn(); h.render();
    assert.equal(h.tree().props.source.uri, 'file:///cache/B');
    h.render({ uri: 'cached-cover:https://covers/missing?size=96', size: 48, resetKey: 'offline-miss' });
    await turn(); h.render();
    assert.equal(h.isImage(), false);
    assert.ok(h.cacheRequests.every((uri) => !uri.startsWith('cached-cover:')));
    h.unmount();
  });
});
