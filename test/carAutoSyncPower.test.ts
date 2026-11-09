import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
async function harness(available = true) {
  let now = 0, intervalCalls = 0, sequence = 0, favorite = false, seekVersion = 0;
  const timers = new Map<number, { run: () => void; ms: number }>();
  const favorites = new Set<() => void>();
  const callbacks: Record<string, (event?: any) => void> = {};
  const pushed: any[] = [], metadata: any[] = [], queues: any[] = [];
  const auth = createStore(() => ({ auth: {}, offline: false }));
  const player = createStore<any>((set, get) => ({
    queue: [{ id: 'one', title: 'One', duration: 200 }, { id: 'two', title: 'Two', duration: 300 }], index: 0,
    isPlaying: true, isBuffering: false, positionSec: 0, speed: 1, shuffle: false, repeat: 'off', streamInfo: null,
    toggle: () => set({ isPlaying: !get().isPlaying }), next: () => set({ index: 1, positionSec: 0 }),
    previous: () => set({ index: 0, positionSec: 0 }), seekTo: (positionSec: number) => set({ positionSec }),
    jumpTo: (index: number) => set({ index, positionSec: 0 }), toggleShuffle: () => set({ shuffle: !get().shuffle }),
    cycleRepeat: () => set({ repeat: get().repeat === 'off' ? 'all' : get().repeat === 'all' ? 'one' : 'off' }),
  }));
  const lastPlayed = createStore(() => ({})), app = { currentState: 'active' };
  const subscribe = (name: string) => (run: (event?: any) => void) => { callbacks[name] = run; return { remove: () => { delete callbacks[name]; } }; };
  const imports: Record<string, unknown> = {
    react: React, 'react-native': { AppState: app },
    '@/api/data': { CACHED_COVER: 'cached-cover:', COVER: { card: 600 }, songCoverUrl: () => undefined },
    '@/lib/carAuto': { carAutoAvailable: available, onCarConnected: subscribe('connect'), onPlay: subscribe('play'), onTransport: subscribe('transport'),
      setNodes() {}, setNowPlaying: (value: any) => metadata.push(value), setQueue: (...value: any[]) => queues.push(value),
      setPlaybackState: (value: any) => pushed.push(value) },
    '@/lib/carAutoTree': { buildBrowseTree: async () => ({ nodes: {} }), buildLatestRecent: async () => null, handleBrowsePlay: async () => {} },
    '@/lib/perfLog': { bump() {} }, '@/lib/storage': { getItem: async () => null, setItem: async () => {} },
    '@/store/auth': { useAuthStore: auth }, '@/store/lastPlayed': { useLastPlayed: lastPlayed },
    '@/lib/remoteFavorite': { favoriteLabel: () => 'Favorite', favoriteState: () => favorite,
      onFavoritesChange: (run: () => void) => { favorites.add(run); return () => { favorites.delete(run); }; },
      toggleFavorite: async () => { favorite = !favorite; favorites.forEach((run) => run()); } },
    '@/store/player': { usePlayerStore: player, currentSong: (state: any) => state.queue[state.index] ?? null,
      playbackUserSeekVersion: () => seekVersion },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/CarAutoSync.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date: { now: () => now },
    setTimeout: (run: () => void, ms: number) => { const id = ++sequence; timers.set(id, { run, ms }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => { intervalCalls++; return ++sequence; }, clearInterval() {},
    require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
  });
  let mounted!: TestRenderer.ReactTestRenderer;
  await act(async () => { mounted = TestRenderer.create(React.createElement(exports.CarAutoSync)); });
  return { player, app, pushed, metadata, queues, callbacks, timers, intervals: () => intervalCalls,
    update: (time: number, patch: object) => { now = time; player.setState(patch); },
    favorite: () => { favorite = !favorite; favorites.forEach((run) => run()); },
    beginUserSeek: () => { seekVersion++; },
    unmount: async () => { await act(async () => { mounted.unmount(); }); } };
}

test('the mounted car sync has no independent position timer, including a phone never connected to a car', async () => {
  const h = await harness();
  assert.equal(h.intervals(), 0); assert.equal(h.pushed.length, 1);
  assert.deepEqual([...h.timers.values()].map((timer) => timer.ms), [600], 'only the existing bounded browse debounce remains');
  await h.unmount(); assert.equal(h.timers.size, 0);
  h.update(10_000, { positionSec: 10 }); assert.equal(h.pushed.length, 1, 'unmount removes the real store callback');
  const absent = await harness(false); assert.equal(absent.intervals(), 0); assert.equal(absent.timers.size, 0);
  assert.equal(absent.pushed.length, 0); await absent.unmount();
});

test('actual position subscriptions push at most once per foreground second and background five seconds', async () => {
  const h = await harness();
  try {
    h.update(500, { positionSec: .5 }); h.update(999, { positionSec: .999 }); assert.equal(h.pushed.length, 1);
    h.update(1_000, { positionSec: 1 }); assert.equal(h.pushed.length, 2);
    h.app.currentState = 'background';
    for (let time = 1_500; time < 6_000; time += 500) h.update(time, { positionSec: time / 1_000 });
    assert.equal(h.pushed.length, 2);
    h.update(6_000, { positionSec: 6 }); assert.equal(h.pushed.length, 3);
    assert.equal(h.pushed.at(-1).positionMs, 6_000);
    h.app.currentState = 'active'; h.update(7_000, { positionSec: 7 }); assert.equal(h.pushed.length, 4);
    assert.equal(h.intervals(), 0);
  } finally { await h.unmount(); }
});

test('playback, buffering, speed, metadata, queue, favorite and transport changes bypass position throttling', async () => {
  const h = await harness(); h.app.currentState = 'background';
  try {
    for (const patch of [{ isPlaying: false }, { isBuffering: true }, { speed: 1.5 }, { shuffle: true }, { repeat: 'all' },
      { streamInfo: { title: 'Radio update' } }, { index: 1, positionSec: 0 }]) {
      const count = h.pushed.length; h.update(100, patch); assert.equal(h.pushed.length, count + 1);
    }
    assert.equal(h.pushed.at(-1).speed, 1.5); assert.equal(h.pushed.at(-1).isBuffering, true);
    let count = h.pushed.length; h.favorite(); assert.equal(h.pushed.length, count + 1);
    count = h.pushed.length; h.callbacks.transport({ action: 'seek', value: 37_500 });
    assert.equal(h.pushed.length, count + 1); assert.equal(h.pushed.at(-1).positionMs, 37_500);
    count = h.pushed.length; h.callbacks.transport({ action: 'next' });
    assert.ok(h.pushed.length > count); assert.equal(h.intervals(), 0);
  } finally { await h.unmount(); }
});

test('phone or lock-screen seek intent survives earlier non-position events and pushes its final position immediately', async () => {
  const h = await harness(); h.app.currentState = 'background';
  try {
    h.beginUserSeek();
    h.update(100, { chapterStop: null, isBuffering: true });
    const beforePosition = h.pushed.length;
    h.update(120, { positionSec: 37.5 });
    assert.equal(h.pushed.length, beforePosition + 1, 'an earlier critical push must not consume a pending seek');
    assert.equal(h.pushed.at(-1).positionMs, 37_500);
    h.update(500, { positionSec: 38 });
    assert.equal(h.pushed.length, beforePosition + 1, 'the next ordinary tick is throttled after consuming the seek');
    h.beginUserSeek();
    h.update(600, { chapterStop: { endSec: 90 } });
    h.update(620, { positionSec: 75 });
    assert.equal(h.pushed.length, beforePosition + 2);
    assert.equal(h.pushed.at(-1).positionMs, 75_000);
    assert.equal(h.intervals(), 0);
  } finally { await h.unmount(); }
});
