import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as rules from '../src/lib/trackSwipe';

// Execute the production component's gesture callbacks and React boundary
// notifications without a native renderer. Animations finish explicitly so
// races between a returning row and its next gesture are deterministic.
const source = readFileSync(new URL('../src/components/TrackSwipeable.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
type Event = { translationX: number; velocityX: number };
type Element = { type: unknown; props: Record<string, any> };
type Spring = { spring: true; target: number; done?: (finished: boolean) => void };
type Mutable = { value: any; animation?: Spring; get(): any; set(value: any): void };

class Pan {
  options: Record<string, unknown> = {};
  callbacks: Record<string, (event: Event, success: boolean) => void> = {};
  enabled(value: boolean) { this.options.enabled = value; return this; }
  activeOffsetX(value: number | number[]) { this.options.activeOffsetX = value; return this; }
  failOffsetY(value: number[]) { this.options.failOffsetY = value; return this; }
  onBegin(callback: (event: Event, success: boolean) => void) { this.callbacks.begin = callback; return this; }
  onStart(callback: (event: Event, success: boolean) => void) { this.callbacks.start = callback; return this; }
  onUpdate(callback: (event: Event, success: boolean) => void) { this.callbacks.update = callback; return this; }
  onEnd(callback: (event: Event, success: boolean) => void) { this.callbacks.end = callback; return this; }
  onFinalize(callback: (event: Event, success: boolean) => void) { this.callbacks.finalize = callback; return this; }
}

function harness() {
  let cursor = 0;
  const slots: any[] = [];
  const cleanups: (() => void)[] = [];
  const queued: (() => void)[] = [];
  const mutables: Mutable[] = [];
  const actions: number[] = [];
  const renderedActions: number[] = [];
  let tree: Element;
  const slot = <T,>(create: () => T): T => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = create();
    return slots[index];
  };
  const memo = <T,>(create: () => T, deps: unknown[]): T => {
    const saved = slot(() => ({ deps: undefined as unknown[] | undefined, value: undefined as T | undefined }));
    if (!saved.deps || deps.some((value, index) => !Object.is(value, saved.deps?.[index]))) {
      saved.deps = deps;
      saved.value = create();
    }
    return saved.value as T;
  };
  const effect = (create: () => (() => void) | void, deps: unknown[]) => {
    memo(() => { const cleanup = create(); if (cleanup) cleanups.push(cleanup); return true; }, deps);
  };
  const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
  const exports: { TrackSwipeable?: (props: unknown) => Element } = {};
  runInNewContext(compiled.outputText, {
    exports,
    require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useRef: (value: unknown) => slot(() => ({ current: value })),
        useState: (value: unknown) => {
          const box = slot(() => ({ value }));
          return [box.value, (next: unknown) => { box.value = next; }];
        },
        useEffect: effect,
        useLayoutEffect: effect,
        useMemo: memo,
        useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
        cloneElement: (child: Element, props: object) => ({ ...child, props: { ...child.props, ...props } }),
      };
      if (name === 'react-native') return { View: 'View', StyleSheet: { create: (value: unknown) => value } };
      if (name === 'react-native-gesture-handler') return { Gesture: { Pan: () => new Pan() }, GestureDetector: 'Detector' };
      if (name === 'react-native-worklets') return {
        scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => queued.push(() => callback(...args)),
        scheduleOnUI: (callback: () => void) => callback(),
      };
      if (name === '@/lib/trackSwipe') return rules;
      if (name === 'react-native-reanimated') return {
        ReduceMotion: { System: 'system' },
        useSharedValue: (value: number) => slot(() => {
          const mutable: Mutable = {
            value,
            get() { return this.value; },
            set(next) {
              if (typeof next === 'number' || typeof next === 'boolean') this.value = next;
              else this.animation = next;
            },
          };
          mutables.push(mutable);
          return mutable;
        }),
        useAnimatedStyle: (updater: () => unknown) => ({ updater }),
        withSpring: (target: number, _options: unknown, done: (finished: boolean) => void): Spring => ({ spring: true, target, done }),
        cancelAnimation: (mutable: Mutable) => {
          mutable.animation?.done?.(false);
          mutable.animation = undefined;
        },
      };
      throw new Error(`Unexpected TrackSwipeable import ${name}`);
    },
  });
  assert.ok(exports.TrackSwipeable);
  const props = {
    rowIdentity: 'A',
    children: jsx('ExistingAnimatedPressable', { style: { opacity: 1 } }),
    allowRight: true,
    allowLeft: true,
    actionWidth: 70,
    renderAction(side: number) { renderedActions.push(side); return jsx('Action', { side }); },
    onSwipe(side: number) { actions.push(side); },
  };
  const render = (next?: Partial<typeof props>) => {
    Object.assign(props, next);
    cursor = 0;
    tree = exports.TrackSwipeable!(props);
    return tree;
  };
  render();
  return {
    actions, renderedActions, queued, render,
    start(e: Event) { const pan = tree.props.gesture as Pan; pan.callbacks.begin(e, true); pan.callbacks.start(e, true); },
    pan: () => tree.props.gesture as Pan,
    panel: () => (tree.props.children as Element).props.children[0] as Element | null,
    row: () => (tree.props.children as Element).props.children[1] as Element,
    translation: () => mutables[0],
    drain() { while (queued.length) queued.shift()!(); },
    finish() {
      const mutable = mutables[0];
      const animation = mutable.animation;
      mutable.animation = undefined;
      if (animation) { mutable.value = animation.target; animation.done?.(true); }
    },
    unmount() { cleanups.forEach((cleanup) => cleanup()); },
  };
}
const event = (translationX: number, velocityX = 0): Event => ({ translationX, velocityX });

