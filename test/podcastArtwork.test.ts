import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports: Record<string, any> = {};
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/podcastArtwork.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, URL, require(name: string) {
  assert.equal(name, '@/api/data'); return { CACHED_COVER: 'cached-cover:' };
} });
const candidates = (channel: object, preferred: string | undefined, offline = false): string[] =>
  Array.from(exports.podcastArtworkCandidates(channel, preferred, offline));

test('online artwork keeps the tapped directory image ahead of publisher and background file candidates', () => {
  const channel = Object.freeze({ imageUrl: 'https://publisher.test/new.jpg', artFile: 'file:///podcasts/cover.jpg' });
  assert.deepEqual(candidates(channel, 'https://apple.test/tapped.jpg'),
    ['https://apple.test/tapped.jpg', channel.imageUrl, channel.artFile]);
  assert.deepEqual(candidates(channel, undefined), [channel.imageUrl, channel.artFile]);
  assert.equal(channel.imageUrl, 'https://publisher.test/new.jpg');
});

test('offline candidates put all local resources first and mark every remote source cache-only', () => {
  const channel = { imageUrl: 'https://publisher.test/show.jpg', artFile: 'file:///podcasts/cover.jpg' };
  assert.deepEqual(candidates(channel, 'https://apple.test/tapped.jpg', true), [channel.artFile,
    'cached-cover:https://apple.test/tapped.jpg', 'cached-cover:https://publisher.test/show.jpg']);
  assert.deepEqual(candidates(channel, 'content://media/external/images/12', true),
    ['content://media/external/images/12', channel.artFile, 'cached-cover:https://publisher.test/show.jpg']);
  const remoteOnly = candidates({ imageUrl: channel.imageUrl }, undefined, true);
  assert.equal(remoteOnly.some((uri) => /^https?:/i.test(uri)), false);
});

test('invalid, credential-bearing, and unsupported artwork cannot become a display or offline-cache request', () => {
  for (const value of ['javascript:alert(1)', 'data:image/png;base64,AA', '/relative.jpg', 'content:/missing-authority', 'file:relative.jpg',
    'https://publisher.test/line\nbreak.jpg',
    'https://user:secret@publisher.test/cover.jpg', 'http://user@publisher.test/cover.jpg',
    'cached-cover:https://user:secret@publisher.test/cover.jpg', 'cached-cover:file:///tmp/cover.jpg']) {
    assert.deepEqual(candidates({ imageUrl: value, artFile: value }, value), [], value);
    assert.deepEqual(candidates({ imageUrl: value, artFile: value }, value, true), [], value);
  }
});

test('candidate deduplication preserves order and never doubles offline markers', () => {
  const uri = 'https://publisher.test/show.jpg';
  assert.deepEqual(candidates({ imageUrl: uri, artFile: 'file:///cover.jpg' }, `  ${uri}  `), [uri, 'file:///cover.jpg']);
  assert.deepEqual(candidates({ imageUrl: uri, artFile: 'file:///cover.jpg' }, 'cached-cover:' + uri, true),
    ['file:///cover.jpg', 'cached-cover:' + uri]);
  assert.deepEqual(candidates({}, undefined), []);
});
