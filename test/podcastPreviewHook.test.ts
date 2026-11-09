import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Actual handoff, actual account/network epoch guard, actual React hook.
 * Only directory, SQLite and feed requests are delayed external boundaries. */
function harness({ feed = false, cached }: { feed?: boolean; cached?: any } = {}) {
  const accountA = { id: 'A' }, accountB = { id: 'B' };
  const auth = createStore<any>(() => ({ auth: accountA, offline: false, autoOffline: false, offlineSource: 'downloads' }));
  const profileScopeId = () => auth.getState().auth?.id ?? 'local';
  let focused = true, latest: any, renderer: ReactTestRenderer | undefined;
  const lookups: { id: number; options: any; task: ReturnType<typeof deferred> }[] = [];
  const reads: { feed: string; options: any }[] = [];
  const refreshes: { feed: string; options: any; task: ReturnType<typeof deferred> }[] = [];
  const imports: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'expo-router': { useIsFocused: () => focused },
    '@/store/auth': { profileScopeId, useAuthStore: auth },
    '@/lib/podcastDirectory': { normalizePodcastDirectoryCountry: (country: string) => country.toLowerCase() },
    '@/api/netGate': { isManualOffline: () => auth.getState().offline && !auth.getState().autoOffline },
    '@/api/podcasts': {
      directoryLookup: (id: number, options: any) => { const task = deferred(); lookups.push({ id, options, task }); return task.promise; },
      getStoredChannel: async (feed: string, options: any) => { reads.push({ feed, options }); return cached; },
      refreshChannel: (feed: string, options: any) => { const task = deferred(); refreshes.push({ feed, options, task }); return task.promise; },
    },
  };
  function source(path: string) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, URL, AbortController, setTimeout, clearTimeout, require(name: string) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected preview-hook import ${name}`); return imports[name];
    } });
    return exports;
  }
  imports['@/lib/lyricOwner'] = source('src/lib/lyricOwner.ts');
  const previews = source('src/lib/podcastPreview.ts');
  imports['@/lib/podcastPreview'] = previews;
  const hook = source('src/hooks/usePodcastPreview.ts');
  const handle = previews.beginPodcastPreview({ id: 123, title: 'Public show title', author: 'Publisher',
    imageUrl: 'https://art.example/show.jpg', ...(feed ? { feedUrl: 'https://publisher.example/feed.xml' } : {}) }, 'CN');
  function Component() { latest = hook.usePodcastPreview(handle.token); return React.createElement('preview', { latest }); }
  return {
    async mount() { await act(async () => { renderer = create(React.createElement(Component)); }); },
    async unmount() { await act(async () => { renderer?.unmount(); }); renderer = undefined; },
    async focus(value: boolean) { focused = value; await act(async () => { renderer!.update(React.createElement(Component)); }); },
    async offline(value: boolean, automatic = false) { await act(async () => { auth.setState({ offline: value, autoOffline: automatic }); }); },
    async networkABA() { await act(async () => { auth.setState({ offline: true }); auth.setState({ offline: false }); }); },
    async accountABA() { await act(async () => { auth.setState({ auth: accountB }); auth.setState({ auth: accountA }); }); },
    latest: () => latest, lookups, reads, refreshes,
  };
}

test('the preview metadata is synchronous while Apple lookup and RSS are unresolved', async () => {
  const h = harness();
  try {
    await h.mount();
    assert.equal(h.latest().metadata.title, 'Public show title');
    assert.equal(h.latest().metadata.imageUrl, 'https://art.example/show.jpg');
    assert.equal(h.latest().pending, true); assert.equal(h.latest().channel, undefined);
    assert.equal(h.lookups.length, 1); assert.equal(h.lookups[0].options.country, 'cn');
    assert.equal(h.reads.length, 0); assert.equal(h.refreshes.length, 0);
    await act(async () => { h.lookups[0].task.resolve({ feedUrl: 'https://publisher.example/feed.xml' }); });
    assert.equal(h.refreshes.length, 1); assert.equal(h.latest().metadata.title, 'Public show title');
    assert.equal(h.latest().pending, true);
    const real = { id: 'rss-show', title: 'Resolved show', feedUrl: 'https://publisher.example/feed.xml' };
    await act(async () => { h.refreshes[0].task.resolve(real); });
    assert.equal(h.latest().channel, real); assert.equal(h.latest().pending, false); assert.equal(h.latest().error, false);
  } finally { await h.unmount(); }
});

test('focus cleanup aborts lookup and its late result cannot clear a newer request busy state', async () => {
  const h = harness();
  try {
    await h.mount(); const old = h.lookups[0];
    await h.focus(false); assert.equal(old.options.signal.aborted, true);
    await h.focus(true); assert.equal(h.lookups.length, 2);
    await act(async () => { old.task.resolve({ feedUrl: 'https://obsolete.example/feed.xml' }); });
    assert.equal(h.reads.length, 0); assert.equal(h.refreshes.length, 0);
    assert.equal(h.latest().channel, undefined); assert.equal(h.latest().pending, true);
    await act(async () => { h.lookups[1].task.resolve({ feedUrl: 'https://current.example/feed.xml' }); });
    assert.equal(h.refreshes[0].feed, 'https://current.example/feed.xml');
    const current = { id: 'current', title: 'Current' };
    await act(async () => { h.refreshes[0].task.resolve(current); });
    assert.equal(h.latest().channel, current);
  } finally { await h.unmount(); }
});

test('manual offline cancels pending work and exposes retry, then online starts a fresh owner', async () => {
  const h = harness();
  try {
    await h.mount(); const old = h.lookups[0];
    await h.offline(true);
    assert.equal(old.options.signal.aborted, true); assert.equal(h.lookups.length, 1);
    assert.equal(h.latest().pending, false); assert.equal(h.latest().error, true);
    assert.equal(h.latest().metadata.title, 'Public show title');
    await h.offline(false); assert.equal(h.lookups.length, 2);
    await act(async () => { old.task.resolve({ feedUrl: 'https://obsolete.example/feed.xml' }); });
    assert.equal(h.latest().pending, true); assert.equal(h.reads.length, 0);
    await act(async () => { h.lookups[1].task.resolve({ feedUrl: 'https://current.example/feed.xml' }); });
    const real = { id: 'current', title: 'Current' };
    await act(async () => { h.refreshes[0].task.resolve(real); });
    assert.equal(h.latest().channel, real); assert.equal(h.latest().error, false);
  } finally { await h.unmount(); }
});

test('batched offline and account ABA events invalidate request generations despite identical final auth', async () => {
  const h = harness();
  try {
    await h.mount(); const original = h.lookups[0];
    await h.networkABA();
    assert.equal(original.options.signal.aborted, true);
    assert.equal(h.lookups.length, 2, 'network epochs restart work without discarding the public handoff');
    await act(async () => { original.task.resolve({ feedUrl: 'https://obsolete.example/feed.xml' }); });
    assert.equal(h.reads.length, 0); assert.equal(h.latest().pending, true);
    const second = h.lookups[1]; await h.accountABA();
    assert.equal(second.options.signal.aborted, true);
    assert.equal(h.latest().metadata, undefined); assert.equal(h.latest().channel, undefined);
    assert.equal(h.latest().pending, false); assert.equal(h.latest().error, true);
    await act(async () => { second.task.resolve({ feedUrl: 'https://obsolete.example/feed.xml' }); });
    assert.equal(h.reads.length, 0); assert.equal(h.refreshes.length, 0);
  } finally { await h.unmount(); }
});

test('a stale stored show remains usable when background revalidation fails', async () => {
  const cached = { id: 'stored', title: 'Cached show', refreshedAt: Date.now() - 31 * 60_000 };
  const h = harness({ feed: true, cached });
  try {
    await h.mount();
    assert.equal(h.lookups.length, 0); assert.equal(h.latest().channel, cached);
    assert.equal(h.latest().pending, true); assert.equal(h.refreshes.length, 1);
    await act(async () => { h.refreshes[0].task.reject(new Error('Feed failed')); });
    assert.equal(h.latest().channel, cached); assert.equal(h.latest().pending, false); assert.equal(h.latest().error, true);
  } finally { await h.unmount(); }
});

test('unmount aborts an in-flight feed refresh and ignores a publisher that resolves afterward', async () => {
  const h = harness({ feed: true });
  await h.mount();
  const refresh = h.refreshes[0]; assert.ok(refresh);
  await h.unmount(); assert.equal(refresh.options.signal.aborted, true);
  assert.equal(refresh.options.current(), false);
  await act(async () => { refresh.task.resolve({ id: 'too-late', title: 'Too late' }); });
});
