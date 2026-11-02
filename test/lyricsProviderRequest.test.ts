import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLyricsProviderRequest, LyricsProviderRequestError,
  type LyricsProviderResponse } from '../src/lib/lyricsProviderRequest';

const tick = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function clock() {
  let value = Date.UTC(2026, 10, 2);
  const timers: { at: number; resolve: () => void }[] = [];
  const now = () => value;
  const wait = (ms: number) => new Promise<void>((resolve) => { timers.push({ at: value + ms, resolve }); });
  const advance = async (ms: number) => {
    value += ms;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= value) timers.splice(i, 1)[0].resolve();
    await tick();
  };
  async function drive<T>(work: Promise<T>): Promise<T> {
    let done = false, failed = false, result: T, error: unknown;
    void work.then((next) => { result = next; done = true; }, (cause) => { error = cause; failed = true; done = true; });
    for (let i = 0; i < 1000; i++) {
      await tick();
      if (done) { if (failed) throw error; return result!; }
      assert.ok(timers.length, 'pending work must have a bounded wake-up');
      await advance(Math.max(0, Math.min(...timers.map((timer) => timer.at)) - value));
    }
    throw new Error('test clock did not settle');
  }
  return { now, wait, advance, drive };
}
function response(status: number, data: unknown, headers: Record<string, string> = {}, body?: () => Promise<string>): LyricsProviderResponse {
  return { status, headers: { get: (name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null },
    text: body ?? (async () => typeof data === 'string' ? data : JSON.stringify(data)) };
}

test('one provider queue holds its slot through complete body parsing and spaces subsequent dispatches', async () => {
  const time = clock(), body = deferred<string>(), starts: number[] = [];
  let active = 0, peak = 0;
  const client = createLyricsProviderRequest({ ...time, random: () => 0,
    fetch: async () => {
      starts.push(time.now()); peak = Math.max(peak, ++active);
      const first = starts.length === 1;
      return response(200, null, {}, async () => {
        const text = first ? await body.promise : '{"id":2}'; active--; return text;
      });
    } });
  const first = client.requestJson('https://provider.test/first');
  const second = client.requestJson('https://provider.test/second');
  await tick(); assert.equal(starts.length, 1);
  await time.advance(1200); assert.equal(starts.length, 1, 'headers alone do not release the slot');
  const completedAt = time.now(); body.resolve('{"id":1}');
  const results = await time.drive(Promise.all([first, second]));
  assert.deepEqual(results.map((result) => result.data), [{ id: 1 }, { id: 2 }]);
  assert.equal(peak, 1); assert.ok(starts[1] - starts[0] >= 700);
  assert.ok(starts[1] - completedAt >= 250);
});

test('503 retries only after Retry-After seconds and preserves the same single slot', async () => {
  const time = clock(), starts: number[] = [];
  const client = createLyricsProviderRequest({ ...time, random: () => 0,
    fetch: async () => {
      starts.push(time.now()); return starts.length === 1
        ? response(503, { name: 'ServerOverloaded' }, { 'Retry-After': '2' }) : response(200, { id: 1 });
    } });
  const result = await time.drive(client.requestJson('https://provider.test/get'));
  assert.equal(result.status, 200); assert.equal(starts.length, 2); assert.ok(starts[1] - starts[0] >= 2000);
});

test('429 non-JSON responses honor HTTP-date Retry-After plus positive jitter', async () => {
  const time = clock(), starts: number[] = [], retryAt = new Date(time.now() + 2000).toUTCString();
  const client = createLyricsProviderRequest({ ...time, random: () => 1,
    fetch: async () => {
      starts.push(time.now()); return starts.length === 1
        ? response(429, '<html>temporarily limited</html>', { 'Retry-After': retryAt, 'Content-Type': 'text/html' })
        : response(200, []);
    } });
  assert.equal((await time.drive(client.requestJson('https://provider.test/search'))).ok, true);
  assert.equal(starts.length, 2); assert.ok(starts[1] - starts[0] >= 2600);
});

test('404 and ordinary validation/authentication responses do not retry, even with non-JSON error bodies', async () => {
  for (const status of [400, 401, 403, 404]) {
    const time = clock(); let calls = 0;
    const client = createLyricsProviderRequest({ ...time, fetch: async () => { calls++; return response(status, 'not JSON'); } });
    const result = await time.drive(client.requestJson('https://provider.test/get'));
    assert.equal(result.status, status); assert.equal(result.ok, false); assert.equal(result.data, null);
    assert.equal(calls, 1);
  }
});

test('successful malformed JSON is a visible semantic failure rather than an empty successful result', async () => {
  const time = clock(); let calls = 0;
  const client = createLyricsProviderRequest({ ...time, fetch: async () => { calls++; return response(200, '<html>bad</html>'); } });
  await assert.rejects(time.drive(client.requestJson('https://provider.test/get')),
    (error: unknown) => error instanceof LyricsProviderRequestError && error.code === 'invalid-json' && !error.retryable);
  assert.equal(calls, 1);
});

test('a cancelled queued caller cannot dispatch or unlock its active predecessor', async () => {
  const time = clock(), body = deferred<string>(); let calls = 0, current = true;
  const client = createLyricsProviderRequest({ ...time, fetch: async () => {
    calls++; return calls === 1 ? response(200, null, {}, () => body.promise) : response(200, { id: 3 });
  } });
  const first = client.requestJson('https://provider.test/first');
  const cancelled = client.requestJson('https://provider.test/cancelled', { stillCurrent: () => current });
  const third = client.requestJson('https://provider.test/third');
  await tick(); current = false;
  await assert.rejects(time.drive(cancelled), (error: unknown) => error instanceof LyricsProviderRequestError && error.code === 'stopped');
  assert.equal(calls, 1);
  body.resolve('{"id":1}'); await time.drive(Promise.all([first, third]));
  assert.equal(calls, 2);
});

test('cancelling during backoff retains a shared cooldown for later tasks', async () => {
  const time = clock(), starts: number[] = []; let current = true;
  const client = createLyricsProviderRequest({ ...time, random: () => 0, fetch: async () => {
    starts.push(time.now()); return starts.length === 1 ? response(503, {}, { 'Retry-After': '10' }) : response(200, []);
  } });
  const stopped = client.requestJson('https://provider.test/first', { stillCurrent: () => current });
  await tick(); assert.equal(starts.length, 1); current = false;
  await assert.rejects(time.drive(stopped), (error: unknown) => error instanceof LyricsProviderRequestError && error.code === 'stopped');
  await time.drive(client.requestJson('https://provider.test/next'));
  assert.equal(starts.length, 2); assert.ok(starts[1] - starts[0] >= 10_000);
});

test('long Retry-After fails within the request budget but no later task may bypass the global cooldown', async () => {
  const time = clock(), starts: number[] = [];
  const client = createLyricsProviderRequest({ ...time, random: () => 0, fetch: async () => {
    starts.push(time.now()); return starts.length === 1 ? response(429, {}, { 'Retry-After': '120' }) : response(200, []);
  } });
  const limited = (error: unknown) => error instanceof LyricsProviderRequestError && error.code === 'cooldown'
    && error.status === 429 && error.retryable && error.retryAfterMs! >= 120_000;
  await assert.rejects(time.drive(client.requestJson('https://provider.test/first')), limited);
  await assert.rejects(time.drive(client.requestJson('https://provider.test/next')), limited);
  assert.equal(starts.length, 1);
  await time.advance(120_000); await time.drive(client.requestJson('https://provider.test/after'));
  assert.equal(starts.length, 2);
});

test('queue and spacing time do not consume a request deadline before dispatch', async () => {
  const time = clock(), starts: number[] = [];
  const client = createLyricsProviderRequest({ ...time, deadlineMs: 1000, maxAttempts: 1, fetch: async () => {
    starts.push(time.now()); const delay = starts.length === 1 ? 900 : 700;
    return response(200, null, {}, async () => { await time.wait(delay); return '{"ok":true}'; });
  } });
  const first = client.requestJson('https://provider.test/first'), second = client.requestJson('https://provider.test/second');
  const result = await time.drive(Promise.all([first, second]));
  assert.ok(result.every((entry) => entry.ok)); assert.ok(starts[1] - starts[0] >= 1150);
});

test('a hung response body times out, aborts the attempt, and frees the logical queue', async () => {
  const time = clock(); let calls = 0, aborted = false;
  const client = createLyricsProviderRequest({ ...time, deadlineMs: 1000, maxAttempts: 1, random: () => 0,
    fetch: async (_url, options) => {
      calls++; options.signal?.addEventListener('abort', () => { aborted = true; });
      return calls === 1 ? response(200, null, {}, () => new Promise(() => {})) : response(200, []);
    } });
  await assert.rejects(time.drive(client.requestJson('https://provider.test/hung')),
    (error: unknown) => error instanceof LyricsProviderRequestError && error.code === 'timeout' && error.retryable);
  assert.equal(aborted, true); assert.equal(calls, 1);
  assert.equal((await time.drive(client.requestJson('https://provider.test/next'))).status, 200);
  assert.equal(calls, 2);
});

test('transient HTTP and transport failures have a strict three-attempt budget', async () => {
  for (const status of [500, 502, 503, 504, undefined]) {
    const time = clock(); let calls = 0;
    const client = createLyricsProviderRequest({ ...time, random: () => 0, fetch: async () => {
      calls++; if (status === undefined) throw new Error('temporary network failure');
      return response(status, 'upstream failed');
    } });
    await assert.rejects(time.drive(client.requestJson('https://provider.test/get')),
      (error: unknown) => error instanceof LyricsProviderRequestError && error.retryable && error.status === status);
    assert.equal(calls, 3);
  }
});

test('a Retry-After seen in headers survives cancellation while its error body is still pending', async () => {
  const time = clock(), body = deferred<string>(), starts: number[] = []; let current = true;
  const client = createLyricsProviderRequest({ ...time, random: () => 0, fetch: async () => {
    starts.push(time.now()); return starts.length === 1
      ? response(503, null, { 'Retry-After': '10' }, () => body.promise) : response(200, []);
  } });
  const first = client.requestJson('https://provider.test/first', { stillCurrent: () => current });
  await tick(); current = false;
  await assert.rejects(time.drive(first), (error: unknown) => error instanceof LyricsProviderRequestError && error.code === 'stopped');
  await time.drive(client.requestJson('https://provider.test/next'));
  assert.equal(starts.length, 2); assert.ok(starts[1] - starts[0] >= 10_000);
  body.resolve('overloaded'); await tick();
});

test('aborting a body read is noticed promptly and a late response cannot parse or publish a result', async () => {
  const time = clock(), body = deferred<string>(), control = new AbortController();
  let calls = 0, aborted = false;
  const client = createLyricsProviderRequest({ ...time, fetch: async (_url, options) => {
    calls++; options.signal?.addEventListener('abort', () => { aborted = true; });
    return response(200, null, {}, () => body.promise);
  } });
  const work = client.requestJson('https://provider.test/get', { signal: control.signal });
  await tick(); control.abort();
  await assert.rejects(time.drive(work), (error: unknown) => error instanceof LyricsProviderRequestError && error.code === 'stopped');
  assert.equal(aborted, true); assert.equal(calls, 1);
  body.resolve('{"id":1}'); await tick(); assert.equal(calls, 1);
});
