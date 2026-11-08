import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlayerRevealGuard } from '@/lib/playerRevealOwner';

test('a cancelled pull closes only the player opened by that pull', () => {
  const guard = createPlayerRevealGuard(), route = {};
  const request = guard.begin();
  guard.focus(route, request);
  assert.equal(guard.cancel(request), 'close');
  assert.equal(guard.owns(request), false);
  assert.equal(guard.cancel(request), 'ignore');
});

test('release before navigation commits resets the offset and rejects the late reveal', () => {
  const guard = createPlayerRevealGuard(), route = {};
  const request = guard.begin();
  assert.equal(guard.cancel(request), 'reset');
  guard.focus(route, request);
  assert.equal(guard.owns(request), false);
  assert.equal(guard.isFocused(route), true);
});

test('a stale pull completion cannot close a newer player or reset its offset', () => {
  const guard = createPlayerRevealGuard(), first = {}, second = {};
  const oldRequest = guard.begin(); guard.focus(first, oldRequest);
  const newRequest = guard.begin(); guard.focus(second, newRequest);
  guard.blur(first);
  assert.equal(guard.cancel(oldRequest), 'ignore');
  assert.equal(guard.isFocused(second), true);
  assert.equal(guard.owns(newRequest), true);
  assert.equal(guard.cancel(newRequest), 'close');
});

test('another screen taking focus cannot be popped by the player pull', () => {
  const guard = createPlayerRevealGuard(), route = {};
  const request = guard.begin(); guard.focus(route, request); guard.blur(route);
  assert.equal(guard.cancel(request), 'reset');
});

test('a normal player tap invalidates a previous pending pull', () => {
  const guard = createPlayerRevealGuard();
  const request = guard.begin(); guard.focus({}, null);
  assert.equal(guard.cancel(request), 'ignore');
  assert.equal(guard.owns(request), false);
});
