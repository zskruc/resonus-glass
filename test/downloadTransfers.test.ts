import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as scheduler from '../src/lib/downloadQueue';
import type { Song } from '../src/api/subsonic';
import type { BackgroundWorkLease, BackgroundWorkProgress, BackgroundWorkInterruption } from '../src/lib/backgroundWorkControl';

const executable = ts.transpileModule(readFileSync(new URL('../src/store/downloads.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
const song = (id = 'one'): Song => ({ id, title: id, artist: 'Artist', album: 'Album', albumId: 'album', duration: 100, suffix: 'mp3' });
function gate() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
function observable<T extends object>(initial: T) {
  let state = initial; const listeners = new Set<(state: T, before: T) => void>();
  return { getState: () => state,
    setState: (next: Partial<T> | ((value: T) => Partial<T>)) => { const before = state;
      state = { ...state, ...(typeof next === 'function' ? next(state) : next) }; for (const listen of listeners) listen(state, before); },
    subscribe: (listen: (state: T, before: T) => void) => { listeners.add(listen); return () => listeners.delete(listen); } };
}
type Transfer = { file: string; resumeData?: string; progress: (bytes: number, total: number) => void;
  finish: (status?: number, mime?: string, total?: number) => void; paused: boolean };
function harness() {
  const auth = observable({ auth: { username: 'A', serverUrl: 'https://test' } as { username: string; serverUrl: string } | null,
    offline: false, profiles: [] as any[] });
  const settings = observable({ downloadConcurrency: 1, downloadWifiOnly: false, downloadBitRate: 0, downloadFormat: '', downloadLosslessOnly: true });
  const network = observable({ connected: true, cellular: false });
  const files = new Map<string, number>(), transfers: Transfer[] = [], records: { dir: string; song: Song }[] = [];
  const app = { currentState: 'active' };
  const appListeners = new Set<() => void>();
  const protections: { updates: BackgroundWorkProgress[]; released: boolean; waits: number[];
    interrupt(reason: BackgroundWorkInterruption): void; current(): boolean }[] = [];
  let protectionGate: Promise<void> | undefined, protectionFailure = false, networkGate: Promise<void> | undefined;
  let moveGate: (() => Promise<void>) | undefined, catalogGate: (() => Promise<void>) | undefined;
  const dependencies: Record<string, unknown> = {
    zustand: { create: (create: (set: any, get: any) => object) => {
      const store = observable({} as any); store.setState(create(store.setState, store.getState)); return store;
    } },
    'react-native': { Platform: { OS: 'android' }, AppState: {
      get currentState() { return app.currentState; },
      addEventListener: (_name: string, listener: () => void) => { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; },
    } },
    '@/lib/backgroundWork': { acquireBackgroundWork: async (_owner: string, initial: BackgroundWorkProgress,
      interrupted: (reason: BackgroundWorkInterruption) => void, current: () => boolean,
      signal?: AbortSignal): Promise<BackgroundWorkLease> => {
      const protection = { updates: [initial], released: false, waits: [] as number[], current,
        interrupt(reason: BackgroundWorkInterruption) { protection.released = true; if (current()) interrupted(reason); } };
      protections.push(protection);
      if (protectionGate) await new Promise<void>((resolve, reject) => {
        const abort = () => { protection.released = true; reject(new Error('Protection cancelled')); };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        void protectionGate!.then(() => { signal?.removeEventListener('abort', abort); resolve(); }, reject);
      });
      if (protectionFailure || !current()) { protection.released = true; throw new Error('Protection unavailable'); }
      return { active: () => !protection.released && current(),
        update: (next) => { if (!protection.released && current()) protection.updates.push(next); },
        release: async () => { protection.released = true; },
        wait: async (delay) => { protection.waits.push(delay); if (!current()) throw new Error('Interrupted'); } };
    } },
    'expo-network': { getNetworkStateAsync: async () => { await networkGate; return { type: 'WIFI' }; }, NetworkStateType: { CELLULAR: 'CELLULAR' } },
    'expo-file-system/legacy': {
      documentDirectory: 'file:///test/', makeDirectoryAsync: async () => {},
      getInfoAsync: async (path: string) => files.has(path) ? { exists: true, size: files.get(path) } : { exists: false },
      deleteAsync: async (path: string) => { files.delete(path); }, writeAsStringAsync: async () => {},
      downloadAsync: async (_url: string, path: string) => { files.set(path, 400); return { status: 200, headers: { 'content-length': '400' } }; },
      moveAsync: async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!); files.delete(from); await moveGate?.(); },
      createDownloadResumable: (_url: string, file: string, options: unknown, callback: (progress: any) => void, initial?: string) => {
        let resumeData = initial; let finish!: (value: unknown) => void;
        const record: Transfer = { file, resumeData: initial, paused: false,
          progress: (written, total) => { files.set(file, written); callback({ totalBytesWritten: written, totalBytesExpectedToWrite: total }); },
          finish: (status = initial ? 206 : 200, mime = 'audio/mpeg', total = 100) => {
            // Match Android's append behavior if a server ignores Range.
            files.set(file, initial && status === 200 ? Number(initial) + total : total);
            finish({ status, headers: { 'content-type': mime, 'content-length': String(initial && status === 206 ? total - Number(initial) : total),
              ...(status === 206 ? { 'content-range': `bytes ${initial}-${total - 1}/${total}` } : {}) } });
          } };
        const start = () => { transfers.push(record); return new Promise((yes) => { finish = yes; }); };
        return { downloadAsync: start, resumeAsync: start,
          savable: () => ({ options, resumeData }),
          pauseAsync: async () => { resumeData = String(files.get(file) ?? 0); record.paused = true; finish(undefined); return { resumeData }; },
          cancelAsync: async () => { finish(undefined); },
        };
      },
    },
    '@/api/backend': { COVER: { card: 600 }, coverArtUrl: () => 'https://test/cover', downloadUrl: () => 'https://test/audio',
      getLyricsBySongId: async () => null, getAlbum: async () => ({ album: { id: 'album', name: 'Album' }, songs: [] }) },
    '@/i18n': { tg: (value: string) => value }, '@/lib/audioQuality': { transcodeTarget: () => ({ bitRate: 0, format: '' }) },
    '@/lib/localLibrary': { hashKey: (value: string) => value.includes('|') ? value.split('|').at(-1) : value,
      normKey: (value: string) => value, registerCover: () => {}, UNKNOWN_ARTIST: 'Unknown' },
    '@/lib/lrc': {}, '@/lib/localLyrics': { siblingLrcUri: (file: string) => file.replace(/\.[^.]+$/, '.lrc') },
    '@/lib/downloadsDb': { addToCatalog: async (dir: string, data: { songs?: Song[] }) => {
      if (data.songs) { await catalogGate?.(); for (const entry of data.songs) records.push({ dir, song: entry }); }
    }, albumsByIds: async () => [], saveArtists: async () => {} },
    '@/lib/perfLog': { netTally: () => {}, timed: (_label: string, work: () => unknown) => work() },
    '@/lib/query': { queryClient: {} }, '@/lib/serverUrls': { primaryUrl: (value: any) => value.serverUrl },
    './auth': { useAuthStore: auth }, './networkType': { useNetworkType: network }, './settings': { useSettings: settings },
    './libraryMirror': { useLibraryMirror: { getState: () => ({ albumDetail: async () => ({}) }) } },
    './toast': { useToast: { getState: () => ({ show: () => {} }) } }, '@/lib/downloadQueue': scheduler,
  };
  const exported: Record<string, any> = {};
  runInNewContext(executable, { exports: exported, AbortController, setTimeout: (callback: () => void, delay: number) => {
    if (delay >= 1500) { void Promise.resolve().then(callback); return 0; }
    return setTimeout(callback, delay);
  }, clearTimeout,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { store: exported.useDownloads, files, transfers, records, auth, settings, network, protections,
    setAppState(value: string) { app.currentState = value; for (const listener of appListeners) listener(); },
    protectionGate: (gate: Promise<void> | undefined) => { protectionGate = gate; },
    protectionFailure: (value: boolean) => { protectionFailure = value; },
    networkGate: (gate: Promise<void> | undefined) => { networkGate = gate; },
    moveGate: (gate: typeof moveGate) => { moveGate = gate; }, catalogGate: (gate: typeof catalogGate) => { catalogGate = gate; } };
}

test('protection is promoted before first audio, survives lock, drains the next song and releases on completion', async () => {
  const h = harness(), promotion = gate(); h.protectionGate(promotion.promise);
  const work = h.store.getState().downloadSongs([song('one'), song('two')]); await tick();
  assert.equal(h.protections.length, 1); assert.equal(h.transfers.length, 0);
  h.setAppState('background'); promotion.resolve(); await tick();
  assert.equal(h.transfers.length, 1); assert.equal(h.protections[0].released, false);
  h.transfers[0].progress(40, 100); h.transfers[0].finish(); await tick();
  assert.equal(h.transfers.length, 2, 'a locked queue starts the next actual song without another user action');
  assert.equal(h.protections.length, 1, 'all groups and successive songs share one music service owner');
  h.transfers[1].finish(); await work; await tick();
  assert.equal(h.records.length, 2); assert.equal(h.protections[0].released, true);
  assert.ok(h.protections[0].updates.some((value) => value.total === 2 && value.completed === 1));
});

test('the explicit action protects its asynchronous Wi-Fi preflight before the phone can lock', async () => {
  const h = harness(), network = gate();
  h.settings.setState({ downloadWifiOnly: true }); h.networkGate(network.promise);
  const work = h.store.getState().downloadSong(song()); await tick();
  assert.equal(h.protections.length, 1); assert.equal(h.protections[0].released, false);
  assert.equal(h.transfers.length, 0);
  h.setAppState('background'); network.resolve(); await tick();
  assert.equal(h.transfers.length, 1); h.transfers[0].finish(); await work; await tick();
  assert.equal(h.protections[0].released, true);
});

test('pause, cancel and offline during a pending promotion cannot start late music or leave a native claim', async () => {
  for (const operation of ['pause', 'cancel', 'offline'] as const) {
    const h = harness(), promotion = gate(); h.protectionGate(promotion.promise);
    const work = h.store.getState().downloadSong(song()); await tick();
    const stop = operation === 'pause' ? h.store.getState().pauseAll()
      : operation === 'cancel' ? h.store.getState().cancelAll() : Promise.resolve(h.auth.setState({ offline: true }));
    await stop; await work; await tick();
    assert.equal(h.transfers.length, 0, operation);
    assert.equal(h.protections[0].released, true, operation);
    assert.equal(h.store.getState().backgroundError, undefined, 'intent cancellation is not a protection failure');
    promotion.resolve(); await tick(); assert.equal(h.transfers.length, 0, 'a late OS acknowledgement remains inert');
  }
});

test('cancelling the last pending group aborts an accepted-but-waiting native job immediately', async () => {
  const h = harness(), promotion = gate(); h.protectionGate(promotion.promise);
  const work = h.store.getState().downloadSong(song()); await tick();
  h.store.getState().cancelDownload('song:one'); await work; await tick();
  assert.equal(h.protections[0].released, true); assert.equal(h.transfers.length, 0);
  promotion.resolve(); await tick(); assert.equal(h.transfers.length, 0);
});

test('cancelling one group during shared promotion does not revoke another group', async () => {
  const h = harness(), promotion = gate(); h.protectionGate(promotion.promise);
  const one = h.store.getState().downloadSong(song('one'));
  const two = h.store.getState().downloadSong(song('two')); await tick();
  assert.equal(h.protections.length, 1);
  h.store.getState().cancelDownload('song:one'); promotion.resolve(); await tick();
  assert.equal(h.transfers.length, 1); assert.equal(h.protections[0].released, false);
  h.transfers[0].finish(); await Promise.all([one, two]); await tick();
  assert.equal(h.records.length, 1); assert.equal(h.store.getState().files.one, undefined);
  assert.ok(h.store.getState().files.two); assert.equal(h.protections[0].released, true);
});

test('native notification pause preserves the partial and timeout exposes a protection error separately from audio', async () => {
  const h = harness(), work = h.store.getState().downloadSong(song()); await tick();
  h.transfers[0].progress(40, 100); h.setAppState('background');
  h.protections[0].interrupt('pause'); await tick();
  assert.equal(h.store.getState().queue[0].status, 'paused'); assert.equal(h.store.getState().backgroundError, undefined);
  h.setAppState('active'); await h.store.getState().resumeAll(); await tick();
  assert.equal(h.transfers.length, 2); assert.equal(h.transfers[1].resumeData, '40');
  h.protections[1].interrupt('timeout'); await tick();
  assert.equal(h.store.getState().queue[0].status, 'paused');
  assert.equal(h.store.getState().queue[0].error, undefined);
  assert.equal(h.store.getState().backgroundError, 'Background downloads stopped');
  await h.store.getState().cancelAll(); await work;
});

test('a denied protection restart leaves a paused song resumable without a foreground restart loop', async () => {
  const h = harness(), work = h.store.getState().downloadSong(song()); await tick();
  h.transfers[0].progress(40, 100); await h.store.getState().pauseAll(); await tick();
  const pending = gate(); h.protectionGate(pending.promise);
  h.protectionFailure(true); await h.store.getState().resumeAll(); await tick();
  h.setAppState('background'); pending.resolve(); await tick();
  assert.equal(h.store.getState().queue[0].status, 'paused'); assert.equal(h.transfers.length, 1);
  assert.equal(h.store.getState().backgroundError, 'Background downloads could not start');
  const attempts = h.protections.length; await tick(); assert.equal(h.protections.length, attempts);
  h.setAppState('active'); h.protectionGate(undefined);
  h.protectionFailure(false); await h.store.getState().resumeAll(); await tick();
  assert.equal(h.transfers.length, 2); assert.equal(h.store.getState().backgroundError, undefined);
  h.transfers[1].finish(); await work; await tick(); assert.equal(h.records.length, 1);
});

test('Wi-Fi/offline policy blocks service admission and retries use the protected native wait', async () => {
  const h = harness(); h.network.setState({ cellular: true }); h.settings.setState({ downloadWifiOnly: true });
  await h.store.getState().downloadSong(song());
  assert.equal(h.protections.length, 0); assert.equal(h.transfers.length, 0);
  h.settings.setState({ downloadWifiOnly: false });
  const work = h.store.getState().downloadSong(song()); await tick();
  h.transfers[0].finish(503); await tick();
  assert.deepEqual(h.protections[0].waits, [1500]); assert.equal(h.transfers.length, 2);
  h.transfers[1].finish(); await work; await tick(); assert.equal(h.protections[0].released, true);
});

test('real download pause preserves its partial, resumes with the actual Range, and commits one complete audio file', async () => {
  const h = harness(), work = h.store.getState().downloadSong(song()); await tick();
  assert.equal(h.transfers.length, 1); h.transfers[0].progress(40, 100);
  await h.store.getState().pauseAll(); await tick();
  assert.equal(h.store.getState().queue[0].status, 'paused'); assert.equal(h.files.get(h.transfers[0].file), 40);
  await h.store.getState().resumeAll(); await tick();
  assert.equal(h.transfers.length, 2); assert.equal(h.transfers[1].resumeData, '40');
  h.transfers[0].progress(99, 100); h.transfers[1].progress(60, 100);
  h.transfers[1].finish(); await work; await tick();
  assert.equal(h.records.length, 1); assert.equal(h.files.get(h.store.getState().files.one), 100);
  assert.equal(h.store.getState().queue[0].status, 'completed');
  await h.store.getState().cancelAll(); assert.equal(h.files.get(h.store.getState().files.one), 100);
});

test('a server ignoring resumed Range restarts once instead of registering concatenated corrupt audio', async () => {
  const h = harness(), work = h.store.getState().downloadSong(song()); await tick();
  h.transfers[0].progress(40, 100); await h.store.getState().pauseAll(); await tick();
  await h.store.getState().resumeAll(); await tick(); h.transfers[1].finish(200); await tick();
  assert.equal(h.transfers.length, 3); assert.equal(h.transfers[2].resumeData, undefined);
  h.transfers[2].finish(); await work; await tick();
  assert.equal(h.files.get(h.store.getState().files.one), 100); assert.equal(h.records.length, 1);
});

test('Cancel after a fully paused run deletes partial audio without cataloguing it', async () => {
  const h = harness(), work = h.store.getState().downloadSong(song()); await tick();
  h.transfers[0].progress(30, 100); await h.store.getState().pauseAll(); await tick();
  await h.store.getState().cancelAll(); await work; await tick();
  assert.equal(h.files.has(h.transfers[0].file), false); assert.equal(h.records.length, 0);
  assert.equal(h.store.getState().queue[0].status, 'cancelled');
});

test('an old account transfer cannot register itself into the new account or erase its same-id queue', async () => {
  const h = harness(); h.settings.setState({ downloadConcurrency: 2 });
  const old = h.store.getState().downloadSong(song()); await tick();
  h.auth.setState({ auth: { username: 'B', serverUrl: 'https://test' } }); await tick();
  const current = h.store.getState().downloadSong(song()); await tick();
  h.transfers[0].progress(99, 100); h.transfers[1].finish(); await current; await tick();
  assert.equal(h.records.length, 1); assert.ok(h.records[0].dir.includes('/B/'));
  assert.ok(h.store.getState().files.one.includes('/B/')); assert.equal(h.store.getState().queue[0].status, 'completed');
  h.auth.setState({ auth: { username: 'A', serverUrl: 'https://test' } }); await tick();
  h.auth.setState({ auth: null }); await tick(); await old;
});

test('JSON masquerading as successful audio fails without registering a playable file', async () => {
  const h = harness(), work = h.store.getState().downloadSong(song()); await tick();
  h.transfers[0].finish(200, 'application/json'); await work; await tick();
  assert.equal(h.records.length, 0); assert.equal(h.store.getState().files.one, undefined);
  assert.equal(h.store.getState().queue[0].status, 'failed'); assert.equal(h.files.has(h.transfers[0].file), false);
});

test('pause after moving verified audio resumes only cataloguing, without downloading the song again', async () => {
  const h = harness(); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  h.moveGate(() => gate);
  const work = h.store.getState().downloadSong(song()); await tick(); h.transfers[0].finish(); await tick();
  await h.store.getState().pauseAll(); await h.store.getState().resumeAll(); await tick();
  assert.equal(h.transfers.length, 1); h.moveGate(undefined); release(); await work; await tick();
  assert.equal(h.transfers.length, 1); assert.equal(h.records.length, 1);
  assert.equal(h.files.get(h.store.getState().files.one), 100);
});

test('cancel during an unabortable move then immediately re-add cannot let old cleanup delete the new completed file', async () => {
  const h = harness(); h.settings.setState({ downloadConcurrency: 2 }); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); h.moveGate(() => gate);
  const old = h.store.getState().downloadSong(song()); await tick(); h.transfers[0].finish(); await tick();
  await h.store.getState().cancelAll(); await old; await tick();
  const fresh = h.store.getState().downloadSong(song()); await tick();
  assert.equal(h.transfers.length, 1, 'same file waits until the retired run and its cleanup finish');
  h.moveGate(undefined); release(); await tick(); assert.equal(h.transfers.length, 2);
  h.transfers[1].finish(); await fresh; await tick();
  assert.equal(h.records.length, 1); assert.equal(h.files.get(h.store.getState().files.one), 100);
});

test('catalog retry exhaustion cleans its owned audio and explicit Start can redownload successfully', async () => {
  const h = harness(); let attempts = 0;
  h.catalogGate(async () => { attempts++; throw new Error('database temporarily unavailable'); });
  const work = h.store.getState().downloadSong(song()); await tick(); h.transfers[0].finish(); await work; await tick();
  assert.equal(attempts, 3); assert.equal(h.store.getState().queue[0].status, 'failed');
  assert.equal(h.records.length, 0);
  h.catalogGate(undefined); await h.store.getState().resumeAll(); await tick();
  assert.equal(h.transfers.length, 2); h.transfers[1].finish(); await tick();
  assert.equal(h.store.getState().queue[0].status, 'completed'); assert.equal(h.records.length, 1);
  assert.equal(h.files.get(h.store.getState().files.one), 100);
});