describe('lightweight song-row gesture lifecycle', () => {
  it('keeps idle action trees absent and leaves ordinary presses to the existing row', () => {
    const h = harness();
    assert.equal(h.panel(), null);
    assert.equal(h.renderedActions.length, 0);
    assert.equal(h.row().type, 'ExistingAnimatedPressable');
    assert.equal(JSON.stringify(h.pan().options.activeOffsetX), '[-30,30]');
    assert.equal(JSON.stringify(h.pan().options.failOffsetY), '[-20,20]');
    h.pan().callbacks.finalize(event(2), false);
    assert.equal(h.queued.length, 0);
    assert.equal(h.translation().animation, undefined);
  });

  it('updates the row on the UI side without scheduling JS on every movement', () => {
    const h = harness();
    h.start(event(35));
    h.drain(); h.render();
    assert.equal(h.renderedActions.at(-1), 1);
    for (let index = 0; index < 1000; index++) h.pan().callbacks.update(event(35 + index), true);
    assert.equal(h.queued.length, 0);
    assert.equal(h.translation().get(), 70);
    h.pan().callbacks.end(event(100), true);
    h.drain();
    assert.deepEqual(h.actions, [1]);
    h.finish(); h.drain(); h.render();
    assert.equal(h.panel(), null);
  });

  it('supports reversal, cancellation, and the original velocity-based left action', () => {
    const h = harness();
    h.start(event(35));
    h.pan().callbacks.update(event(-40), true);
    h.drain(); h.render();
    assert.equal(h.renderedActions.at(-1), -1);
    h.pan().callbacks.end(event(-40, -1100), true);
    h.pan().callbacks.end(event(-40, -1100), true);
    h.drain();
    assert.deepEqual(h.actions, [-1]);
    h.finish(); h.drain();
    h.start(event(35));
    h.pan().callbacks.finalize(event(35), false);
    h.drain(); h.finish(); h.drain(); h.render();
    assert.equal(h.panel(), null);
    assert.deepEqual(h.actions, [-1]);
  });

  it('cannot let an old spring completion close a newer gesture panel', () => {
    const h = harness();
    h.start(event(35));
    h.pan().callbacks.end(event(40), true);
    const old = h.translation().animation;
    h.start(event(-35));
    h.drain(); h.render();
    assert.equal(h.renderedActions.at(-1), -1);
    old?.done?.(true);
    h.drain(); h.render();
    assert.notEqual(h.panel(), null);
    assert.equal(h.renderedActions.at(-1), -1);
  });

  it('ignores queued actions and animation cleanup after the row has unmounted', () => {
    const h = harness();
    h.start(event(35));
    h.pan().callbacks.end(event(100), true);
    h.unmount();
    h.drain(); h.finish(); h.drain();
    assert.deepEqual(h.actions, []);
  });

  it('drops A notifications already queued when the cell becomes B, including ABA reuse', () => {
    const h = harness();
    h.start(event(35));
    h.pan().callbacks.end(event(110), true);
    const old = h.translation().animation;
    h.render({ rowIdentity: 'B', onSwipe: (side) => h.actions.push(side * 10) });
    assert.equal(h.panel(), null);
    assert.equal(h.translation().get(), 0);
    h.render({ rowIdentity: 'A' });
    h.drain(); old?.done?.(true); h.drain(); h.render();
    assert.equal(h.panel(), null);
    assert.deepEqual(h.actions, []);
    h.start(event(-35));
    h.pan().callbacks.end(event(-110), true); h.drain();
    assert.deepEqual(h.actions, [-10]);
  });

  it('rejects old native onEnd delivered to B newest callbacks before the finger is lifted', () => {
    const h = harness();
    h.start(event(35)); h.drain(); h.render();
    const oldPan = h.pan();
    h.render({ rowIdentity: 'B' });
    // RNGH reuses a native handler tag and may route this old end/update to
    // the newest callbacks. Ownership must come from onBegin, not its closure.
    h.pan().callbacks.update(event(110), true);
    h.pan().callbacks.end(event(110), true);
    h.pan().callbacks.finalize(event(110), true);
    oldPan.callbacks.end(event(110), true);
    h.drain(); h.render();
    assert.deepEqual(h.actions, []);
    assert.equal(h.panel(), null);
    assert.equal(h.translation().get(), 0);
    h.start(event(35)); h.pan().callbacks.end(event(110), true); h.drain();
    assert.deepEqual(h.actions, [1]);
  });

  it('does not adopt a pointer that started before recycling but had not activated horizontally', () => {
    const h = harness();
    h.pan().callbacks.begin(event(0), true);
    h.render({ rowIdentity: 'B' });
    h.pan().callbacks.start(event(100), true);
    h.pan().callbacks.end(event(100), true); h.drain();
    assert.deepEqual(h.actions, []);
    assert.equal(h.translation().get(), 0);
  });

  it('keeps an old return completion from hiding B active panel', () => {
    const h = harness();
    h.start(event(35)); h.pan().callbacks.end(event(40), true);
    const old = h.translation().animation;
    h.render({ rowIdentity: 'B' });
    h.start(event(-35)); h.drain(); h.render();
    old?.done?.(true); h.drain(); h.render();
    assert.equal(h.renderedActions.at(-1), -1);
    assert.notEqual(h.panel(), null);
  });

  it('leaves a long press or vertical scroll that never activates the pan without queue actions', () => {
    const h = harness();
    for (const translation of [0, 2, 10]) {
      h.pan().callbacks.begin(event(translation), true);
      h.pan().callbacks.finalize(event(translation), false);
      h.pan().callbacks.end(event(150), false);
    }
    h.drain();
    assert.deepEqual(h.actions, []);
    assert.equal(h.panel(), null);
    assert.equal(h.translation().animation, undefined);
  });
});
