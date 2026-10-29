import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as ampp from '@/lib/amppDock';
import * as dockRules from '@/lib/liquidDock';
import * as buttonRules from '@/lib/glassButtonMotion';
import * as swipeRules from '@/lib/miniPlayerSwipe';

type Event = { translationX: number; translationY: number; velocityX: number; velocityY: number; x: number; y: number };
type Timing = { target: number; done?: (finished: boolean) => void };
const event = (translationX = 0, translationY = 0, velocityX = 0, velocityY = 0): Event =>
  ({ translationX, translationY, velocityX, velocityY, x: 150, y: 24 });
const mutable = (value: any) => ({ value, get() { return this.value; }, set(next: any) { this.value = next; } });
const jsx = (type: unknown, props: object) => ({ type, props });

// Mount the actual MiniPlayer and call its installed Pan callbacks with the
// zeroed ACTIVE event emitted by Android's PanGestureHandler.activate(). Only
// native rendering, animation and RN scheduling boundaries are supplied here;
// the component itself chooses the axis, navigation and playback action.
function harness(presentation: 'amll' | 'resonus' = 'amll', amPlus = false) {
  const callbacks: Record<string, (...args: any[]) => void> = {};
  const pan: Record<string, any> = {};
  for (const name of ['minDistance', 'onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
    pan[name] = (value: unknown) => {
      if (typeof value === 'function') callbacks[name] = value as (...args: any[]) => void;
      return pan;
    };
  }
  const queued: (() => void)[] = [];
  const timings: Timing[] = [];
  const pushes: string[] = [];
  const calls = { next: 0, previous: 0, reset: 0, back: 0 };
  const bus = { miniArtworkMetrics: mutable(null), playerArtworkFlight: mutable(null),
    playerSurfaceOwner: mutable(0), revealOffset: mutable(-1) };
  const player = { song: { id: 'one', title: 'Title', artist: 'Artist' }, index: 0,
    isPlaying: false, isBuffering: false, toggle() {}, next() { calls.next++; },
    previous() { calls.previous++; }, reset() { calls.reset++; } };
  const settings = { playerPresentation: presentation, miniPlayerButtons: 'none', marqueeTitles: false };
  const dependencies: Record<string, any> = {
    react: { useCallback: (callback: unknown) => callback, useRef: (value: unknown) => ({ current: value }),
      useState: (value: unknown) => [value, () => {}], useLayoutEffect() {} },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'Spinner', I18nManager: { isRTL: false }, Pressable: 'Pressable', Text: 'Text', View: 'View' },
    'react-native-gesture-handler': { Gesture: { Pan: () => pan }, GestureDetector: 'GestureDetector' },
    'react-native-reanimated': { __esModule: true,
      default: { View: 'AnimatedView', createAnimatedComponent: (value: unknown) => value },
      useSharedValue: mutable, useAnimatedRef: () => () => null, useDerivedValue: (get: () => unknown) => ({ get }),
      useAnimatedStyle: (read: () => unknown) => ({ read }), useAnimatedReaction() {}, cancelAnimation() {},
      withTiming: (target: number, _options: unknown, done?: Timing['done']) => { timings.push({ target, done }); return target; },
      withSpring: (target: number) => target,
      interpolate: (value: number, [low, high]: number[], [start, end]: number[]) => start + (end - start) * (value - low) / (high - low),
      Extrapolation: { CLAMP: 'clamp' } },
    'react-native-worklets': { scheduleOnUI: (callback: () => void) => callback(),
      scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => { queued.push(() => callback(...args)); } },
    'expo-router': { router: { canGoBack: () => true, back: () => { calls.back++; } } },
    '@/api/data': { COVER: { thumb: 'thumb' }, songCoverUrl: () => 'cover.jpg' },
    '@/hooks/useFavoriteIds': { useFavoriteIds: () => null },
    '@/hooks/useLiquidDock': { useLiquidDock: () => ({ amPlus, enabled: true, compact: false, hasSearch: true, progress: mutable(0) }),
      COMPACT_DOCK_GAP: 8, COMPACT_DOCK_SIZE: 48 },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400, height: 800 }) },
    '@/i18n': { useT: () => (text: string) => text },
    '@/lib/haptics': {}, '@/lib/liquidDock': dockRules, '@/lib/amppDock': ampp,
    '@/lib/glassButtonMotion': buttonRules, '@/lib/miniPlayerSwipe': swipeRules,
    '@/lib/playerReveal': bus, '@/lib/pushOnce': { pushOnce: (href: string) => { pushes.push(href); } },
    '@/store/toast': {},
    '@/store/player': { currentSong: (state: typeof player) => state.song,
      usePlayerStore: (select: (state: typeof player) => unknown) => select(player), useLiveInfo: () => null },
    '@/store/settings': { useSettings: (select: (state: typeof settings) => unknown) => select(settings) },
    '@/theme': { BOTTOM_BAR_HORIZONTAL_MARGIN: 16, BOTTOM_BAR_MAX_WIDTH: 600, MINI_PLAYER_HEIGHT: 48, TAB_BAR_HEIGHT: 56,
      fontSize: { sm: 14 }, spacing: { sm: 8, lg: 16 }, useThemeMode: () => 'dark', themed: (create: (colors: object) => unknown) => create({}) },
    '@/theme/motion': { motion: { easing: { move: 'move' }, duration: { move: 220 }, reduceMotion: { decorative: 'system' } } },
    './BarBlur': { useBarBlur: () => false }, './glass': { FloatingGlassBackdrop: 'Glass' },
    './Cover': { Cover: 'Cover' }, './FavoriteButton': { FavoriteButton: 'FavoriteButton' }, './MarqueeText': { MarqueeText: 'MarqueeText' },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/components/MiniPlayer.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected mini gesture import ${id}`); return dependencies[id];
  } });
  exports.MiniPlayer();
  return { callbacks, bus, pushes, calls, timings,
    queued: () => queued.length,
    drain() { while (queued.length) queued.shift()!(); },
    begin() { callbacks.onBegin(event()); callbacks.onStart(event()); },
    update: (value: Event) => callbacks.onUpdate(value),
    end(value: Event, success = true) { callbacks.onEnd(value, success); callbacks.onFinalize(value, success); },
  };
}

describe('real MiniPlayer Pan activation and axis ownership', () => {
  for (const amPlus of [false, true]) {
    it(`opens AMLL exactly once after Android's zeroed activation and a vertical pull (${amPlus ? 'AM++' : 'regular'} dock)`, () => {
      const h = harness('amll', amPlus); h.begin();
      h.update(event(1.8, .1));
      assert.equal(h.queued(), 0, 'tiny activation jitter must not claim the horizontal axis');
      h.update(event(0, -13));
      assert.equal(h.queued(), 1);
      for (const distance of [-40, -100, -260]) h.update(event(0, distance));
      h.end(event(0, -260, 0, -900)); h.drain();
      assert.deepEqual(h.pushes, ['/player?artwork=1']);
      assert.equal(h.bus.revealOffset.get(), -1, 'AMLL Snap does not start the legacy reveal clock');
      assert.deepEqual(h.calls, { next: 0, previous: 0, reset: 0, back: 0 });
    });
  }

  it('keeps a horizontal gesture horizontal when a later diagonal sample turns upward', () => {
    const h = harness(); h.begin();
    h.update(event(3, .5)); h.update(event(100, -200));
    h.end(event(100, -200, 900, -1500)); h.drain();
    assert.equal(h.calls.previous, 1);
    assert.equal(h.calls.next, 0);
    assert.deepEqual(h.pushes, []);
    assert.equal(h.bus.revealOffset.get(), -1);
  });

  it('keeps a vertical gesture vertical when a later diagonal sample becomes wider', () => {
    const h = harness(); h.begin();
    h.update(event(.1, -3)); h.update(event(-150, -30));
    h.end(event(-150, -30, -1200, -900)); h.drain();
    assert.deepEqual(h.pushes, ['/player?artwork=1']);
    assert.equal(h.calls.next, 0);
    assert.equal(h.calls.previous, 0);
  });

  it('retains deliberate horizontal skip thresholds and clears the axis before the next gesture', () => {
    const h = harness(); h.begin(); h.update(event(-20, 0));
    h.end(event(-20, 0, -100, 0)); h.drain();
    assert.equal(h.calls.next, 0); assert.equal(h.calls.previous, 0); assert.deepEqual(h.pushes, []);
    h.begin(); h.update(event(-100, 0)); h.end(event(-100, 0, -900, 0)); h.drain();
    assert.equal(h.calls.next, 1); assert.equal(h.calls.previous, 0);
    h.begin(); h.update(event(0, -20)); h.end(event(0, -20, 0, -900)); h.drain();
    assert.deepEqual(h.pushes, ['/player?artwork=1'], 'the earlier horizontal lock cannot leak into a later pull');
  });

  it('does not open or skip for activation-only or sub-threshold movement', () => {
    const h = harness(); h.begin();
    h.update(event(0, 0)); h.update(event(2, -2));
    h.end(event(2, -2)); h.drain();
    assert.deepEqual(h.pushes, []);
    assert.deepEqual(h.calls, { next: 0, previous: 0, reset: 0, back: 0 });
    assert.equal(h.bus.revealOffset.get(), -1);
    h.begin(); h.update(event(0, -10)); h.end(event(0, -10)); h.drain();
    assert.deepEqual(h.pushes, [], 'a real vertical direction below the reveal distance is still not an opening');
  });

  it('preserves the legacy upward reveal and relinquishes its clock only on completed settling', () => {
    const h = harness('resonus'); h.begin(); h.update(event(0, -13)); h.drain();
    assert.deepEqual(h.pushes, ['/player?reveal=1']);
    assert.equal(h.bus.revealOffset.get(), 800);
    h.update(event(0, -200)); assert.equal(h.bus.revealOffset.get(), 612);
    h.end(event(0, -200, 0, -900));
    assert.equal(h.bus.revealOffset.get(), 0);
    const settle = h.timings.findLast((value) => value.done);
    assert.equal(settle?.target, 0);
    settle?.done?.(true);
    assert.equal(h.bus.revealOffset.get(), -1);
    h.drain(); assert.equal(h.pushes.length, 1);
    assert.deepEqual(h.calls, { next: 0, previous: 0, reset: 0, back: 0 });
  });
});
