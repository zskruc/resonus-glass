import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { audiobookAlbum, audiobookResumeStart } from '../src/lib/audiobook';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function harness() {
  let owner = 'A', complete!: (ok: boolean) => void, latest: any;
  const seeks: number[] = [], remembered: unknown[][] = [];
  const album = { id: 'book', name: 'Book', releaseTypes: ['audiobook'] };
  const songs = [{ id: 'one', title: 'One', albumId: 'book', duration: 100 }, { id: 'two', title: 'Two', albumId: 'book', duration: 100 }];
  const player: Record<string, any> = { queue: [], index: 0, sourceHref: null, seekTo: (value: number) => seeks.push(value),
    playQueue: (tracks: unknown[], index: number, name: string, href: string, options: unknown) => {
      assert.equal((options as { ordered: boolean }).ordered, true);
      // An offline queue may be copied/remapped by playQueue; identity is read
      // after that synchronous ownership transfer, never guessed from props.
      player.queue = [...tracks]; player.index = index; player.sourceHref = href;
      return new Promise<boolean>((resolve) => { complete = resolve; });
    } };
  const imports: Record<string, unknown> = {
    react: React,
    '@/lib/audiobook': { audiobookAlbum, audiobookResumeStart }, '@/lib/format': { formatDuration: String },
    '@/i18n': { useT: () => (text: string) => text },
    '@/store/auth': { useAuthStore: (select: (state: unknown) => unknown) => select({ auth: null, offline: false }) },
    '@/store/settings': { useSettings: (select: (state: unknown) => unknown) => select({ saveAudiobookProgress: true, audiobookContinueRewindSec: 20 }) },
    '@/store/albumProgress': { audiobookProfileScope: () => owner,
      useAlbumProgressByAlbum: () => ({ book: { trackId: 'two', positionSec: 10, updatedAt: 1 } }),
      useAlbumProgress: { getState: () => ({ hydrate: async () => {}, remember: (...args: unknown[]) => remembered.push(args) }) } },
    '@/store/player': { usePlayerStore: { getState: () => player } }, '@/store/toast': { useToast: { getState: () => ({ show() {} }) } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/hooks/useAudiobookResume.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  function Page() { latest = exports.useAudiobookResume(album, songs, '/album/book'); return null; }
  let renderer!: ReactTestRenderer;
  return { async mount() { await act(async () => { renderer = create(React.createElement(Page)); }); },
    async unmount() { await act(async () => { renderer.unmount(); }); },
    async press() { await act(async () => { latest.resumeAction.onPress(); }); },
    async resolve() { await act(async () => { complete(true); }); },
    switchProfile() { owner = 'B'; }, replaceQueue() { player.queue = [{ id: 'newer' }]; player.index = 0; }, seeks, remembered };
}
test('Continue uses the rewound chapter and accepts the player-owned filtered queue', async () => {
  const h = harness(); await h.mount();
  try { await h.press(); await h.resolve(); assert.deepEqual(h.seeks, [90]); assert.equal(h.remembered[0][2], 'one'); }
  finally { await h.unmount(); }
});
test('Continue never seeks after a newer queue, account change or component unmount', async () => {
  for (const mutation of ['queue', 'profile', 'unmount']) {
    const h = harness(); await h.mount(); await h.press();
    if (mutation === 'queue') h.replaceQueue(); else if (mutation === 'profile') h.switchProfile(); else await h.unmount();
    await h.resolve(); assert.deepEqual(h.seeks, [], mutation); assert.equal(h.remembered.length, 0);
    if (mutation !== 'unmount') await h.unmount();
  }
});
