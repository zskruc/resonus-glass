import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveRecommendationQueue } from '../src/lib/recommendationPlayback';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/cachedLyricPlayback.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function harness() {
  let profile = 'A', seek = 0, resolve!: (rows: Map<string, any>) => void;
  const plays: any[] = [];
  const state: any = { queue: [{ id: 'old' }], index: 0,
    playQueue: async (songs: any[], index: number) => { plays.push({ songs, index }); return true; } };
  const imports: Record<string, unknown> = {
    './lyricOwner': { captureLyricOwner: (scope: string) => () => profile === scope },
    './recommendationPlaybackSource': { currentRecommendationSongs: () => new Promise((done) => { resolve = done; }) },
    './recommendationPlayback': { resolveRecommendationQueue }, '@/i18n': { tg: (value: string) => value },
    '@/store/player': { usePlayerStore: { getState: () => state }, playbackUserSeekVersion: () => seek },
  };
  const api: Record<string, any> = {};
  runInNewContext(code, { exports: api, require: (name: string) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { plays, state,
    play: () => api.playCachedLyricResult([{ song: { id: 'one', title: 'One', localUri: 'file:///removed-folder/one.flac' }, excerpt: 'Words' }], 0, 'A'),
    finish: (missing = false) => resolve(missing ? new Map() : new Map([['one', { id: 'one', title: 'One', localUri: 'file:///current-folder/one.flac' }]])),
    profile: () => { profile = 'B'; }, seek: () => { seek++; } };
}
test('lyric result playback uses resolved current paths rather than the index snapshot', async () => {
  const h = harness(), work = h.play(); h.finish(); assert.equal(await work, 'played');
  assert.equal(h.plays[0].songs[0].localUri, 'file:///current-folder/one.flac');
});
test('a removed lyric result does not play an unrelated available result', async () => {
  const h = harness(), work = h.play(); h.finish(true); assert.equal(await work, 'unavailable'); assert.equal(h.plays.length, 0);
});
test('late lyric-result resolution cannot override an account switch, a new queue or a manual seek', async () => {
  for (const change of ['profile', 'queue', 'seek']) {
    const h = harness(), work = h.play();
    if (change === 'profile') h.profile(); else if (change === 'queue') h.state.queue = [{ id: 'new' }]; else h.seek();
    h.finish(); assert.equal(await work, 'superseded', change); assert.equal(h.plays.length, 0, change);
  }
});
