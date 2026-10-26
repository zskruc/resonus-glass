import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCoverPathCache } from '../src/lib/coverPathCache';

test('album rows coalesce one pending native artwork lookup', async () => {
  let calls = 0;
  let complete!: (path: string) => void;
  const read = createCoverPathCache(async () => {
    calls++;
    return new Promise<string>((resolve) => { complete = resolve; });
  });
  const requests = Array.from({ length: 50 }, () => read('album'));
  await Promise.resolve();
  assert.equal(calls, 1);
  complete('file://album');
  assert.deepEqual(await Promise.all(requests), Array(50).fill('file://album'));
});

test('scrolling through thousands of covers retains only the recent lookup window', async () => {
  const calls: string[] = [];
  const read = createCoverPathCache(async (url) => {
    calls.push(url);
    return `file://${url}`;
  }, { capacity: 32 });
  for (let i = 0; i < 3000; i++) await read(String(i));
  await read('2999');
  assert.equal(calls.length, 3000);
  await read('0');
  assert.equal(calls.length, 3001);
});

test('cache hits promote recent artwork rather than evicting it by original insertion', async () => {
  const calls: string[] = [];
  const read = createCoverPathCache(async (url) => {
    calls.push(url);
    return url;
  }, { capacity: 2 });
  await read('a'); await read('b'); await read('a'); await read('c'); await read('a');
  assert.deepEqual(calls, ['a', 'b', 'c']);
  await read('b');
  assert.deepEqual(calls, ['a', 'b', 'c', 'b']);
});

test('an offline miss expires so artwork saved later can appear', async () => {
  let time = 0;
  let available = false;
  let calls = 0;
  const read = createCoverPathCache(async () => {
    calls++;
    return available ? 'file://saved' : undefined;
  }, { now: () => time });
  assert.equal(await read('album'), undefined);
  available = true;
  time = 59_999;
  assert.equal(await read('album'), undefined);
  assert.equal(calls, 1);
  time = 60_000;
  assert.equal(await read('album'), 'file://saved');
  assert.equal(calls, 2);
});

test('a failed native probe releases its pending request and stays retryable', async () => {
  let calls = 0;
  const read = createCoverPathCache(async () => {
    if (++calls === 1) throw new Error('cache unavailable');
    return 'file://restored';
  });
  await assert.rejects(read('album'));
  assert.equal(await read('album'), 'file://restored');
  assert.equal(calls, 2);
});
