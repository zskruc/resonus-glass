import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { create as createStore } from 'zustand';
import { createDownloadQueue } from '../src/lib/downloadQueue';
import { podcastUrlExtension } from '../src/lib/podcastMedia';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) { for (let n = 0; n < 30 && !check(); n++) await turn(); assert.equal(check(), true); }
const hash = (value: string) => value;
function harness() {
  const one = { username: 'one', serverUrl: 'https://one.test' };
  const useAuthStore = createStore<any>(() => ({ auth: one, offline: false }));
  const profileScopeId = () => useAuthStore.getState().auth?.username ?? 'local';
  const disk = new Map<string, number>(), records = new Map<string, Record<string, string>>();
  const transfers: { path: string; status: string; signalIgnored: boolean; finish(): void; progress(written: number, total: number): void }[] = [];
  let protectedLease = false, background = false, wifi = true, ignorePause = false;
  let networkListener: ((state: unknown) => void) | undefined;
  let commitWait: Promise<void> | undefined, commitEntered = false;
  let update: any[] = [], paused = false;
  const queue = createDownloadQueue({ owner: () => useAuthStore.getState().auth,
    profile: (auth) => auth.username, allowed: () => !!useAuthStore.getState().auth && !useAuthStore.getState().offline && (!background || protectedLease),
    limit: () => 2, update: (items, value) => { update = items; paused = value; },
    preparation: { ready: () => protectedLease, start: async (_auth, current) => { if (!current()) return false; protectedLease = true; return true; } },
  });
  const downloads = { get queue() { return update; }, enqueueExternal: (song: any, group: string, run: any, cleanup: any, permitted: any) => queue.add(song, group, run, false, cleanup, permitted), forgetExternal: (ids: string[]) => queue.forget(ids),
    cancelExternal: (group: string, scope?: string) => queue.cancelGroup(group, scope),
    syncExternal: () => queue.sync(),
  };
  useAuthStore.subscribe(() => queue.sync());
  const fs = { documentDirectory: 'file:///sandbox/',
    makeDirectoryAsync: async () => {}, readDirectoryAsync: async () => [],
    getInfoAsync: async (path: string) => ({ exists: disk.has(path), size: disk.get(path) ?? 0 }),
    deleteAsync: async (path: string) => { for (const key of disk.keys()) if (key === path || key.startsWith(path)) disk.delete(key); },
    moveAsync: async ({ from, to }: any) => { assert.ok(disk.has(from)); disk.set(to, disk.get(from)!); disk.delete(from); },
    createDownloadResumable: (_url: string, path: string, _options: unknown, progress: (event: unknown) => void) => {
      assert.equal(protectedLease, true, 'the shared native work lease must exist before starting RSS transfer');
      let resolve!: (value: unknown) => void;
      const promise = new Promise((done) => { resolve = done; });
      const transfer = { path, status: 'created', signalIgnored: ignorePause,
        finish() { disk.set(path, 512); transfer.status = 'finished'; resolve({ status: 200, headers: { 'Content-Type': 'audio/mpeg' } }); },
        progress(written: number, total: number) { progress({ totalBytesWritten: written, totalBytesExpectedToWrite: total }); },
      };
      transfers.push(transfer);
      return { downloadAsync: () => { transfer.status = 'running'; return promise; }, pauseAsync: async () => {
        transfer.status = 'paused'; if (!transfer.signalIgnored) resolve(undefined); return {};
      } };
    },
  };
  const Db = { podcastDbDir: (scope: string) => `file:///sandbox/podcasts/${scope}/`,
    listDownloads: async (scope: string) => ({ ...(records.get(scope) ?? {}) }),
    getDownload: async (scope: string, id: string) => {
      const file = records.get(scope)?.[id]; return file ? { file, bytes: disk.get(file) ?? 0 } : undefined;
    },
    saveDownload: async (scope: string, episode: any, path: string, _bytes: number, current: () => boolean) => {
      if (!current()) throw Error('stopped'); records.set(scope, { ...(records.get(scope) ?? {}), [episode.id]: path });
      if (commitWait) { commitEntered = true; await commitWait; }
    }, dropDownloads: async (scope: string, ids: string[]) => { const next = { ...(records.get(scope) ?? {}) }; for (const id of ids) delete next[id]; records.set(scope, next); },
    downloadedBytes: async (scope: string) => Object.values(records.get(scope) ?? {}).reduce((sum, path) => sum + (disk.get(path) ?? 0), 0),
    closePodcastDb: async () => {},
    downloadedForChannel: async (scope: string) => ({ ids: Object.keys(records.get(scope) ?? {}) }),
  };
  const imports: Record<string, unknown> = {
    'expo-file-system/legacy': fs, 'expo-network': { NetworkStateType: { WIFI: 'wifi' }, getNetworkStateAsync: async () => ({ type: wifi ? 'wifi' : 'cellular' }),
      addNetworkStateListener: (callback: (state: unknown) => void) => { networkListener = callback; return { remove() {} }; } },
    zustand: { create: createStore }, '@/api/netGate': { isManualOffline: () => useAuthStore.getState().offline },
    './auth': { profileScopeId, useAuthStore }, './downloads': { useDownloads: { getState: () => downloads } },
    '@/lib/localLibrary': { hashKey: hash }, '@/lib/podcastMedia': { podcastUrlExtension }, '@/lib/podcastDb': Db,
    '@/lib/query': { queryClient: { invalidateQueries: async () => {} } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/podcastDownloads.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, URL, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const channel = { id: 'show', title: 'Example show', feedUrl: 'https://feed.test/rss' };
  const episodes = ['a', 'b', 'c'].map((id) => ({ id: `show/${id}`, channelId: 'show', title: id, url: `https://audio.test/${id}.mp3` }));
  return { store: exports.usePodcastDownloads, podcastFile: exports.podcastFile, channel, episodes, queue, transfers, records, disk, useAuthStore,
    rows: () => update, paused: () => paused, setWifi: (value: boolean) => { wifi = value; networkListener?.({ type: wifi ? 'wifi' : 'cellular', isConnected: true }); },
    blockCommit: (wait: Promise<void>) => { commitWait = wait; }, commitEntered: () => commitEntered,
    background: () => { background = true; queue.sync(); }, ignorePause: () => { ignorePause = true; } };
}

test('RSS and music share the same transfer limit and native lease while background audio completes durably', async () => {
  const h = harness(); await h.store.getState().hydrate();
  let finishMusic!: () => void;
  const music = h.queue.add({ id: 'music', title: 'Music' }, 'album:one', () => new Promise<void>((resolve) => { finishMusic = resolve; }));
  const work = h.store.getState().download(h.channel, h.episodes);
  await until(() => !!finishMusic && h.transfers.length === 1);
  assert.equal(h.rows().filter((row) => row.status === 'downloading').length, 2);
  h.background();
  finishMusic(); await music;
  await until(() => h.transfers.length === 2);
  h.transfers[0].finish(); h.transfers[1].finish();
  await until(() => h.transfers.length === 3);
  h.transfers[2].finish(); await work;
  assert.equal(Object.keys(h.records.get('one') ?? {}).length, 3);
  assert.equal(h.rows().every((row) => row.status === 'completed'), true);
  assert.ok(h.podcastFile({ id: 'show/a', podcastChannelId: 'show' }));
  assert.equal([...h.disk.keys()].some((path) => path.endsWith('.part')), false);
  await h.store.getState().hydrate();
  assert.ok(h.podcastFile({ id: 'show/a', podcastChannelId: 'show' }), 'cold hydration restores only this profile files');
});

test('shared Pause/Start and Cancel control RSS tasks without registering partial files', async () => {
  const h = harness(); await h.store.getState().hydrate();
  const work = h.store.getState().download(h.channel, h.episodes.slice(0, 2));
  await until(() => h.transfers.length === 2);
  h.transfers[0].progress(40, 512);
  await h.queue.pauseAll(); await until(() => h.rows().every((row) => row.status === 'paused'));
  assert.equal(h.paused(), true);
  assert.equal(Object.keys(h.records.get('one') ?? {}).length, 0);
  await h.queue.resumeAll(); await until(() => h.transfers.length === 4);
  h.transfers[2].finish(); h.transfers[3].finish(); await work;
  assert.equal(Object.keys(h.records.get('one') ?? {}).length, 2);
  const next = h.store.getState().download(h.channel, h.episodes.slice(2));
  await until(() => h.transfers.length === 5); await h.queue.cancelAll(); await next;
  assert.equal(Object.keys(h.records.get('one') ?? {}).length, 2);
  assert.equal(h.rows().find((row) => row.song.id === 'show/c')?.status, 'cancelled');
});

test('account change cancels an uncooperative RSS transfer and rejects its late file publication', async () => {
  const h = harness(); await h.store.getState().hydrate(); h.ignorePause();
  const work = h.store.getState().download(h.channel, h.episodes.slice(0, 1));
  await until(() => h.transfers.length === 1);
  h.useAuthStore.setState({ auth: { username: 'two', serverUrl: 'https://two.test' } });
  await work;
  h.transfers[0].finish(); await turn(); await turn();
  assert.equal(Object.keys(h.records.get('one') ?? {}).length, 0);
  assert.equal(Object.keys(h.records.get('two') ?? {}).length, 0);
  assert.equal(h.podcastFile({ id: 'show/a', podcastChannelId: 'show' }), undefined);
  assert.equal([...h.disk.keys()].some((path) => path.endsWith('.part')), false);
});

test('automatic episodes require actual Wi-Fi and do not bypass manual offline', async () => {
  const h = harness(); await h.store.getState().hydrate(); h.setWifi(false);
  await h.store.getState().download(h.channel, h.episodes, true);
  assert.equal(h.transfers.length, 0);
  h.setWifi(true); h.useAuthStore.setState({ offline: true });
  await h.store.getState().download(h.channel, h.episodes, true);
  assert.equal(h.transfers.length, 0);
});

test('a stale initial Wi-Fi inspection cannot override a newer cellular event', async () => {
  const h = harness(); await h.store.getState().hydrate();
  const work = h.store.getState().download(h.channel, h.episodes, true);
  h.setWifi(false);
  await work;
  assert.equal(h.transfers.length, 0);
});

test('deleting RSS audio waits for its accepted native commit and then removes the final file only', async () => {
  const h = harness(); await h.store.getState().hydrate();
  let release!: () => void;
  h.blockCommit(new Promise<void>((resolve) => { release = resolve; }));
  const work = h.store.getState().download(h.channel, h.episodes.slice(0, 1));
  await until(() => h.transfers.length === 1); h.transfers[0].finish();
  await until(h.commitEntered);
  let deleted = false;
  const deletion = h.store.getState().deleteEpisodes(['show/a']).then(() => { deleted = true; });
  await turn(); assert.equal(deleted, false, 'an unabortable accepted commit must settle before unlink');
  release(); await Promise.all([work, deletion]);
  assert.equal(Object.keys(h.records.get('one') ?? {}).length, 0);
  assert.equal(h.disk.size, 0);
});

test('automatic RSS transfer pauses on cellular and a manual request for the same episode remains independently allowed', async () => {
  const h = harness(); await h.store.getState().hydrate();
  const automatic = h.store.getState().download(h.channel, h.episodes.slice(0, 1), true);
  await until(() => h.transfers.length === 1);
  h.setWifi(false); await until(() => h.rows()[0].status === 'paused');
  assert.equal(h.transfers[0].status, 'paused');
  const manual = h.store.getState().download(h.channel, h.episodes.slice(0, 1));
  await until(() => h.transfers.length === 2);
  assert.ok(h.rows()[0].groups.includes('podcast:show'));
  h.transfers[1].finish(); await Promise.all([automatic, manual]);
  assert.equal(Object.keys(h.records.get('one') ?? {}).length, 1);
});

test('Wi-Fi recovery never overrides an explicit Pause All', async () => {
  const h = harness(); await h.store.getState().hydrate();
  const work = h.store.getState().download(h.channel, h.episodes.slice(0, 1), true);
  await until(() => h.transfers.length === 1);
  h.setWifi(false); await until(() => h.rows()[0].status === 'paused');
  await h.queue.pauseAll(); h.setWifi(true); await turn();
  assert.equal(h.transfers.length, 1); assert.equal(h.paused(), true);
  await h.queue.resumeAll(); await until(() => h.transfers.length === 2);
  h.transfers[1].finish(); await work;
});

test('Pause after a committed RSS file resumes only publication without downloading or orphaning another file', async () => {
  const h = harness(); await h.store.getState().hydrate();
  let release!: () => void;
  h.blockCommit(new Promise<void>((resolve) => { release = resolve; }));
  const work = h.store.getState().download(h.channel, h.episodes.slice(0, 1));
  await until(() => h.transfers.length === 1); h.transfers[0].finish(); await until(h.commitEntered);
  await h.queue.pauseAll(); release(); await turn(); await turn();
  assert.equal(h.rows()[0].status, 'paused'); assert.equal(h.disk.size, 1);
  await h.queue.resumeAll(); await work;
  assert.equal(h.transfers.length, 1); assert.equal(h.disk.size, 1);
  assert.ok(h.podcastFile({ id: 'show/a', podcastChannelId: 'show' }));
});

test('unsubscribing cancels pending episodes as well as deleting already completed ones', async () => {
  const h = harness(); await h.store.getState().hydrate();
  const work = h.store.getState().download(h.channel, h.episodes.slice(0, 1));
  await until(() => h.transfers.length === 1);
  await h.store.getState().deleteShow('show'); await work;
  assert.equal(h.rows().some((row) => row.status === 'downloading' || row.status === 'queued'), false);
  assert.equal(Object.keys(h.records.get('one') ?? {}).length, 0);
});
