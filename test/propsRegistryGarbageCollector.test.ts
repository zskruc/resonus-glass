import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type StyleProps = Record<string, unknown>;
type AnimatedView = { _syncStylePropsBackToReact(props: StyleProps): void };
type SettledUpdate = { viewTag: number; styleProps: StyleProps | null };

interface Collector {
  viewsCount: number;
  viewsMap: Map<number, AnimatedView>;
  intervalId: number | null;
  registerView(tag: number, component: AnimatedView): void;
  unregisterView(tag: number): void;
  registerInterval(): void;
  unregisterInterval(): void;
}

const require = createRequire(import.meta.url);
const sourcePath = join(
  dirname(require.resolve('react-native-reanimated/package.json')),
  'src/PropsRegistryGarbageCollector.ts',
);
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length, 0);

function createHarness() {
  const exports: { PropsRegistryGarbageCollector?: Collector } = {};
  const timers = new Map<number, () => void>();
  let nextHandle = 1;
  let nativeReads = 0;
  let settled: SettledUpdate[] = [];

  // Run the installed dependency's actual bookkeeping, without initializing
  // React Native. Its two runtime imports are local stubs: a queued native
  // result and color conversion (unused by these plain opacity/transform tests).
  runInNewContext(compiled.outputText, {
    exports,
    module: { exports },
    require(id: string) {
      if (id === './ReanimatedModule') {
        return { ReanimatedModule: { getSettledUpdates() {
          nativeReads++;
          const updates = settled;
          settled = [];
          return updates;
        } } };
      }
      if (id === './common/style/processors/colors') {
        return { unprocessColor: (value: unknown) => value, unprocessColorsInProps() {} };
      }
      throw new Error(`Unexpected collector runtime import: ${id}`);
    },
    setInterval(callback: () => void, delay: number) {
      assert.equal(delay, 500);
      const handle = nextHandle++;
      timers.set(handle, callback);
      return handle;
    },
    clearInterval(handle: number) { timers.delete(handle); },
  }, { filename: sourcePath });

  const collector = exports.PropsRegistryGarbageCollector;
  assert.ok(collector);
  return {
    collector,
    timers,
    queueSettled(updates: SettledUpdate[]) { settled = updates; },
    tick() { for (const callback of [...timers.values()]) callback(); },
    nativeReads() { return nativeReads; },
  };
}

function createView() {
  const received: StyleProps[] = [];
  const view: AnimatedView = {
    _syncStylePropsBackToReact(props) { received.push(props); },
  };
  return { view, received };
}

describe('Reanimated props registry cleanup', () => {
  it('keeps the inner owner when nested animated components register one tag', () => {
    const { collector, timers } = createHarness();
    const inner = createView();
    const outer = createView();
    collector.registerView(10, inner.view);
    const handle = collector.intervalId;
    collector.registerView(10, outer.view);
    assert.equal(collector.viewsMap.get(10), inner.view);
    assert.equal(collector.viewsCount, 1);
    assert.equal(collector.viewsMap.size, 1);
    assert.equal(collector.intervalId, handle);
    assert.equal(timers.size, 1);
  });

  it('ignores duplicate and unknown unregisters while another view stays mounted', () => {
    const h = createHarness();
    h.collector.registerView(10, createView().view);
    h.collector.registerView(10, createView().view);
    h.collector.registerView(20, createView().view);
    h.collector.unregisterView(10);
    h.collector.unregisterView(10);
    h.collector.unregisterView(999);
    assert.equal(h.collector.viewsCount, 1);
    assert.equal(h.collector.viewsMap.size, 1);
    assert.ok(h.collector.viewsMap.has(20));
    assert.equal(h.timers.size, 1);
    h.tick();
    assert.equal(h.nativeReads(), 1);
  });

  it('keeps one cleanup timer through 100 freeze/remount cycles of 60 nested rows', () => {
    const h = createHarness();
    for (let tag = 1; tag <= 4; tag++) h.collector.registerView(tag, createView().view);
    const rows: [number, AnimatedView][] = [];
    // A Swipeable creates eight native tags. Its container and content also
    // have GestureDetector's AnimatedWrap owners sharing their native tags.
    for (let row = 0; row < 60; row++) {
      for (let slot = 0; slot < 8; slot++) {
        const tag = 1000 + row * 8 + slot;
        rows.push([tag, createView().view]);
        if (slot === 0 || slot === 5) rows.push([tag, createView().view]);
      }
    }
    for (const [tag, view] of rows) h.collector.registerView(tag, view);
    for (let cycle = 0; cycle < 100; cycle++) {
      for (const [tag] of rows) h.collector.unregisterView(tag);
      assert.equal(h.collector.viewsCount, 4);
      assert.equal(h.collector.viewsMap.size, 4);
      assert.equal(h.timers.size, 1);
      for (const [tag, view] of rows) h.collector.registerView(tag, view);
      assert.equal(h.collector.viewsCount, 484);
      assert.equal(h.collector.viewsMap.size, 484);
      assert.equal(h.timers.size, 1);
      h.tick();
    }
    assert.equal(h.nativeReads(), 100);
  });

  it('stops after the last view leaves and starts again on the next mount', () => {
    const h = createHarness();
    h.collector.registerView(10, createView().view);
    h.tick();
    h.collector.unregisterView(10);
    h.collector.unregisterView(10);
    assert.equal(h.collector.viewsCount, 0);
    assert.equal(h.collector.viewsMap.size, 0);
    assert.equal(h.collector.intervalId, null);
    assert.equal(h.timers.size, 0);
    h.tick();
    assert.equal(h.nativeReads(), 1);
    h.collector.registerView(20, createView().view);
    assert.equal(h.collector.viewsCount, 1);
    assert.equal(h.timers.size, 1);
    h.tick();
    assert.equal(h.nativeReads(), 2);
  });

  it('does not create an extra timer when interval registration repeats', () => {
    const { collector, timers } = createHarness();
    collector.registerView(10, createView().view);
    const handle = collector.intervalId;
    collector.registerInterval();
    collector.registerInterval();
    assert.equal(collector.intervalId, handle);
    assert.equal(timers.size, 1);
    collector.unregisterView(10);
    assert.equal(timers.size, 0);
    collector.unregisterInterval();
    assert.equal(collector.intervalId, null);
  });

  it('syncs settled styles to the registered inner view and skips absent or null styles', () => {
    const h = createHarness();
    const inner = createView();
    const outer = createView();
    const active = createView();
    const props = { opacity: 0.62, transform: [{ scale: 1.02 }] };
    h.collector.registerView(10, inner.view);
    h.collector.registerView(10, outer.view);
    h.collector.registerView(20, active.view);
    h.queueSettled([
      { viewTag: 10, styleProps: props },
      { viewTag: 20, styleProps: null },
      { viewTag: 999, styleProps: { opacity: 0 } },
    ]);
    h.tick();
    assert.equal(h.nativeReads(), 1);
    assert.deepEqual(inner.received, [props]);
    assert.deepEqual(outer.received, []);
    assert.deepEqual(active.received, []);
  });
});
