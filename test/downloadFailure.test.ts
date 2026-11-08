import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDownloadFailureReporter } from '../src/lib/downloadFailure';

test('download diagnostics keep the actual reason and quality without request credentials', () => {
  const events: string[] = [], report = createDownloadFailureReporter((message) => events.push(message));
  report({ suffix: 'flac' }, new Error('HTTP 403 https://user:secret@server/rest/download?u=name&t=hash&s=salt'), { ext: 'opus', bitRate: 128 });
  assert.deepEqual(events, ['download failed: HTTP 403 (flac as opus 128k)']);
});
test('unknown native errors omit explicit secrets, local URLs, and multiline bodies', () => {
  const events: string[] = [], report = createDownloadFailureReporter((message) => events.push(message));
  report({ suffix: 'm4a' }, { message: "token=verysecret password:'other secret' Authorization: Bearer secret\nfile:///private/account/song.m4a content://private/document" });
  assert.equal(events.length, 1);
  assert.doesNotMatch(events[0], /verysecret|other secret|Bearer secret|private|\n/);
  assert.equal(events[0], 'download failed: native transfer or file operation failed (m4a)');
});
test('quoted JSON, bare Subsonic arguments and header secrets never reach Diagnostics', () => {
  const events: string[] = [], report = createDownloadFailureReporter((message) => events.push(message));
  for (const message of [
    'native failure {"token":"VERY_SECRET_TOKEN","username":"PRIVATE_USER","password":"PRIVATE_PASS"}',
    'server returned u=PRIVATE_USER&p=PRIVATE_PASS&t=VERY_SECRET_TOKEN&s=PRIVATE_SALT',
    'X-Emby-Token: VERY_SECRET_TOKEN api-token=PRIVATE_TOKEN',
  ]) report({ suffix: 'flac' }, new Error(message));
  assert.equal(events.length, 3);
  assert.ok(events.every((message) => message === 'download failed: native transfer or file operation failed (flac)'));
});
test('recognized native IO and network errors keep actionable categories without their private context', () => {
  const cases = [
    ['ENOSPC /data/private/song.flac', 'device storage full'],
    ['EACCES /storage/secret/song.flac', 'file permission denied'],
    ['ENOENT file:///private/song.flac', 'local file missing'],
    ['java.net.SocketTimeoutException: token=secret', 'network timeout'],
    ['Unable to resolve host private.example.test', 'DNS lookup failed'],
    ['SSLHandshake certificate failed for https://secret:pass@host', 'secure connection failed'],
  ];
  for (const [message, expected] of cases) {
    const events: string[] = [];
    createDownloadFailureReporter((entry) => events.push(entry))({ suffix: 'mp3' }, new Error(message));
    assert.deepEqual(events, [`download failed: ${expected} (mp3)`]);
  }
});
test('a large failed batch cannot evict all other diagnostics; a new batch gets its own budget', () => {
  const events: string[] = [], report = createDownloadFailureReporter((message) => events.push(message));
  for (let i = 0; i < 100; i++) report({ suffix: 'mp3' }, new Error(`HTTP ${400 + i}`));
  assert.equal(events.length, 3);
  createDownloadFailureReporter((message) => events.push(message))({ suffix: 'mp3' }, new Error('incomplete audio file'));
  assert.equal(events.length, 4);
  assert.match(events[3], /incomplete audio file/);
});
test('diagnostics never throw into download cleanup even with an unusable native error or sink', () => {
  const report = createDownloadFailureReporter(() => { throw new Error('sink failed'); });
  assert.doesNotThrow(() => report({ suffix: 'mp3' }, new Error('HTTP 500')));
  assert.doesNotThrow(() => report({ suffix: 'mp3' }, { get message() { throw new Error('native exception'); } }));
});
