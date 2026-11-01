import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// SDK 57 vendors React Navigation's actual StackRouter here; exercise its POP implementation.
import { StackRouter, type StackNavigationState } from '../node_modules/expo-router/build/react-navigation/routers/StackRouter.js';
import type { ParamListBase } from '../node_modules/expo-router/build/react-navigation/routers/types.js';
import { DetailNavigationController, detailNavigationDecision,
  type DetailHref, type DetailNavigationDriver, type DetailPopAction } from '../src/lib/detailNavigation';

const options = { routeNames: ['(tabs)', 'artist/[id]', 'album/[id]', 'player', 'lyrics', 'queue', 'login'],
  routeParamList: {}, routeGetIdList: {} };
const router = StackRouter({});
type State = StackNavigationState<ParamListBase>;
const route = (key: string, name: string, id?: string) => ({ key, name, params: id === undefined ? undefined : { id } });
const home = route('home', '(tabs)');
const artist = (key: string, id: string) => route(key, 'artist/[id]', id);
const album = (key: string, id: string) => route(key, 'album/[id]', id);
function stack(...routes: State['routes']): State {
  return { stale: false, type: 'stack', key: 'app-stack', index: routes.length - 1,
    routeNames: options.routeNames, routes, preloadedRoutes: [] };
}
function harness(initial: State, deferred = false) {
  let state = initial;
  let now = 100;
  const actions: DetailPopAction[] = [];
  const pushes: DetailHref[] = [];
  const driver: DetailNavigationDriver = {
    getRootState: () => state,
    dispatch(action) {
      actions.push(action);
      if (!deferred) state = router.getStateForAction(state, action, options)! as State;
    },
    push(href) {
      pushes.push(href);
      if (!deferred) state = router.getStateForAction(state, { type: 'PUSH', payload: {
        name: href.pathname.slice(1), params: href.params,
      } }, options)! as State;
    },
  };
  const controller = new DetailNavigationController(() => now);
  return { driver, controller, actions, pushes, state: () => state,
    open: (kind: 'artist' | 'album', id: string) => controller.open({ kind, id }, driver),
    advance: (ms: number) => { now += ms; } };
}

