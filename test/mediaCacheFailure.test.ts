import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeMediaCacheFailure } from '../src/lib/mediaCacheFailure';

test('media failure diagnostics retain a bounded known error chain and numeric bundle locations only', () => {
  const secret = 'https://user:password@example.test/rest/getLyrics?token=private LYRICS TEXT';
  const third = { name: 'SubsonicRequestError', network: true, code: 70, message: secret,
    stack: `SubsonicRequestError: ${secret}\n at work (address at index.android.bundle:1:4567)`, cause: { name: 'TypeError', status: 401 } };
  const second = { name: 'LyricsProviderRequestError', code: 'http', status: 503, retryAfterMs: 1234,
    stack: `LyricsProviderRequestError: ${secret}\n at request (address at index.android.bundle:1:2345)`, cause: third };
  const error = { name: 'LyricsFallbackError', message: secret, stack: `${secret}\n at root (address at index.android.bundle:1:2345)`, cause: second };
  const result = sanitizeMediaCacheFailure({ kind: 'lyrics', id: '17XixQrKxhkI2718bxkleJ' }, error);
  assert.deepEqual(result, { kind: 'lyrics', id: '17XixQrKxhkI2718bxkleJ', errorChain: [
    { name: 'LyricsFallbackError' }, { name: 'LyricsProviderRequestError', code: 'http', status: 503, retryAfterMs: 1234 },
    { name: 'SubsonicRequestError', code: 70, network: true },
  ], locations: [{ line: 1, column: 2345 }, { line: 1, column: 4567 }] });
  for (const forbidden of ['https:', 'password', 'token', 'LYRICS', 'message', 'stack', 'TypeError']) assert.ok(!JSON.stringify(result).includes(forbidden));
});

test('unknown labels, unsafe task IDs and invalid numeric metadata cannot enter media diagnostics', () => {
  const secret = 'https://private.example/token';
  const error: Record<string, unknown> = { name: secret, code: secret, status: 9999, network: 'secret', retryAfterMs: Infinity,
    stack: `raw secret ${secret}\n at index.android.bundle:999999999999999999999:1\n at /private/file.ts:12:123` };
  error.cause = error;
  const result = sanitizeMediaCacheFailure({ kind: 'lyrics', id: secret }, error);
  assert.deepEqual(result, { kind: 'lyrics', id: '[redacted]', errorChain: [{ name: 'UnknownError' }], locations: [] });
  const foreign = Object.defineProperties({}, { name: { get() { throw new Error(secret); } },
    cause: { get() { throw new Error(secret); } }, stack: { get() { throw new Error(secret); } } });
  assert.doesNotThrow(() => sanitizeMediaCacheFailure({ kind: 'albumCovers', id: 'album' }, foreign));
});

test('numeric locations and recognized transport codes remain bounded without copying arbitrary stack frames', () => {
  const error = { name: 'Error', code: 'ETIMEDOUT', status: 504, retryAfterMs: -1,
    stack: Array.from({ length: 50 }, (_, i) => `at work (address at index.android.bundle:1:${i + 1})`).join('\n') };
  const result = sanitizeMediaCacheFailure({ kind: 'artistCovers', id: 'artist' }, error);
  assert.equal(result.locations.length, 8);
  assert.deepEqual(result.errorChain, [{ name: 'Error', code: 'ETIMEDOUT', status: 504 }]);
  assert.ok(result.locations.every((location) => Object.keys(location).join(',') === 'line,column'));
});
