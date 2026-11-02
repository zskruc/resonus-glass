import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { withSpeculativeSlot } from '../src/lib/netBudget';
import { createSlots } from '../src/lib/slots';
import { PlaybackLoadGate } from '../src/lib/playbackLoadGate';

const executable = ts.transpileModule(readFileSync(new URL('../src/lib/mirrorCovers.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = async () => { for (let index = 0; index < 60; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function harness() {
  const pool = createSlots(4), files = new Map<string, number>(), rows = new Map<string, any>();
  const playbackGate = new PlaybackLoadGate();
  const registrations = new Map<string, string>(), downloads: string[] = [], timers: (() => void)[] = [];
  const state = { owner: {}, offline: false, status: 200, mime: 'image/webp', size: 2200, paused: 0, failDb: false };
  const resolutions = new Map<string, number>();
  let smallGate: Promise<void> | undefined, fullGate: Promise<void> | undefined;
  const dependencies: Record<string, unknown> = {
    'expo-file-system/legacy': {
      documentDirectory: 'file:///test/', makeDirectoryAsync: async () => {},
      readAsStringAsync: async () => { throw new Error('no legacy index'); },
      getInfoAsync: async (file: string) => files.has(file) ? { exists: true, size: files.get(file) } : { exists: false },
      deleteAsync: async (file: string) => { files.delete(file); },
      moveAsync: async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!); files.delete(from); },
      downloadAsync: async (url: string, file: string) => {
        downloads.push('small:' + url); await smallGate; files.set(file, 600); return { status: 200 };
      },
      createDownloadResumable: (url: string, file: string) => {
        const cancelled = deferred<void>(); let stopped = false;
        return { pauseAsync: async () => { state.paused++; stopped = true; cancelled.resolve(); },
          downloadAsync: async () => {
            downloads.push('full:' + url);
            if (fullGate) await Promise.race([fullGate, cancelled.promise]);
            if (stopped) return undefined;
            files.set(file, state.size);
            return { status: state.status, headers: { 'Content-Type': state.mime } };
          } };
      },
    },
    '@/api/backend': { COVER: { card: 600, full: 1200 }, coverArtUrl: (_auth: unknown, id: string, size: number) => `https://covers.test/${id}?size=${size}` },
    '@/api/netGate': { isOfflineMode: () => state.offline }, '@/lib/idle': { whenIdle: (callback: () => void) => callback() },
    '@/lib/netBudget': { withSpeculativeSlot: (current: () => boolean, work: () => Promise<unknown>) => withSpeculativeSlot(current, work, pool) },
    '@/lib/playbackLoadGate': { playbackLoadGate: playbackGate },
    '@/lib/perfLog': { bump: () => {}, netTally: () => {} },
    '@/lib/localLibrary': { hashKey: (id: string) => id, localCoverUrl: (id: string) => registrations.get(id),
      registerCover: (id: string, file: string, size = 0) => {
        if (!registrations.has(id)) { registrations.set(id, file); resolutions.set(id, size); }
      },
      replaceCover: (id: string, file: string, size = 0) => { registrations.set(id, file); resolutions.set(id, size); },
      forgetCover: (id: string) => { registrations.delete(id); resolutions.delete(id); } },
    './mirrorDb': { allCovers: async () => [...rows.values()], putCovers: async (_base: string, _profile: string, values: any[]) => {
      if (state.failDb) throw new Error('database write failed');
      for (const value of values) rows.set(value.id, value);
    }, dropCovers: async () => rows.clear(), dropCover: async (_base: string, _profile: string, id: string) => {
      for (const [key, row] of rows) if (key === id || row.aliasOf === id) rows.delete(key);
    } },
  };
  const exported: Record<string, any> = {};
  runInNewContext(executable, { exports: exported, Date, AbortController,
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  const owner = state.owner;
  const current = () => state.owner === owner;
  return { pool, playbackGate, state, files, rows, registrations, resolutions, downloads,
    reload: async () => { await exported.loadMirrorCovers('other'); registrations.clear(); resolutions.clear(); await exported.loadMirrorCovers('one'); },
    smallGate: (gate: Promise<void>) => { smallGate = gate; }, fullGate: (gate: Promise<void>) => { fullGate = gate; },
    load: () => exported.loadMirrorCovers('one'),
    info: () => exported.mirrorCoversInfo('one') as Promise<{ bytes: number; count: number }>,
    remove: () => exported.removeMirrorCovers('one') as Promise<void>,
    keep: (size?: number) => exported.keepMirrorCovers('one', owner, size ? [{ from: 'cover', keys: ['cover', 'playlist'], size }] : ['cover'], current),
    keepWants: (wants: unknown[]) => exported.keepMirrorCovers('one', owner, wants, current),
    flush: async () => { for (const callback of timers.splice(0)) callback(); await tick(); },
    full: (signal = new AbortController().signal) => exported.cacheManagedCover('one', owner,
      { from: 'cover', keys: ['cover', 'artist'], size: 1200 }, current, signal) as Promise<{ outcome: string; uri?: string }>,
  };
}

test('a full-size cache upgrade waits for the existing small write and is reused for every display role', async () => {
  const h = harness(), small = deferred<void>(); await h.load(); h.smallGate(small.promise);
  h.keep(); await h.flush();
  const full = h.full(); await tick();
  assert.equal(h.downloads.length, 1, 'the full upgrade cannot race the automatic small write');
  small.resolve(); const result = await full; await tick();
  assert.equal(result.outcome, 'success'); assert.equal(h.downloads.length, 2);
  assert.equal(h.files.get(result.uri!), 2200);
  assert.equal(h.registrations.get('artist'), result.uri);
  assert.equal(h.rows.get('cover').bytes, 2800, 'the HD image and retained legacy fallback are both counted');
  assert.equal(h.rows.get('full-1200|cover').aliasOf, 'cover');
  assert.equal((await h.full()).outcome, 'cached'); assert.equal(h.downloads.length, 2);
  assert.equal((await h.info()).bytes, 2800, 'a cache hit does not add the retained legacy image twice');
  assert.equal([...h.files.keys()].filter((path) => !path.endsWith('.part')).length, 2, 'existing memoized cards retain a readable legacy image');
});

test('a confirmed missing cover is distinct from HTTP, content and truncated-file failures; the old cover is retained', async () => {
  for (const failure of ['missing', 'http', 'mime', 'short'] as const) {
    const h = harness(); await h.load(); h.keep(); await h.flush();
    const canonical = h.registrations.get('cover')!; assert.equal(h.files.get(canonical), 600);
    if (failure === 'missing') h.state.status = 404;
    if (failure === 'http') h.state.status = 503;
    if (failure === 'mime') h.state.mime = 'application/json';
    if (failure === 'short') h.state.size = 10;
    if (failure === 'missing') assert.equal((await h.full()).outcome, 'missing');
    else await assert.rejects(h.full(), /Cover download failed|Invalid cover/);
    assert.equal(h.files.get(canonical), 600, 'unsuccessful upgrade never deletes the existing usable image');
    assert.equal(h.rows.has('full-1200|cover'), false);
    assert.equal([...h.files.keys()].some((file) => file.endsWith('.part')), false);
  }
});

test('waiting on a shared resource rechecks offline or replaced credentials before sending a cover request', async () => {
  for (const offline of [false, true]) {
    const h = harness(); await h.load();
    await Promise.all(Array.from({ length: 4 }, () => h.pool.take()));
    const work = h.full(); await tick();
    if (offline) h.state.offline = true; else h.state.owner = {};
    for (let index = 0; index < 4; index++) h.pool.release();
    await assert.rejects(work, /stopped/);
    assert.equal(h.downloads.length, 0); assert.equal(h.registrations.size, 0);
  }
});

test('cancelling an active full cover pauses the transfer and releases its slot without indexing a partial file', async () => {
  const h = harness(), gate = deferred<void>(), control = new AbortController();
  await h.load(); h.fullGate(gate.promise);
  const work = h.full(control.signal); await tick(); control.abort();
  await assert.rejects(work, /stopped/); await tick();
  assert.equal(h.state.paused, 1); assert.equal(h.registrations.size, 0); assert.equal(h.files.size, 0);
  const acquired: number[] = [];
  for (let index = 0; index < 4; index++) void h.pool.take().then(() => acquired.push(index));
  await tick(); assert.equal(acquired.length, 4);
  for (let index = 0; index < 4; index++) h.pool.release();
});

test('an automatic cover waiting for playback cannot lock out an explicit full-size cache request', async (t) => {
  const h = harness(); await h.load();
  const hold = h.playbackGate.hold(); t.after(() => h.playbackGate.release(hold));
  h.keep(); await h.flush(); assert.equal(h.downloads.length, 0);
  const result = await h.full();
  assert.equal(result.outcome, 'success');
  assert.equal(h.downloads.length, 1);
  assert.ok(h.downloads[0].startsWith('full:'));
  h.playbackGate.release(hold); await tick();
  assert.equal(h.downloads.length, 1, 'the later automatic pass sees the completed full file');
  assert.equal(h.files.get(result.uri!), 2200);
});

test('automatically upgrades a legacy playlist once, publishes a new URI and restores its tier after restart', async () => {
  const h = harness();
  const legacy = 'file:///test/library-mirror/covers/one_cover.jpg';
  h.files.set(legacy, 600);
  h.rows.set('cover', { id: 'cover', aliasOf: null, bytes: 600 });
  h.rows.set('playlist', { id: 'playlist', aliasOf: 'cover', bytes: 0 });
  await h.load();
  assert.equal(h.registrations.get('playlist'), legacy);
  assert.equal(h.resolutions.get('playlist'), 0, 'old rows do not claim a resolution they never recorded');
  h.keep(1200); await h.flush(); await tick();
  const upgraded = h.registrations.get('cover')!;
  assert.notEqual(upgraded, legacy);
  assert.ok(upgraded.endsWith('_s1200.jpg'), 'Expo receives a new decoded-image cache identity');
  assert.deepEqual(h.downloads, ['full:https://covers.test/cover?size=1200']);
  assert.equal(h.registrations.get('playlist'), upgraded);
  assert.equal(h.resolutions.get('playlist'), 1200);
  assert.equal(h.rows.get('cover').size, 1200);
  assert.equal(h.files.get(legacy), 600, 'a card which retained the old URI can still load its image');
  assert.equal(h.rows.get('cover').bytes, 2800);
  assert.equal((await h.info()).bytes, 2800);
  h.keep(1200); await h.flush(); await tick();
  assert.equal(h.downloads.length, 1);
  assert.equal((await h.info()).bytes, 2800, 'reusing HD does not count the old fallback twice');
  await h.reload();
  assert.equal(h.registrations.get('playlist'), upgraded);
  assert.equal(h.resolutions.get('playlist'), 1200);
  assert.equal((await h.info()).bytes, 2800, 'restart restores the combined durable file bytes');
  await h.remove();
  assert.equal(h.files.size, 0, 'profile cleanup removes both the HD file and retained legacy fallback');
  assert.equal(h.rows.size, 0);
});

test('restoring a persisted HD tier replaces an earlier low-resolution registration', async () => {
  const h = harness();
  h.registrations.set('cover', 'file:///old/600.jpg');
  h.registrations.set('playlist', 'file:///old/600.jpg');
  h.resolutions.set('cover', 600); h.resolutions.set('playlist', 600);
  h.rows.set('cover', { id: 'cover', aliasOf: null, bytes: 2200, size: 1200 });
  h.rows.set('playlist', { id: 'playlist', aliasOf: 'cover', bytes: 0, size: 0 });
  await h.load();
  assert.ok(h.registrations.get('cover')!.endsWith('_s1200.jpg'));
  assert.equal(h.registrations.get('playlist'), h.registrations.get('cover'));
  assert.equal(h.resolutions.get('playlist'), 1200);
});

test('recounting an older uncounted HD entry includes its retained legacy fallback', async () => {
  const h = harness();
  h.rows.set('cover', { id: 'cover', aliasOf: null, bytes: 0, size: 1200 });
  h.files.set('file:///test/library-mirror/covers/one_cover.jpg', 600);
  h.files.set('file:///test/library-mirror/covers/one_cover_s1200.jpg', 2200);
  await h.load();
  const info = await h.info();
  assert.equal(info.bytes, 2800); assert.equal(info.count, 1);
  await tick();
  assert.equal(h.rows.get('cover').bytes, 2800);
  assert.equal(h.rows.get('cover').size, 1200);
});

test('a failed database commit keeps the old playlist image, mappings and resolution', async () => {
  const h = harness(); await h.load(); h.keep(); await h.flush();
  const old = h.registrations.get('cover')!;
  h.state.failDb = true;
  await assert.rejects(h.full(), /database write failed/);
  assert.equal(h.registrations.get('cover'), old);
  assert.equal(h.files.get(old), 600);
  assert.equal(h.resolutions.get('cover'), 600);
  assert.equal(h.rows.get('cover').size, 600);
  assert.equal(h.rows.has('full-1200|cover'), false);
  assert.deepEqual([...h.files.keys()], [old]);
  h.state.failDb = false;
  h.keep(1200); await h.flush(); await tick();
  assert.equal(h.resolutions.get('cover'), 1200);
});

test('a larger automatic request queued behind a running small write is not dropped', async () => {
  const h = harness(), gate = deferred<void>(); await h.load(); h.smallGate(gate.promise);
  h.keep(); await h.flush(); assert.equal(h.downloads.length, 1);
  h.keep(1200); await h.flush(); assert.equal(h.downloads.length, 1);
  gate.resolve(); await tick(); await tick();
  assert.equal(h.downloads.length, 2);
  assert.ok(h.downloads[1].endsWith('size=1200'));
  assert.equal(h.resolutions.get('playlist'), 1200);
  h.keep(); h.keep(1200); await h.flush(); await tick();
  assert.equal(h.downloads.length, 2, 'ordinary mirror writes cannot downgrade the completed upgrade');
});

test('duplicate wants choose the highest tier and preserve all aliases', async () => {
  const h = harness(); await h.load();
  h.keepWants([
    { from: 'cover', keys: ['cover', 'playlist'], size: 600 },
    { from: 'cover', keys: ['cover', 'playlist', 'another-playlist'], size: 1200 },
  ]);
  await h.flush(); await tick();
  assert.deepEqual(h.downloads, ['full:https://covers.test/cover?size=1200']);
  assert.equal(h.resolutions.get('another-playlist'), 1200);
});

test('existing playlists upgrade even when the mirror already has its maximum number of covers', async () => {
  const h = harness();
  for (let i = 0; i < 10_000; i++) {
    const id = i === 0 ? 'cover' : `album-${i}`;
    h.rows.set(id, { id, aliasOf: null, bytes: 600 });
    h.files.set(`file:///test/library-mirror/covers/one_${id}.jpg`, 600);
  }
  await h.load(); h.keep(1200); await h.flush(); await tick();
  assert.deepEqual(h.downloads, ['full:https://covers.test/cover?size=1200']);
  assert.equal(h.resolutions.get('playlist'), 1200);
  h.keepWants(['new-album']); await h.flush();
  assert.equal(h.downloads.length, 1, 'new files still respect the existing cap');
});

test('automatic full upgrades wait for playback and retain the offline image on an owner change', async (t) => {
  const h = harness(), transfer = deferred<void>(); await h.load(); h.keep(); await h.flush();
  const original = h.registrations.get('cover');
  const hold = h.playbackGate.hold(); t.after(() => h.playbackGate.release(hold));
  h.keep(1200); await h.flush(); assert.equal(h.downloads.length, 1);
  h.fullGate(transfer.promise); h.playbackGate.release(hold); await tick();
  assert.equal(h.downloads.length, 2);
  h.state.owner = {}; transfer.resolve(); await tick();
  assert.equal(h.registrations.get('cover'), original);
  assert.equal(h.resolutions.get('cover'), 600);
  assert.equal(h.rows.has('full-1200|cover'), false);
  assert.equal([...h.files.keys()].some((file) => file.endsWith('.part') || file.endsWith('_s1200.jpg')), false);
});
