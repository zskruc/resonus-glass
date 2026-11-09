import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function source(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, AbortController, setTimeout, clearTimeout, ...globals, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  } }); return exports;
}
function harness() {
  const a = { id: 'A' }, b = { id: 'B' }, auth = createStore<any>(() => ({ auth: a, offline: false, autoOffline: false }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth.id };
  const timers = new Map<number, () => void>(), listeners = new Set<(state: string) => void>(); let sequence = 0;
  const globals = { setTimeout: (work: () => void, wait: number) => { assert.equal(wait, 5000); const id = ++sequence; timers.set(id, work); return id; }, clearTimeout: (id: number) => timers.delete(id) };
  const scheduler = source('src/lib/podcastMaintenanceScheduler.ts', {}, globals);
  const app = { currentState: 'active', addEventListener: (_name: string, work: (state: string) => void) => { listeners.add(work); return { remove: () => listeners.delete(work) }; } };
  const calls: any[] = [];
  const finish: (() => void)[] = [];
  const hook = source('src/hooks/usePodcastStorageMaintenance.ts', { react: React, 'react-native': { AppState: app },
    '@/lib/podcastMaintenanceScheduler': scheduler,
    '@/lib/podcastStorage': { runPodcastMaintenance: (options: any) => {
      calls.push(options); return new Promise<void>((resolve) => finish.push(resolve));
    } },
    '@/lib/lyricOwner': source('src/lib/lyricOwner.ts', { '@/store/auth': authModule }), '@/store/auth': authModule,
  });
  let root: ReactTestRenderer, enabled = false;
  function Component() { hook.usePodcastStorageMaintenance(enabled); return null; }
  return { auth, calls, timers,
    async mount() { await act(async () => { root = create(React.createElement(Component)); }); },
    async enabled(value: boolean) { enabled = value; await act(async () => root.update(React.createElement(Component))); },
    async state(value: string) { await act(async () => { app.currentState = value; for (const listen of listeners) listen(value); }); },
    async fire() { await act(async () => { const next = timers.entries().next().value; if (next) { timers.delete(next[0]); next[1](); } }); },
    async aba() { await act(async () => { auth.setState({ auth: b }); auth.setState({ auth: a }); }); },
    async close() { await act(async () => { root.unmount(); for (const complete of finish) complete(); }); assert.equal(listeners.size, 0); },
  };
}

test('actual lifecycle hook waits for restored readiness and foreground idle, then stops on background/unmount', async () => {
  const h = harness();
  try {
    await h.mount(); assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0);
    await h.enabled(true); assert.equal(h.timers.size, 1);
    await h.state('background'); assert.equal(h.timers.size, 0);
    await h.state('active'); await h.fire(); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].expectedProfile, 'A'); assert.equal(h.calls[0].current(), true);
    await h.state('background'); assert.equal(h.calls[0].current(), false);
    await h.state('active'); assert.equal(h.timers.size, 0, 'the same session cannot scan on every foreground');
  } finally { await h.close(); }
  assert.equal(h.calls[0].signal.aborted, true);
});

test('batched A to B to A revokes the actual cleanup owner despite matching final account and creates a new fenced session', async () => {
  const h = harness();
  try {
    await h.mount(); await h.enabled(true); await h.fire(); const first = h.calls[0];
    await h.aba(); assert.equal(first.signal.aborted, true); assert.equal(first.current(), false);
    assert.equal(h.timers.size, 1); await h.fire(); assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].current(), true);
    await h.enabled(false); assert.equal(h.calls[1].current(), false); assert.equal(h.calls[1].signal.aborted, true);
  } finally { await h.close(); }
});

test('the actual playback protection getter excludes historical queue items and retains accepted/preloaded sources', () => {
  const code = ts.createSourceFile('player.ts', readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const node = code.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'getPodcastStoragePlaybackSongs')!;
  const current = { id: 'current', podcastChannelId: 'show' }, historical = { id: 'old-queue', podcastChannelId: 'show' };
  const preload = { id: 'actual-preload', podcastChannelId: 'other' }, installed = { id: 'installed-old-source', podcastChannelId: 'prior' };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(node.getText(code), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, usePlayerStore: { getState: () => ({ queue: [current, historical, preload], index: 0, isPlaying: false }) },
    currentSong: (state: any) => state.queue[state.index], queuedNext: { index: 2, id: preload.id },
    longFormOwner: { scope: 'A', songId: installed.id }, lastPodcastSample: { scope: 'A', song: installed }, profileScopeId: () => 'A',
  });
  assert.deepEqual(Array.from(exports.getPodcastStoragePlaybackSongs(), (song: any) => song.id), [current.id, preload.id, installed.id]);
});

