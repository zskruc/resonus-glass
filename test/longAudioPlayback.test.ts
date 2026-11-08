import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/hooks/useLongAudioPlayback.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function harness() {
  let scope = 'A', seekVersion = 0, accepted = true, resolve!: (value: boolean) => void, fetched!: (song: any) => void;
  const seeks: number[] = [];
  const state = { queue: [{ id: 'old', title: 'Old' }], index: 0, isPlaying: true,
    seekTo: (position: number) => seeks.push(position), toggle: () => { state.isPlaying = !state.isPlaying; },
    playQueue: (queue: any[]) => { state.queue = queue; state.index = 0; return new Promise<boolean>((done) => { resolve = done; }); } };
  const api: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    '@/api/data': { getSong: () => new Promise((done) => { fetched = done; }) },
    '@/store/player': { currentSong: (value: typeof state) => value.queue[value.index], playbackUserSeekVersion: () => seekVersion,
      longAudioPlaybackSample: () => accepted ? { song: state.queue[state.index], scope } : undefined,
      usePlayerStore: { getState: () => state } },
    '@/store/longAudio': { longAudioScope: () => scope },
  };
  runInNewContext(code, { exports: api, require: (name: string) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { state, seeks, play: () => api.playLongAudioAt({ id: 'long', title: 'Long', duration: 1000 }, 120, 'A'),
    fetch: async () => { fetched({ id: 'long', title: 'Long', duration: 1000 }); await Promise.resolve(); await Promise.resolve(); },
    finish: () => resolve(true), profile: () => { scope = 'B'; }, manualSeek: () => { seekVersion++; }, unaccepted: () => { accepted = false; } };
}
test('a bookmark loads the selected real track and seeks only its accepted queue', async () => {
  const h = harness(), done = h.play(); await h.fetch(); h.finish(); assert.equal(await done, true); assert.deepEqual(h.seeks, [120]);
});
test('a late track lookup cannot replace a newer queue, profile or manual seek intent', async () => {
  for (const kind of ['profile', 'queue', 'seek']) {
    const h = harness(), done = h.play();
    if (kind === 'profile') h.profile(); else if (kind === 'queue') h.state.queue = [{ id: 'new', title: 'New' }]; else h.manualSeek();
    await h.fetch(); assert.equal(await done, false, kind); assert.deepEqual(h.seeks, [], kind);
  }
});
test('bookmark completion never overwrites a manual seek while the source loads', async () => {
  const h = harness(), done = h.play(); await h.fetch(); h.manualSeek(); h.finish(); assert.equal(await done, false); assert.deepEqual(h.seeks, []);
});
test('same-song bookmarks seek in place only after the native source owns that song', async () => {
  const h = harness(); h.state.queue = [{ id: 'long', title: 'Long' }];
  const original = h.state.queue;
  assert.equal(await h.play(), true); assert.equal(h.state.queue, original); assert.deepEqual(h.seeks, [120]);
  const pending = harness(); pending.state.queue = [{ id: 'long', title: 'Long' }]; pending.unaccepted();
  const done = pending.play(); assert.deepEqual(pending.seeks, []); await pending.fetch(); pending.finish();
  assert.equal(await done, true); assert.deepEqual(pending.seeks, [120]);
});
