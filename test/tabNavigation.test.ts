import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getActiveTabJumpAction } from '@/lib/tabNavigation';

const tabs = {
  type: 'tab', key: 'main-tabs', index: 0,
  routes: [{ name: 'index' }, { name: 'explore' }, { name: 'library' }, { name: 'search' }],
};

describe('direct tab navigation', () => {
  it('targets the mounted navigator below the active root route', () => {
    const root = { type: 'stack', index: 0, routes: [{ name: '(tabs)', state: tabs }] };
    assert.deepEqual(getActiveTabJumpAction(root, 'library'), {
      type: 'JUMP_TO', target: 'main-tabs', payload: { name: 'library' },
    });
    assert.equal(getActiveTabJumpAction(root, 'search')?.target, 'main-tabs');
  });

  it('does not jump into tabs hidden below an artist or album stack', () => {
    const root = { type: 'stack', index: 1, routes: [
      { name: '(tabs)', state: tabs }, { name: 'artist/[id]' },
    ] };
    assert.equal(getActiveTabJumpAction(root, 'library'), null);
  });

  it('preserves destination route parameters when jumping directly', () => {
    const params = { filter: 'downloaded', query: 'live' };
    const state = { ...tabs, routes: [{ name: 'index' }, { name: 'library', params }] };
    const action = getActiveTabJumpAction(state, 'library');
    assert.deepEqual(action?.payload, { name: 'library', params });
    assert.equal(action?.payload.params, params);
  });

  it('ignores inactive nested navigator branches', () => {
    const root = { type: 'stack', index: 1, routes: [
      { name: 'old', state: tabs },
      { name: 'current', state: { type: 'stack', index: 0, routes: [{ name: 'album/[id]' }] } },
    ] };
    assert.equal(getActiveTabJumpAction(root, 'index'), null);
  });

  it('does not descend past an unrelated active tab navigator', () => {
    const state = { type: 'tab', key: 'other-tabs', index: 0, routes: [{ name: 'other', state: tabs }] };
    assert.equal(getActiveTabJumpAction(state, 'library'), null);
  });

  it('falls back when the requested route or navigator target is unavailable', () => {
    assert.equal(getActiveTabJumpAction(tabs, 'options'), null);
    assert.equal(getActiveTabJumpAction({ ...tabs, key: '' }, 'index'), null);
    assert.equal(getActiveTabJumpAction({ ...tabs, key: undefined }, 'index'), null);
  });

  it('handles unready and malformed navigation states without dispatching', () => {
    for (const state of [null, undefined, {}, { routes: [] },
      { routes: [{ state: tabs }], index: -1 },
      { routes: [{ state: tabs }], index: 0.5 },
      { routes: [{ state: tabs }], index: 2 }]) {
      assert.equal(getActiveTabJumpAction(state, 'index'), null);
    }
  });
});
