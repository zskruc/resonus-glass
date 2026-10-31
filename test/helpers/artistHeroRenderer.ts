import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Node = { type: unknown; props: Record<string, any> };

/** Drives real hero event handlers while keeping native image completions deferred. */
export function artistHeroRenderer(trace = false) {
  let slots: any[] = [], cursor = 0, writes = 0;
  const effects: (() => void)[] = [];
  const cleanup = new Set<() => void>();
  const logs: string[] = [];
  const slot = <T,>(create: () => T): T => { const index = cursor++; return slots[index] ??= create(); };
  const equal = (first: unknown[] | undefined, second: unknown[]) =>
    first?.length === second.length && first.every((value, index) => Object.is(value, second[index]));
  const react = {
    memo: (component: unknown) => component,
    useRef: <T,>(value: T) => slot(() => ({ current: value })),
    useState: <T,>(value?: T) => {
      const state = slot(() => ({ value }));
      return [state.value, (next: T | ((previous: T | undefined) => T)) => {
        writes++; state.value = typeof next === 'function' ? (next as (previous: T | undefined) => T)(state.value) : next;
      }];
    },
    useMemo: (read: () => unknown, deps: unknown[]) => {
      const state = slot(() => ({ deps: undefined as unknown[] | undefined, value: undefined as unknown }));
      if (!equal(state.deps, deps)) { state.value = read(); state.deps = deps; }
      return state.value;
    },
    useLayoutEffect: (create: () => (() => void) | undefined, deps: unknown[]) => {
      const state = slot(() => ({ deps: undefined as unknown[] | undefined, close: undefined as (() => void) | undefined }));
      if (equal(state.deps, deps)) return;
      state.deps = deps;
      effects.push(() => {
        if (state.close) { cleanup.delete(state.close); state.close(); }
        state.close = create();
        if (state.close) cleanup.add(state.close);
      });
    },
  };
  const exported: Record<string, any> = {};
  const jsx = (type: unknown, props: Node['props']) => ({ type, props });
  const imports: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@react-native-masked-view/masked-view': { __esModule: true, default: 'Mask' },
    'expo-image': { Image: 'Image' }, 'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'react-native': { View: 'View', StyleSheet: { absoluteFill: {} } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' } },
    '@/api/data': { CACHED_COVER: 'cached-cover:' },
    '../../../modules/liquid-glass': { isArtistImageTraceEnabled: trace },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/components/volta/VoltaDetailHeroFade.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: exported, console: { info: (line: string) => logs.push(line) },
    require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const layers = (tree: Node): { field: Node | null; sharp: Node | null } => {
    const [field, sharp] = tree.props.children.props.children.props.children;
    return { field, sharp: sharp?.props.children ?? null };
  };
  const render = (props: Record<string, any>): Node => {
    cursor = 0;
    const tree = exported.VoltaDetailHeroFade(props);
    while (effects.length) effects.shift()!();
    return tree;
  };
  const settled = (props: Record<string, any>) => {
    let tree = render(props);
    layers(tree).sharp?.props.onDisplay();
    tree = render(props);
    return tree;
  };
  const unmount = () => { for (const close of cleanup) close(); cleanup.clear(); };
  return { render, settled, layers, logs, unmount, writes: () => writes,
    remount: () => { unmount(); slots = []; } };
}
