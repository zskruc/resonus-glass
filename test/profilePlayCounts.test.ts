import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanPlayCounts, createProfilePlayCounts, MAX_LOCAL_PLAY_COUNTS } from '../src/lib/profilePlayCounts';

const legacy = 'resonus.localPlayCounts';
function harness(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial)); let profile = 'a';
  let snapshot: Record<string, number> = {}, hydrated = false;
  let fail = false;
  const writes: string[] = [];
  let read = async (key: string) => disk.get(key) ?? null;
  const counts = createProfilePlayCounts({
    read: (key) => read(key), currentProfile: () => profile, delay: 60_000,
    write: async (key, value) => { if (fail) throw new Error('KeyStore unavailable'); disk.set(key, value); writes.push(key); },
    publish: (next, ready) => { snapshot = next; hydrated = ready; },
  });
  return { disk, counts, writes, snapshot: () => snapshot, hydrated: () => hydrated,
    switchTo: (scope: string) => { profile = scope; return counts.hydrate(scope); },
    fail: (value: boolean) => { fail = value; }, read: (value: typeof read) => { read = value; } };
}

test('shared old counts migrate to exactly one real profile and remain recoverable', async () => {
  const h = harness({ [legacy]: '{"song":7}' });
  await h.switchTo('default'); assert.deepEqual(h.snapshot(), {});
  assert.equal(h.disk.has(`${legacy}.migrationOwner`), false);
  await h.switchTo('a'); assert.deepEqual(h.snapshot(), { song: 7 });
  assert.equal(h.disk.get(legacy), '{"song":7}');
  await h.switchTo('b'); assert.deepEqual(h.snapshot(), {});
  h.counts.bump('b', 'song'); await h.counts.flush();
  await h.switchTo('a'); assert.deepEqual(h.snapshot(), { song: 7 });
  assert.equal(h.disk.get(`${legacy}.b`), '{"song":1}');
});

test('a profile change flushes the captured owner and never files it under the new account', async () => {
  const h = harness(); await h.switchTo('a');
  h.counts.bump('a', 'same-id');
  await h.switchTo('b'); h.counts.bump('a', 'late-a'); h.counts.bump('b', 'b-only');
  await h.counts.flush(); await h.switchTo('a');
  assert.deepEqual(h.snapshot(), { 'same-id': 1 });
  assert.equal(h.disk.get(`${legacy}.b`), '{"b-only":1}');
});

test('an overtaken hydration cannot publish or claim the shared legacy record', async () => {
  const h = harness({ [legacy]: '{"old":3}' });
  let release!: (value: string | null) => void;
  h.read(async (key) => key === `${legacy}.a` ? new Promise((yes) => { release = yes; }) : h.disk.get(key) ?? null);
  const a = h.switchTo('a');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const b = h.switchTo('b'); release(null); await Promise.all([a, b]);
  assert.deepEqual(h.snapshot(), { old: 3 }); assert.equal(h.disk.get(`${legacy}.migrationOwner`), 'b');
});

test('strict migration failure preserves the original and can be retried', async () => {
  const h = harness({ [legacy]: '{"old":9}' }); h.fail(true);
  await h.switchTo('a'); h.counts.bump('a', 'fresh'); await h.counts.flush();
  assert.equal(h.disk.get(legacy), '{"old":9}'); assert.equal(h.disk.has(`${legacy}.a`), false);
  h.fail(false); await h.switchTo('a'); assert.deepEqual(h.snapshot(), { old: 9 });
});

test('failed saves retain a dirty account snapshot across switching away and back', async () => {
  const h = harness(); await h.switchTo('a'); h.fail(true);
  h.counts.bump('a', 'played'); await h.counts.flush(); await h.switchTo('b'); await h.switchTo('a');
  assert.deepEqual(h.snapshot(), { played: 1 }); h.fail(false); await h.counts.flush();
  assert.equal(h.disk.get(`${legacy}.a`), '{"played":1}');
});

test('malformed counts are rejected and the bound retains far more than the old top-300', () => {
  assert.deepEqual(cleanPlayCounts(JSON.parse('{"bad":-1,"fraction":1.2,"text":"3","__proto__":4,"good":8}')), { good: 8 });
  const history = Object.fromEntries(Array.from({ length: MAX_LOCAL_PLAY_COUNTS + 25 }, (_, i) => [`s${i}`, i + 1]));
  const cleaned = cleanPlayCounts(history);
  assert.equal(Object.keys(cleaned).length, MAX_LOCAL_PLAY_COUNTS);
  assert.equal(cleaned[`s${MAX_LOCAL_PLAY_COUNTS + 24}`], MAX_LOCAL_PLAY_COUNTS + 25);
  assert.equal(Object.keys(cleanPlayCounts(Object.fromEntries(Array.from({ length: 2362 }, (_, i) => [`s${i}`, 1])))).length, 2362);
});

test('background-style flush includes a play that arrives while hydration is pending', async () => {
  const h = harness({ [`${legacy}.a`]: '{"same":2}' });
  const ready = h.switchTo('a'); h.counts.bump('a', 'same'); await ready; await h.counts.flush();
  assert.deepEqual(h.snapshot(), { same: 3 }); assert.equal(h.hydrated(), true);
});

test('an old failed flush cannot requeue stale counts after a newer flush was dequeued', async () => {
  let current: Record<string, number> = {};
  const disk = new Map<string, string>();
  let rejectFirst!: (error: Error) => void;
  let entered!: () => void;
  const started = new Promise<void>((yes) => { entered = yes; });
  let writes = 0;
  const store = createProfilePlayCounts({ currentProfile: () => 'a', delay: 60_000,
    read: async (key) => disk.get(key) ?? null,
    publish: (counts) => { current = counts; },
    write: async (key, value) => {
      if (++writes === 1) { entered(); await new Promise<void>((_yes, no) => { rejectFirst = no; }); }
      disk.set(key, value);
    },
  });
  await store.hydrate('a'); store.bump('a', 'song'); const older = store.flush();
  await started; store.bump('a', 'song'); const newer = store.flush();
  rejectFirst(new Error('temporary storage failure')); await Promise.all([older, newer]);
  assert.deepEqual(current, { song: 2 });
  assert.equal(disk.get(`${legacy}.a`), '{"song":2}');
  await store.flush(); assert.equal(disk.get(`${legacy}.a`), '{"song":2}');
});
