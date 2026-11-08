import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as types from '../src/lib/mediaCacheTypes';

/** Execute the real production connection factory: the option must apply to
 * the shared cache and therefore the SDK's inherited exclusive connections. */
test('every media-cache connection disables Expo sweeping FTS-owned statements, including reopen after profile deletion', async () => {
  const opened: { name: string; options: Record<string, unknown>; closed: number }[] = [];
  const dependencies: Record<string, unknown> = {
    'expo-file-system/legacy': { documentDirectory: 'file:///private/', makeDirectoryAsync: async () => {} },
    'expo-sqlite': { openDatabaseAsync: async (name: string, options: Record<string, unknown>) => {
      const entry = { name, options, closed: 0 }; opened.push(entry);
      return { execAsync: async () => {}, closeAsync: async () => { entry.closed++; } };
    } },
    './localLibrary': { hashKey: (value: string) => value }, './serverUrls': {}, './mediaCacheTypes': types,
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/mediaCacheDb.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  assert.equal(await exports.mediaCacheDatabase('A'), await exports.mediaCacheDatabase('A'));
  await exports.mediaCacheDatabase('B');
  await exports.closeMediaCacheFor('A'); await exports.closeMediaCacheFor('A');
  await exports.mediaCacheDatabase('A');
  assert.equal(opened.length, 3); assert.deepEqual(opened.map((entry) => entry.closed), [1, 0, 0]);
  for (const entry of opened) assert.equal(entry.options.finalizeUnusedStatementsBeforeClosing, false);
});
