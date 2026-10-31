import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { resolveArtworkLocalUri } from '../modules/amll-background/artworkSource';
import { appleArtworkAssetKey } from '../src/lib/appleArtistArtwork';
import * as fingerprints from '../src/lib/artistPhotoFingerprint';

const asset = '6d67888b-9e7f-53af-7853-0f91d6fd2332';
const candidate = { uri: `https://is1-ssl.mzstatic.com/image/thumb/artist/${asset}/600x600bb.jpg`, assetKey: asset, width: 600, height: 600 };
const fingerprint = Array.from({ length: 256 }, (_, i) => [20 + i % 16 * 11, 20 + Math.floor(i / 16) * 11, 80]
  .map((value) => value.toString(16).padStart(2, '0')).join('')).join('');

function harness() {
  const paths = new Map<string, string>(); const prefetches: string[] = [];
  const preparations: unknown[][] = []; let result = fingerprint; let wait: Promise<void> | undefined;
  const exports: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    'expo-image': { Image: {
      async getCachePathAsync(uri: string) { await wait; return paths.get(uri) ?? null; },
      async prefetch(uri: string) { prefetches.push(uri); paths.set(uri, '/cache/candidate.jpg'); return true; },
    } },
    '@/api/data': { CACHED_COVER: 'cached-cover:' },
    '@/lib/appleArtistArtwork': { appleArtworkAssetKey },
    '@/lib/artistPhotoFingerprint': fingerprints,
    '../../modules/amll-background/artistArtwork': { async prepareArtistArtwork(...args: unknown[]) {
      preparations.push(args); return { sourceFingerprint: result };
    } },
    '../../modules/amll-background/artworkSource': { resolveArtworkLocalUri },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/verifyAppleArtistPhoto.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { paths, prefetches, preparations, run: exports.verifyAppleArtistPhoto,
    different() { result = fingerprint.match(/.{6}/g)!.reverse().join(''); },
    delay(promise: Promise<void>) { wait = promise; } };
}

it('photo verification uses only local native input with the same raw fingerprint geometry and rejects different content', async () => {
  const h = harness();
  assert.equal(await h.run(candidate, fingerprint, () => true), true);
  assert.deepEqual(h.prefetches, [candidate.uri]);
  assert.deepEqual(h.preparations[0], ['file:///cache/candidate.jpg', 1, 0]);
  h.different(); assert.equal(await h.run(candidate, fingerprint, () => true), false);
  assert.equal(h.prefetches.length, 1, 'verified CDN image bytes are shared with Expo cache');
});

it('cancelled/offline policy, wrong assets and oversized candidates never initiate new photo downloads', async () => {
  const h = harness();
  assert.equal(await h.run(candidate, fingerprint, () => false), false);
  assert.equal(await h.run({ ...candidate, assetKey: 'other' }, fingerprint, () => true), false);
  assert.equal(await h.run({ ...candidate, width: 1200 }, fingerprint, () => true), false);
  assert.equal(h.prefetches.length, 0);
  let release!: () => void; let allowed = true;
  h.delay(new Promise<void>((resolve) => { release = resolve; }));
  const pending = h.run(candidate, fingerprint, () => allowed); allowed = false; release();
  assert.equal(await pending, false); assert.equal(h.prefetches.length, 0); assert.equal(h.preparations.length, 0);
});
