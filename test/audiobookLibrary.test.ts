import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { isAudiobookAlbum, isAudiobookGenre } from '../src/lib/audiobook';
import type { Album } from '../src/api/subsonic';

function library(read: (genre: string, offset: number) => Promise<Album[]>) {
  let scope = 'A', offline = false;
  const imports: Record<string, unknown> = {
    '@/api/data': { getAllAlbums: async () => [], getGenres: async () => [{ value: 'Audiobook' }, { value: 'Hörbuch' }],
      getAlbumsByGenre: (genre: string, size: number, offset: number) => { assert.equal(size, 200); return read(genre, offset); } },
    './audiobook': { isAudiobookAlbum, isAudiobookGenre },
    '@/store/auth': { profileScopeId: () => scope, useAuthStore: { getState: () => ({ offline }) } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/audiobookLibrary.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(name: string) { const customization = defaultCustomizationBoundary(name); if (customization) return customization; assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { load: () => exports.getAudiobookAlbums() as Promise<Album[]>, profile: () => { scope = 'B'; } };
}

test('overlapping genres still fetch their later pages and deduplicate the complete shelf', async () => {
  const first = Array.from({ length: 200 }, (_, index) => ({ id: String(index), name: String(index) }));
  const calls: string[] = [];
  const h = library(async (genre, offset) => { calls.push(`${genre}:${offset}`); return offset === 0 ? first : [{ id: genre, name: genre }]; });
  const albums = await h.load();
  assert.equal(albums.length, 202);
  assert.equal(calls.length, 4);
  assert.ok(calls.includes('Hörbuch:200'), 'global duplicate removal cannot end genre pagination');
});
test('a server repeating a full page is bounded and a failed request is not an empty successful shelf', async () => {
  let calls = 0;
  const first = Array.from({ length: 200 }, (_, index) => ({ id: String(index), name: String(index) }));
  const h = library(async () => { calls++; return first; });
  assert.equal((await h.load()).length, 200); assert.equal(calls, 4);
  await assert.rejects(library(async () => { throw new Error('network'); }).load(), /network/);
});
test('a response from a departed profile cannot publish albums or request its next page', async () => {
  let calls = 0;
  const h = library(async () => { calls++; h.profile(); return []; });
  await assert.rejects(h.load(), /profile changed/); assert.ok(calls <= 2);
});
import { defaultCustomizationBoundary } from './helpers/defaultCustomizationBoundary';
