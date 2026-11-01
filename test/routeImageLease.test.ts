import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canFreezeRouteImages, planRouteImages, rootImageNavigation, RouteImageLeaseController,
  type ImageLeaseRoute } from '../src/lib/routeImageLease';

const route = (key: string, name: string): ImageLeaseRoute => ({ key, name });
const home = route('tabs', '(tabs)');
const artist = (key: string) => route(key, 'artist/[id]');
const album = (key: string) => route(key, 'album/[id]');
const state = (...routes: ImageLeaseRoute[]) => ({ index: routes.length - 1, routes });
const keys = (value: ReadonlySet<string>) => [...value].sort();

function harness() {
  let sequence = 0;
  const tasks = new Map<number, () => void>();
  const cancelled = new Map<number, () => void>();
  const controller = new RouteImageLeaseController({
    schedule(callback) { const id = ++sequence; tasks.set(id, callback); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel(timer) { const id = timer as unknown as number; const callback = tasks.get(id);
      if (callback) cancelled.set(id, callback); tasks.delete(id); },
  });
  return { controller, snapshot: () => controller.getSnapshot(),
    finish() { const callbacks = [...tasks.values()]; tasks.clear(); for (const callback of callbacks) callback(); },
    deliverCancelledTimers() { for (const callback of cancelled.values()) callback(); cancelled.clear(); },
    pending: () => tasks.size,
  };
}

describe('bounded route image leases', () => {
  it('limits a deep alternating artist/album history while retaining tabs and current/previous pages', () => {
    const routes = [home];
    for (let i = 0; i < 120; i++) routes.push(i % 2 ? album(`album-${i}`) : artist(`artist-${i}`));
    const plan = planRouteImages(state(...routes));
    assert.deepEqual(keys(plan.retainedKeys), ['album-119', 'artist-118', 'tabs']);
    assert.equal(plan.focusedKey, 'album-119');
    assert.equal(routes.length, 121, 'resource retirement must never pop/remove navigation history');
  });

  it('retains player and lyrics underlays independently of focus, with bounded duplicate modals', () => {
    const plan = planRouteImages(state(home, artist('eason'), route('old-player', 'player'),
      route('older-lyric', 'lyrics'), album('air'), route('player', 'player'), route('lyric', 'lyrics'), route('queue', 'queue')));
    assert.deepEqual(keys(plan.retainedKeys), ['air', 'eason', 'lyric', 'player', 'queue', 'tabs']);
    const twentyPlayers = planRouteImages(state(home, artist('eason'), ...Array.from({ length: 20 }, (_, i) => route(`player-${i}`, 'player'))));
    assert.deepEqual(keys(twentyPlayers.retainedKeys), ['eason', 'player-19', 'tabs']);
  });

  it('ignores preloaded routes above index and unwraps only the generated Expo root', () => {
    const stack = { index: 1, routes: [home, artist('visible'), album('preloaded')] };
    const root = { index: 0, routes: [{ key: 'slot', name: '__root', state: stack }] };
    assert.deepEqual(keys(planRouteImages(rootImageNavigation(root)).retainedKeys), ['tabs', 'visible']);
    assert.equal(rootImageNavigation({ routes: [{ key: 'bad', name: '__root', state: { routes: [], index: 0 } }] }), undefined);
    assert.equal(rootImageNavigation({ index: 10, routes: [home] }), undefined);
    assert.equal(rootImageNavigation({ index: 0.5, routes: [home] }), undefined);
    assert.equal(planRouteImages(undefined).ready, false, 'an unready navigator must not blank initial images');
    assert.equal(rootImageNavigation({ routes: [{ key: 'slot', name: '__root' }] }), undefined);
  });

  it('preserves proven ownership across transient hydration/deep-link partial snapshots', () => {
    const h = harness(); h.controller.observe(state(home, artist('artist'), album('album')));
    const valid = h.snapshot();
    h.controller.observe(undefined);
    assert.equal(h.snapshot(), valid, 'partial state must not reactivate every old page');
    h.controller.observe(rootImageNavigation({ routes: [{ key: 'slot', name: '__root' }] }));
    assert.equal(h.snapshot(), valid);
    h.controller.observe(state(home, album('target'))); h.finish();
    assert.deepEqual(keys(h.snapshot().retainedKeys), ['tabs', 'target']);
  });

  it('does not release a real long gesture and settles cancellation without retaining a stale native union', () => {
    const h = harness(); const c = h.controller;
    c.observe(state(home, artist('a'), album('b')));
    c.observe(state(home, artist('a'), album('b'), artist('c')));
    c.transitionStart('c', false);
    assert.equal(h.pending(), 0, 'a real gesture has no hard deadline that can blank a half-dragged page');
    h.finish(); h.deliverCancelledTimers();
    assert.equal(h.snapshot().retainedKeys.has('a'), true);
    c.transitionCancel('c');
    assert.deepEqual(keys(h.snapshot().retainedKeys), ['b', 'c', 'tabs']);
  });

  it('carries native will-disappear/appear starts that precede their JS navigation state commit', () => {
    const h = harness(); const c = h.controller;
    c.observe(state(home, artist('a'), album('b')));
    c.transitionStart('b', true);
    c.observe(state(home, artist('a')));
    assert.equal(h.pending(), 0, 'the pre-observe closing start must suppress the NONE fallback');
    h.finish(); h.deliverCancelledTimers();
    assert.equal(h.snapshot().retainedKeys.has('b'), true, 'a slow pop still paints its closing page after 700ms');
    c.transitionEnd('b', true);
    assert.equal(h.snapshot().retainedKeys.has('b'), false);
    c.transitionStart('c', false);
    c.observe(state(home, artist('a'), artist('c')));
    assert.equal(h.pending(), 0, 'the incoming native will-appear is also associated with the next plan');
    c.transitionEnd('c', false);
    assert.equal(h.snapshot().transitionKeys.size, 0);
  });

  it('snapshots subscription listeners during synchronous replacement', () => {
    const h = harness(); let calls = 0;
    let unsubscribe = () => {};
    const listener = () => { calls++; unsubscribe(); unsubscribe = h.controller.subscribe(listener); };
    unsubscribe = h.controller.subscribe(listener);
    h.controller.observe(state(home));
    assert.equal(calls, 1, 'removing/readding a listener during notify must not reenter forever');
    unsubscribe(); h.controller.dispose();
  });

  it('keeps the outgoing and incoming resource sets through a native fade, then releases old resources', () => {
    const h = harness(); const c = h.controller;
    c.observe(state(home, artist('a'), album('b')));
    c.observe(state(home, artist('a'), album('b'), artist('c')));
    c.transitionStart('c', false); c.transitionStart('b', true);
    assert.deepEqual(keys(h.snapshot().retainedKeys), ['a', 'b', 'c', 'tabs']);
    c.transitionEnd('c', false);
    assert.equal(h.snapshot().retainedKeys.has('a'), true, 'outgoing native completion is still pending');
    c.transitionEnd('b', true);
    assert.deepEqual(keys(h.snapshot().retainedKeys), ['b', 'c', 'tabs']);
    assert.equal(h.pending(), 0);
  });

  it('rejects late opening events and old fallback timers after an interrupted push/pop', () => {
    const h = harness(); const c = h.controller;
    c.observe(state(home, artist('a'), album('b')));
    c.observe(state(home, artist('a'), album('b'), artist('c')));
    c.transitionStart('c', false);
    c.observe(state(home, artist('a'), album('b')));
    c.transitionStart('c', true); c.transitionStart('b', false);
    c.transitionEnd('c', false);
    h.deliverCancelledTimers();
    assert.equal(h.snapshot().retainedKeys.has('c'), true, 'the newer closing transition still owns C');
    c.transitionEnd('c', true); c.transitionEnd('b', false);
    assert.deepEqual(keys(h.snapshot().retainedKeys), ['a', 'b', 'tabs']);
  });

  it('bounds rapid navigation and recovers when native animation:none sends no end event', () => {
    const h = harness(); const routes = [home]; h.controller.observe(state(...routes));
    for (let i = 0; i < 200; i++) {
      routes.push(artist(`a${i}`)); h.controller.observe(state(...routes));
      assert.ok(h.snapshot().retainedKeys.size <= 4, 'only the immediately previous/new plans may be unioned');
    }
    h.finish();
    assert.deepEqual(keys(h.snapshot().retainedKeys), ['a198', 'a199', 'tabs']);
    h.controller.dispose(); assert.equal(h.pending(), 0);
  });

  it('requires an image release commit before a covered route may freeze', () => {
    const h = harness(); const c = h.controller;
    c.observe(state(home, artist('a'), album('b')));
    assert.equal(canFreezeRouteImages(h.snapshot(), 'b', true), false);
    assert.equal(canFreezeRouteImages(h.snapshot(), 'a', true), false, 'the retained back/transparent underlay must remain paintable');
    c.observe(state(home, artist('a'), album('b'), artist('c')));
    assert.equal(canFreezeRouteImages(h.snapshot(), 'a', true), false, 'transitioning views stay paintable');
    h.finish();
    assert.equal(h.snapshot().retainedKeys.has('a'), false);
    assert.equal(canFreezeRouteImages(h.snapshot(), 'a', false), false, 'first thaw commit removes native image targets');
    assert.equal(canFreezeRouteImages(h.snapshot(), 'a', true), true, 'only the acknowledged lease can freeze retained page state');
    assert.equal(canFreezeRouteImages(h.snapshot(), 'c', true), false);
  });
});