function visitHarness() {
  const a = { id: 'A' }, b = { id: 'B' }, auth = createStore<any>(() => ({ auth: a, offline: false, autoOffline: false }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth.id };
  const listeners = new Set<(state: string) => void>(), calls: { scope: string; id: string; time: number; current(): boolean }[] = [];
  const lease = source('src/lib/podcastStorageLease.ts', {});
  const lyricOwner = source('src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  let time = 1, focused = true, id: string | undefined = 'show', root: ReactTestRenderer;
  const hook = source('src/hooks/usePodcastStorageVisit.ts', {
    // The test router changes focus before explicitly rerendering its host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    react: React, 'expo-router': { useFocusEffect: (effect: React.EffectCallback) => React.useEffect(() => focused ? effect() : undefined, [effect, focused]) },
    'react-native': { AppState: { addEventListener: (_event: string, listener: (state: string) => void) => {
      listeners.add(listener); return { remove: () => listeners.delete(listener) };
    } } },
    '@/lib/podcastDb': { touchChannel: async (scope: string, id: string, time: number, current: () => boolean) => { calls.push({ scope, id, time, current }); } },
    '@/lib/localLibrary': { hashKey: (profile: string) => `hashed-${profile}` }, '@/lib/lyricOwner': lyricOwner,
    '@/lib/podcastStorageLease': lease, '@/store/auth': authModule,
  }, { Date: { now: () => time } });
  function Component() { hook.usePodcastStorageVisit(id); return null; }
  return { calls, lease, auth, a,
    async mount() { await act(async () => { root = create(React.createElement(Component)); }); },
    async focus(value: boolean) { focused = value; await act(async () => { root.update(React.createElement(Component)); }); },
    async show(value: string | undefined) { id = value; await act(async () => { root.update(React.createElement(Component)); }); },
    setTime(value: number) { time = value; },
    async state(value: string) { await act(async () => { for (const listener of listeners) listener(value); }); },
    async aba() { await act(async () => { auth.setState({ auth: b }); auth.setState({ auth: a }); }); },
    async switchToB() { await act(async () => { auth.setState({ auth: b }); }); },
    async close() { await act(async () => { root.unmount(); }); assert.equal(listeners.size, 0); },
  };
}

test('actual visit hook updates retention on background, return and leaving after a multi-day stay, then releases its lease', async () => {
  const h = visitHarness();
  try {
    await h.mount(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].time, 1);
    assert.equal(h.lease.protectedPodcastStorageChannels('hashed-A').has('show'), true);
    h.setTime(4 * 86_400_000); await h.state('background');
    assert.equal(h.calls.at(-1)!.time, 4 * 86_400_000); assert.equal(h.calls.at(-1)!.current(), true);
    h.setTime(8 * 86_400_000); await h.state('active');
    assert.equal(h.calls.at(-1)!.time, 8 * 86_400_000);
    h.setTime(9 * 86_400_000); await h.focus(false);
    const exit = h.calls.at(-1)!;
    assert.equal(exit.time, 9 * 86_400_000, 'three-day retention starts from the final visible visit, not page opening');
    assert.equal(exit.current(), true, 'queued final touch remains valid after focus cleanup');
    assert.equal(h.calls[0].current(), false, 'old in-focus queued writes are revoked');
    assert.equal(h.lease.protectedPodcastStorageChannels('hashed-A').size, 0);
    const count = h.calls.length; await h.state('background'); assert.equal(h.calls.length, count, 'blurred page has no remaining AppState listener');
  } finally { await h.close(); }
});

test('actual visit hook fences pending and final-exit writes across account switch and batched A-B-A', async () => {
  const h = visitHarness();
  try {
    await h.mount(); const admittedA = h.calls[0];
    await h.aba(); assert.equal(admittedA.current(), false);
    const count = h.calls.length; await h.state('background'); await h.focus(false);
    assert.equal(h.calls.length, count, 'an epoch-invalid A visit cannot write even when the original A identity returns');
    assert.equal(h.lease.protectedPodcastStorageChannels('hashed-A').size, 0);
    await h.focus(true); const freshA = h.calls.at(-1)!; assert.equal(freshA.current(), true);
    h.setTime(42); await h.switchToB();
    assert.equal(freshA.current(), false); assert.equal(h.calls.at(-1)!.scope, 'hashed-B');
    assert.equal(h.calls.filter((call) => call.scope === 'hashed-A' && call.time === 42).length, 0, 'cleanup from account A never writes its exit into B or revives old A');
    assert.equal(h.lease.protectedPodcastStorageChannels('hashed-A').size, 0);
    assert.equal(h.lease.protectedPodcastStorageChannels('hashed-B').has('show'), true);
    await h.show(undefined); assert.equal(h.lease.protectedPodcastStorageChannels('hashed-B').size, 0);
  } finally { await h.close(); }
});
