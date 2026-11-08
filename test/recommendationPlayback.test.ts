import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import type { Song } from '../src/api/subsonic';
import { recommendationSong } from '../src/lib/dailyRecommendations';
import { resolveRecommendationQueue } from '../src/lib/recommendationPlayback';
import { createShufflePreference } from '../src/lib/shufflePreference';

test('saved recommendation metadata contains no authenticated cover URLs, local paths or playable stream URLs', () => {
  const saved = recommendationSong({ id: 'one', title: 'One', coverArt: 'https://server.test/cover?u=name&t=secret',
    localUri: 'file:///private/music.mp3', coverBase64: 'cover bytes', comment: 'private notes' });
  const raw = JSON.stringify(saved);
  for (const secret of ['https://', 'secret', 'file://', 'private', 'cover bytes']) assert.equal(raw.includes(secret), false, secret);
  assert.equal(recommendationSong({ id: 'file:///private/music.mp3', title: 'One' }), null);
  assert.equal(recommendationSong({ id: 'one', title: 'One', url: 'https://audio.test/private' }), null);
});

test('recommendation playback uses current resolved IDs and paths, retaining shown order after missing entries are removed', async () => {
  const saved = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];
  const fresh = new Map<string, Song>([['a', { id: 'a', title: 'Updated A', localUri: 'file:///current/a.mp3' }], ['c', { id: 'c', title: 'C' }]]);
  const result = await resolveRecommendationQueue(saved, 2, async () => fresh, () => true);
  assert.deepEqual(result, { songs: [fresh.get('a'), fresh.get('c')], index: 1 });
  assert.equal(await resolveRecommendationQueue(saved, 1, async () => fresh, () => true), null,
    'a removed requested track must not start another song');
});

test('a profile or newer-play intent invalidating a lookup never starts a stale recommendation queue', async () => {
  let current = true, release!: (value: Map<string, Song>) => void;
  const work = resolveRecommendationQueue([{ id: 'a', title: 'A' }], 0,
    () => new Promise((done) => { release = done; }), () => current);
  current = false; release(new Map([['a', { id: 'a', title: 'A' }]]));
  assert.equal(await work, null);
});

test('importing shuffle preferences and reading before initialization does not touch the auth cycle', () => {
  const imports: Record<string, unknown> = {
    zustand: { create: (make: () => unknown) => ({ getState: make, setState() {} }) },
    '@/lib/localLibrary': { hashKey: (key: string) => key, folderSetKey: (uris: string[]) => uris.join('|') },
    '@/lib/shufflePreference': { createShufflePreference },
    '@/lib/storage': { getItem() { throw Error('eager storage read'); }, setItemStrict() { throw Error('eager write'); } },
    './auth': { profileScopeId() { throw Error('eager profile read'); }, useAuthStore: {
      getState() { throw Error('eager auth read'); }, subscribe() { throw Error('eager auth subscription'); },
    } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/shufflePreferences.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(id: string) { assert.ok(Object.hasOwn(imports, id), id); return imports[id]; } });
  assert.equal(exports.getShuffleMode(), 'uniform');
});