describe('exact detail ancestor navigation', () => {
  it('pops to A(id1), preserving its original key, params and nested state past another artist', () => {
    const viewState = { scrollY: 742, selected: ['song-4'] };
    const a = { ...artist('artist-a', 'id1'), params: { id: 'id1', viewState }, state: {
      stale: false as const, type: 'tab', key: 'selection-state', index: 0,
      routeNames: ['selection'], routes: [{ key: 'selected', name: 'selection' }],
    } };
    const initial = stack(home, a, album('album-b', 'b'), artist('artist-c', 'id2'), album('album-d', 'd'));
    const h = harness(initial);
    assert.equal(h.open('artist', 'id1'), 'pop');
    assert.deepEqual(h.actions, [{ type: 'POP', target: 'app-stack', source: 'album-d', payload: { count: 3 } }]);
    assert.deepEqual(h.state().routes.map((value) => value.key), ['home', 'artist-a']);
    assert.equal(h.state().routes[1], a, 'POP must preserve the whole surviving route object');
    assert.equal((h.state().routes[1].params as { viewState: unknown }).viewState, viewState);
    assert.equal(h.state().routes[1].state, a.state);
    assert.equal(initial.routes.length, 5, 'the planner must not mutate prior navigation state');
  });

  it('demonstrates why name-only dismissTo cannot safely replace an exact ancestor POP', () => {
    const initial = stack(home, artist('artist-a', 'id1'), album('b', 'b'), artist('artist-c', 'id2'), album('d', 'd'));
    const unsafe = router.getStateForAction(initial, { type: 'POP_TO',
      payload: { name: 'artist/[id]', params: { id: 'id1' } } }, options)!;
    assert.equal(unsafe.routes.at(-1)?.key, 'artist-c');
    assert.equal((unsafe.routes.at(-1)?.params as { id: string }).id, 'id1', 'name-only matching rewrites the wrong artist route');
    const decision = detailNavigationDecision(initial, { kind: 'artist', id: 'id1' });
    assert.equal(decision.type, 'pop');
    assert.equal(decision.type === 'pop' && decision.action.payload.count, 3);
  });

  it('pushes a genuinely new id and does not conflate album and artist ids', () => {
    const h = harness(stack(home, artist('a', 'shared-id'), album('b', 'other')));
    assert.equal(h.open('album', 'shared-id'), 'push');
    assert.equal(h.actions.length, 0);
    assert.deepEqual(h.pushes, [{ pathname: '/album/[id]', params: { id: 'shared-id' } }]);
    assert.equal(h.state().routes.length, 4);
    assert.equal((h.state().routes.at(-1)?.params as { id: string }).id, 'shared-id');
  });

  it('does nothing when the exact target is already focused', () => {
    const h = harness(stack(home, artist('a', 'id1')));
    assert.equal(h.open('artist', 'id1'), 'noop');
    assert.equal(h.open('artist', 'id1'), 'noop');
    assert.equal(h.actions.length + h.pushes.length, 0);
  });

  it('deduplicates repeated POP taps while the previous native state commit is pending', () => {
    const h = harness(stack(home, artist('a', 'id1'), album('b', 'b')), true);
    assert.equal(h.open('artist', 'id1'), 'pop');
    h.advance(150);
    assert.equal(h.open('artist', 'id1'), 'noop');
    assert.equal(h.actions.length, 1);
    assert.equal(h.pushes.length, 0);
  });

  it('deduplicates repeated PUSH taps before commit while allowing another target', () => {
    const h = harness(stack(home), true);
    assert.equal(h.open('artist', 'id1'), 'push');
    assert.equal(h.open('artist', 'id1'), 'noop');
    assert.equal(h.open('artist', 'id2'), 'push');
    assert.equal(h.pushes.length, 2);
  });

  it('unwraps generated __root containers and targets the actual app stack', () => {
    const app = stack(home, artist('a', 'id1'), album('b', 'b'));
    const root = { type: 'stack', key: 'outer-container', index: 0,
      routes: [{ key: 'slot', name: '__root', state: app }] };
    const decision = detailNavigationDecision(root, { kind: 'artist', id: 'id1' });
    assert.deepEqual(decision, { type: 'pop', action: {
      type: 'POP', target: 'app-stack', source: 'b', payload: { count: 1 },
    } });
  });

  it('never searches inside an unrelated navigator or relies on a partial snapshot', () => {
    const app = stack(home, artist('a', 'id1'), album('b', 'b'));
    for (const value of [undefined, { routes: [] }, { ...app, type: 'tab' }, { ...app, routeNames: ['other'] },
      { type: 'stack', index: 0, key: 'other', routes: [{ key: 'nested', name: 'other', state: app }] },
      { routes: [{ key: 'slot', name: '__root' }], index: 0 }, { ...app, index: -1 }]) {
      assert.equal(detailNavigationDecision(value, { kind: 'artist', id: 'id1' }).type, 'push');
    }
    const arrayId = stack(home, { ...artist('a', 'id1'), params: { id: ['id1'] } }, album('b', 'b'));
    assert.equal(detailNavigationDecision(arrayId, { kind: 'artist', id: 'id1' }).type, 'push');
  });

  it('leaves player, lyrics and queue presentations and their underlying ancestry untouched', () => {
    for (const modal of ['player', 'lyrics', 'queue', 'login']) {
      const initial = stack(home, artist('a', 'id1'), route('modal', modal), album('b', 'b'));
      assert.equal(detailNavigationDecision(initial, { kind: 'artist', id: 'id1' }).type, 'push');
      assert.equal(detailNavigationDecision(stack(home, artist('a', 'id1'), route('modal', modal)),
        { kind: 'artist', id: 'id1' }).type, 'push');
    }
  });

  it('bounds 24 repeated artist→album→same artist loops while retaining the same artist instance', () => {
    const a = artist('artist-a', 'id1');
    const h = harness(stack(home, a));
    for (let iteration = 0; iteration < 24; iteration++) {
      h.advance(100);
      assert.equal(h.open('album', 'album-b'), 'push');
      assert.equal(h.state().routes.length, 3);
      h.advance(100);
      assert.equal(h.open('artist', 'id1'), 'pop');
      assert.equal(h.state().routes.length, 2);
      assert.equal(h.state().routes.at(-1), a);
    }
    assert.equal(h.actions.length, 24);
  });
});
